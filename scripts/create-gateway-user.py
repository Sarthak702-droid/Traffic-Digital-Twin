"""Provision a password hash without placing passwords in arguments or logs."""
import argparse,getpass,hashlib,json,os,secrets
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('file');p.add_argument('username');p.add_argument('--role',choices=['operator','supervisor','viewer'],default='operator');a=p.parse_args()
password=getpass.getpass('Password (12+ characters): ')
if len(password)<12:raise SystemExit('Use at least 12 characters')
if password!=getpass.getpass('Repeat password: '):raise SystemExit('Passwords differ')
path=Path(a.file);data=json.loads(path.read_text()) if path.exists() else {};salt=secrets.token_hex(24)
data[a.username]={'role':a.role,'salt':salt,'hash':hashlib.pbkdf2_hmac('sha256',password.encode(),salt.encode(),600000).hex(),'version':data.get(a.username,{}).get('version',0)+1}
path.parent.mkdir(parents=True,exist_ok=True)
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:json.dump(data,f)
os.chmod(path,0o600)
print('Account provisioned; existing sessions for this account are revoked.')
