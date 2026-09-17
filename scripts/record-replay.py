"""Record deterministic eight-minute SUMO streams, with model forecasts."""
import gzip
import hashlib
import json
from pathlib import Path
from google.protobuf.json_format import MessageToDict
import twin_pb2 as pb
from services.simulation.engine import Engine
from services.intelligence.model import Model

def record():
    target=Path('packages/replay');target.mkdir(exist_ok=True)
    model=Model()
    manifest={"config_id":model.config["id"],"model_version":"conservation-v2","recordings":{}}
    for scenario,seed in [('peak_surge',1101),('incident_c3',2202),('ambulance_corridor',3303)]:
        engine=Engine(directory=Path('.runtime')/('record-'+scenario))
        try:
            engine.reset(pb.RunCommand(schema_version='1.0',run_id='golden-'+scenario,scenario_type=scenario,seed=seed,mode='observe'))
            analysis=None
            with gzip.open(target/(scenario+'.jsonl.gz'),'wt') as out:
                for tick in range(480):
                    state=engine.step()
                    if tick%5==0:analysis=model.analyze(state)
                    record={'state':MessageToDict(state,preserving_proto_field_name=True,always_print_fields_with_no_presence=True),'analysis':MessageToDict(analysis,preserving_proto_field_name=True,always_print_fields_with_no_presence=True)}
                    out.write(json.dumps(record,separators=(',',':'))+'\n')
            manifest['recordings'][scenario]={'seed':seed,'frames':480,'sha256':hashlib.sha256((target/(scenario+'.jsonl.gz')).read_bytes()).hexdigest()}
            print('Recorded',scenario,flush=True)
        finally:engine.close()
    (target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__=='__main__':record()
