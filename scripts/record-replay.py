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
from services.shared.network_config import config_hash, load_config
from services.simulation.metrics import METRICS_VERSION

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
    target=Path('packages/replay'); config=load_config()
    versions={"engine_kind":Engine.engine_kind,"model_version":Engine.model_version,"metrics_version":METRICS_VERSION}
    manifest={"config_id":config["id"],**versions,"recordings":{}}
    digest=config_hash(config)
    for scenario,seed in SCENARIOS:
        path=target/(scenario+'.jsonl.gz')
        frames=0
        with gzip.open(path,'rt') as stream:
            for line in stream:
                state=json.loads(line)['state']
                if state.get('config_hash') != digest:
                    raise RuntimeError(f'{path} has a different configuration; regenerate its recording')
                if any(state.get(key) != value for key,value in versions.items()) or state.get('scenario_type') != scenario or state.get('seed') != seed:
                    raise RuntimeError(f'{path} has incompatible replay metadata; regenerate its recording')
                frames+=1
        if frames != 480:
            raise RuntimeError(f'{path} must contain 480 frames, found {frames}')
        manifest['recordings'][scenario]={'seed':seed,'frames':frames,**versions,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    (target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--scenario', choices=[name for name,_ in SCENARIOS])
    parser.add_argument('--write-manifest', action='store_true')
    args=parser.parse_args()
    if args.write_manifest: write_manifest()
    else: record(args.scenario)
