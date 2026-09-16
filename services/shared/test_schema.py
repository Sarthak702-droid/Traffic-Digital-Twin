import json
from pathlib import Path
import jsonschema
from google.protobuf.json_format import MessageToDict
import twin_pb2 as pb

ROOT=Path(__file__).resolve().parents[2]

def test_nine_event_types_and_typed_payloads():
    schema=json.loads((ROOT/'packages/contracts/events.schema.json').read_text())
    jsonschema.Draft202012Validator.check_schema(schema)
    expected={'network.state','junction.state','forecast.updated','recommendation.created','recommendation.updated','incident.updated','emergency.updated','health.updated','audit.appended'}
    assert {s['properties']['type']['const'] for s in schema['oneOf']} == expected
    event={'schema_version':'1.0','sequence':'1','timestamp':'2026-09-16T00:00:00Z','type':'health.updated','payload':{'timestamp':'2026-09-16T00:00:00Z','components':[{'component':'api','status':'normal','message':'Connected'}]}}
    jsonschema.validate(event,schema,format_checker=jsonschema.FormatChecker())
    event['type']='network.state'
    assert list(jsonschema.Draft202012Validator(schema).iter_errors(event))

def test_required_domain_models_and_proto_json():
    names={'Node','Link','Movement','SignalPhase','TrafficState','Forecast','Recommendation','OperatorAction','Incident','EmergencyEvent','HealthState','AuditEvent'}
    assert names <= set(pb.DESCRIPTOR.message_types_by_name)
    state=pb.TrafficState(schema_version='1.0',run_id='test',timestamp='2026-09-16T00:00:00Z',source='synthetic',movements=[pb.MovementState(movement_id='m',current_phase_id='p')])
    record=MessageToDict(state,preserving_proto_field_name=True,always_print_fields_with_no_presence=True)
    event={'schema_version':'1.0','sequence':'1','timestamp':state.timestamp,'type':'network.state','payload':record}
    schema=json.loads((ROOT/'packages/contracts/events.schema.json').read_text())
    jsonschema.validate(event,schema)
    assert json.loads((ROOT/'packages/contracts/fixtures/network-state.json').read_text()) == event
