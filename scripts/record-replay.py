"""Record deterministic eight-minute aggregate-flow streams, with forecasts."""
import gzip
import hashlib
import json
import argparse
from pathlib import Path
from google.protobuf.json_format import MessageToDict
import twin_pb2 as pb
from services.simulation.engine import Engine
from services.intelligence.model import Model

SCENARIOS=[('peak_surge',1101),('incident_c3',2202),('ambulance_corridor',3303)]

def record(selected=None):
    target=Path('packages/replay');target.mkdir(exist_ok=True)
    model=Model()
    for scenario,seed in SCENARIOS:
        if selected and scenario != selected:
            continue
        engine=Engine(directory=Path('.runtime')/('record-'+scenario))
        try:
            engine.reset(pb.RunCommand(schema_version='1.0',run_id='golden-'+scenario,scenario_type=scenario,seed=seed,mode='observe'))
            analysis=None
            with gzip.open(target/(scenario+'.jsonl.gz'),'wt') as out:
                for tick in range(480):
                    state=engine.step()
                    # State remains 1 Hz; a 10-second analysis cadence keeps replay
                    # generation bounded while preserving the latest causal result.
                    if tick%10==0:analysis=model.analyze(state)
                    record={'state':MessageToDict(state,preserving_proto_field_name=True,always_print_fields_with_no_presence=True),'analysis':MessageToDict(analysis,preserving_proto_field_name=True,always_print_fields_with_no_presence=True)}
                    out.write(json.dumps(record,separators=(',',':'))+'\n')
            print('Recorded',scenario,flush=True)
        finally:engine.close()

def write_manifest():
    target=Path('packages/replay'); model=Model()
    manifest={"config_id":model.config["id"],"engine_kind":"aggregate_ctm","model_version":"aggregate-predictor-v1","metrics_version":"flow-metrics-v1","recordings":{}}
    for scenario,seed in SCENARIOS:
        path=target/(scenario+'.jsonl.gz')
        with gzip.open(path,'rt') as stream:
            first=json.loads(next(stream))['state']
        if first.get('engine_kind') != 'aggregate_ctm' or first.get('metrics_version') != 'flow-metrics-v1':
            raise RuntimeError(f'{path} is not an aggregate replay')
        manifest['recordings'][scenario]={'seed':seed,'frames':480,'engine_kind':'aggregate_ctm','model_version':'aggregate-predictor-v1','metrics_version':'flow-metrics-v1','sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    (target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--scenario', choices=[name for name,_ in SCENARIOS])
    parser.add_argument('--write-manifest', action='store_true')
    args=parser.parse_args()
    if args.write_manifest: write_manifest()
    else: record(args.scenario)
