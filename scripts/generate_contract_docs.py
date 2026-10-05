"""Generate TypeScript and JSON schema from the checked-in protobuf descriptor."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path('packages/contracts/gen/python').resolve()))
import twin_pb2 as pb
from google.protobuf.descriptor import FieldDescriptor as F
messages=pb.DESCRIPTOR.message_types_by_name
schemas={};interfaces=[]
additive_from={
    'TrafficState':18,
    'SchedulerSnapshot':6,
    'Forecast':12,
    'TimingChange':4,
    'Recommendation':10,
    'ComparisonResult':15,
    'PlanCommand':4,
    'PlanOutcome':4,
    'Analysis':7,
    'CompareCommand':4,
    'RunCommand':9,
    'BoundaryDemandState':4,
}
quality=('fresh','cached_valid','synthetic','missing','stale','degraded',
         'out_of_order','duplicate','replay')
horizon_status=('available','insufficient_history','missing_input','stale_input','compute_unavailable')
string_vocab={
    ('SourceIdentity','processing_mode'):('online_inference','cached_observations','synthetic_replay'),
    ('FinalizedObservation','observation_status'):('valid','degraded','invalid'),
    ('TrafficState','input_quality'):quality,
    ('Forecast','method'):('persistence','ewma'),
    ('Forecast','input_quality'):quality,
    ('Forecast','horizon_status'):horizon_status,
    ('Forecast','uncertainty_status'):('calibrated','unavailable'),
    ('HorizonAvailability','status'):horizon_status,
    ('Analysis','input_quality'):quality,
    ('Analysis','outcome'):('recommend','no_action','cannot_evaluate'),
}
for name,message in messages.items():
    props={};fields=[]
    for f in message.fields:
        if f.type==F.TYPE_MESSAGE:
            schema={'$ref':f'#/$defs/{f.message_type.name}'};typ=f.message_type.name
        elif f.type==F.TYPE_STRING:
            schema={'type':'string'};typ='string'
        elif f.type==F.TYPE_BOOL:
            schema={'type':'boolean'};typ='boolean'
        elif f.type==F.TYPE_UINT64:
            schema={'type':'string','pattern':'^[0-9]+$'};typ='string'
        else:
            schema={'type':'number' if f.type in (F.TYPE_DOUBLE,F.TYPE_FLOAT) else 'integer'};typ='number'
            if f.type in (F.TYPE_UINT32,F.TYPE_UINT64):schema['minimum']=0
        if f.is_repeated:
            schema={'type':'array','items':schema};typ=f'{typ}[]'
        # Additive fields cannot make older replay or event JSON invalid.
        compatibility_optional = f.number >= additive_from.get(name, 999999)
        optional=f.containing_oneof is not None or f.type==F.TYPE_MESSAGE and not f.is_repeated or compatibility_optional
        if f.type==F.TYPE_MESSAGE and not f.is_repeated:
            schema={"anyOf":[schema,{"type":"null"}]};typ+=" | null"
        if not optional and schema.get('type') in ('number','integer') and (f.name.endswith(('_s','_veh','_vpm','_kph')) or f.name=='occupancy_ratio'):schema['minimum']=0
        if f.name=='occupancy_ratio':schema['maximum']=1
        if name=='BoundaryDemandState' and f.name=='offered_window_s':schema.update(minimum=0,maximum=60)
        if f.name=='schema_version' and name=='TrafficState':schema={'enum':['1.0','1.1']};typ='"1.0" | "1.1"'
        elif f.name=='schema_version':schema={'const':'1.0'};typ='"1.0"'
        elif (name,f.name) in string_vocab:
            values=string_vocab[(name,f.name)]
            # Old protobuf JSON with default printing emits an empty string.
            # Runtime validation rejects that value for a bound prototype run.
            if compatibility_optional:
                values=('',)+values
            schema={'enum':list(values)}
            typ=' | '.join(json.dumps(value) for value in values)
        props[f.name]=schema;fields.append(f'  {f.name}{"?" if optional else ""}: {typ};')
    schemas[name]={'type':'object','properties':props,'additionalProperties':False,'required':[f.name for f in message.fields if f.containing_oneof is None and not (f.type==F.TYPE_MESSAGE and not f.is_repeated) and f.number < additive_from.get(name, 999999)]}
    interfaces.append(f'export interface {name} {{\n'+ '\n'.join(fields)+'\n}')
# JSON events use the PRD names, with discriminated payloads. Protobuf uses a oneof.
events={'network.state':'TrafficState','junction.state':'SignalState','forecast.updated':'Forecast','recommendation.created':'Recommendation','recommendation.updated':'Recommendation','incident.updated':'Incident','emergency.updated':'EmergencyEvent','health.updated':'HealthState','audit.appended':'AuditEvent'}
variants=[];types=[]
for event,model in events.items():
    variants.append({'type':'object','additionalProperties':False,'required':['schema_version','sequence','timestamp','type','payload'],'properties':{'schema_version':{'const':'1.0'},'sequence':{'type':'string','pattern':'^[0-9]+$'},'timestamp':{'type':'string','format':'date-time'},'type':{'const':event},'payload':{'$ref':f'#/$defs/{model}'}}})
    types.append(f'{{ schema_version: "1.0"; sequence: string; timestamp: string; type: "{event}"; payload: {model} }}')
Path('packages/contracts/typescript/events.ts').write_text('// Generated by scripts/generate_contract_docs.py; do not edit.\n'+'\n\n'.join(interfaces)+'\n\nexport type LiveEvent =\n  '+' |\n  '.join(types)+';\n')
Path('packages/contracts/events.schema.json').write_text(json.dumps({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:traffic:v1:events','oneOf':variants,'$defs':schemas},indent=2)+'\n')

# Keep the public API component shapes aligned with the versioned wire model.
# Endpoint descriptions remain hand-owned by Go/API tasks.
openapi_path=Path('packages/contracts/openapi.json')
openapi=json.loads(openapi_path.read_text())
def openapi_refs(value):
    if isinstance(value,dict):
        return {key:openapi_refs(item) for key,item in value.items()}
    if isinstance(value,list):
        return [openapi_refs(item) for item in value]
    if isinstance(value,str) and value.startswith('#/$defs/'):
        return value.replace('#/$defs/','#/components/schemas/',1)
    return value
for name in schemas:
    openapi['components']['schemas'][name]=openapi_refs(schemas[name])
# A report schema's local $defs cannot resolve at the OpenAPI document root.
# Give every public report definition a distinct component name instead.
report=json.loads(Path('packages/contracts/run-report-v2.schema.json').read_text())
def report_refs(value):
    if isinstance(value,dict):return {key:report_refs(item) for key,item in value.items()}
    if isinstance(value,list):return [report_refs(item) for item in value]
    if isinstance(value,str) and value.startswith('#/$defs/'):
        return value.replace('#/$defs/','#/components/schemas/ReportV2_',1)
    return value
for name,definition in report.pop('$defs').items():
    openapi['components']['schemas']['ReportV2_'+name]=report_refs(definition)
report.pop('$id',None);report.pop('$schema',None)
openapi['components']['schemas']['PrototypeRunReportV2']=report_refs(report)
openapi['paths']['/api/v1/runs/{id}/report']['get']['responses']['200']['content']['application/json']['schema']={'$ref':'#/components/schemas/PrototypeRunReportV2'}
openapi_path.write_text(json.dumps(openapi,indent=2)+'\n')
