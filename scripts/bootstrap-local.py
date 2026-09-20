"""Create or migrate persistent local-only service settings; never print secrets."""
import json,os,secrets
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'.runtime/local-env.json';p.parent.mkdir(exist_ok=True)
env=json.loads(p.read_text()) if p.exists() else {}
changed=not p.exists()
if not env.get('COMPUTE_TOKEN'):
    env['COMPUTE_TOKEN']=secrets.token_hex(32);changed=True
if not env.get('DATABASE_URL'):
    env['DATABASE_URL']=env.get('WRITE_DATABASE_URL','postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable');changed=True
if env.get('API_ORIGIN') == 'http://127.0.0.1:8080':
    env['API_ORIGIN']='http://127.0.0.1:8081';changed=True
if not env.get('API_ADDR'):
    env['API_ADDR']='127.0.0.1:8081';changed=True
if changed:
    temp=p.with_suffix('.tmp');temp.write_text(json.dumps(env,indent=2)+'\n');os.chmod(temp,0o600);temp.replace(p)
    print('Created or migrated the local Go API environment. Start the synthetic stack with npm start.')
else:
    print('Local Go API environment is already current. Start the synthetic stack with npm start.')
