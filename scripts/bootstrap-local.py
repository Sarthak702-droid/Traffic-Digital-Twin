"""Create persistent local-only service secrets; never print their values."""
import json,os,secrets
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'.runtime/local-env.json';p.parent.mkdir(exist_ok=True)
if p.exists():raise SystemExit('Local environment exists; preserved unchanged.')
env={key:secrets.token_hex(32) for key in ['DOMAIN_TOKEN','DOMAIN_WRITE_TOKEN','WRITER_TOKEN','SESSION_SECRET','COMPUTE_TOKEN']}
env.update(WRITE_DATABASE_URL='postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable',READ_DATABASE_URL='postgres://traffic_reader:traffic_reader_demo@127.0.0.1:5433/traffic?sslmode=disable',GATEWAY_INTERNAL_ORIGIN='http://127.0.0.1:8002',GATEWAY_INTERNAL_PORT='8002',GATEWAY_USERS_FILE=str(root/'.runtime/users.json'),API_ORIGIN='http://127.0.0.1:8080')
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(env,f)
print('Created private local environment. Provision a user with scripts/create-gateway-user.py before starting.')
