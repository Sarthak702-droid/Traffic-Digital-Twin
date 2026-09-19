"""Create persistent local-only service secrets; never print their values."""
import json,os,secrets
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'.runtime/local-env.json';p.parent.mkdir(exist_ok=True)
if p.exists():raise SystemExit('Local environment exists; preserved unchanged.')
env={'COMPUTE_TOKEN':secrets.token_hex(32)}
env.update(DATABASE_URL='postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable',API_ADDR='127.0.0.1:8081',API_ORIGIN='http://127.0.0.1:8081')
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(env,f)
print('Created local Go API environment. Start the synthetic stack with npm start.')
