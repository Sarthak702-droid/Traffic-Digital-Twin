"""Start the local demo after installing dependencies and starting PostgreSQL.

Use Ctrl+C to shut down child processes. No network downloads occur here.
"""
import json
import os
import urllib.request
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
env=json.loads((ROOT/".runtime/local-env.json").read_text());env.update(os.environ)
env.setdefault('PYTHONPATH','.:packages/contracts/gen/python')
if not Path(env['GATEWAY_USERS_FILE']).exists():raise SystemExit('Provision a gateway user first')
commands=[['go','run','./apps/api/cmd/writer'],['.venv/bin/python','-m','services.gateway.server'],['.venv/bin/python','-m','services.shared.server','simulation','--port','50051'],['.venv/bin/python','-m','services.shared.server','intelligence','--port','50052'],['go','run','./apps/api/cmd/api'],['npm','run','start','-w','apps/web']]
children=[]
def shutdown(*_):raise KeyboardInterrupt
signal.signal(signal.SIGTERM,shutdown)
try:
    for command in commands:
        children.append(subprocess.Popen(command,env=env,start_new_session=True))
        if command[-1]=='./apps/api/cmd/writer':
            for attempt in range(100):
                try:
                    req=urllib.request.Request('http://127.0.0.1:8083/internal/write',data=b'{"operation":"ping","actor":"startup","payload":{}}',headers={'X-Service-Token':env['WRITER_TOKEN'],'Content-Type':'application/json'})
                    urllib.request.urlopen(req,timeout=1).close();break
                except OSError:time.sleep(.2)
            else:raise RuntimeError('Writer did not become ready')
        if command[-1]=='services.gateway.server':time.sleep(.5)
    print('Demo: http://127.0.0.1:3100 — Ctrl+C stops the stack.',flush=True)
    while all(p.poll() is None for p in children):time.sleep(.5)
    failed=next(p for p in children if p.poll() is not None)
    raise RuntimeError(f'Service exited: {failed.args}, code {failed.returncode}')
except KeyboardInterrupt:pass
finally:
    for p in children:
        if p.poll() is None:os.killpg(p.pid,signal.SIGTERM)
    for p in children:
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL)
