"""Start the local demo after installing dependencies and starting PostgreSQL.

Use Ctrl+C to shut down child processes. No network downloads occur here.
"""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
env=os.environ.copy()
env.setdefault('PYTHONPATH','.:packages/contracts/gen/python')
env.setdefault('DATABASE_URL','postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable')
commands=[['.venv/bin/python','-m','services.shared.server','simulation','--port','50051'],['.venv/bin/python','-m','services.shared.server','intelligence','--port','50052'],['go','run','./apps/api/cmd/api'],['npm','run','start','-w','apps/web']]
children=[]
def shutdown(*_):raise KeyboardInterrupt
signal.signal(signal.SIGTERM,shutdown)
try:
    for command in commands:children.append(subprocess.Popen(command,env=env,start_new_session=True))
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
