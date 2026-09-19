"""Direct Go gateway integration smoke test for the local synthetic MVP."""
import http.client
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import docker_cmd
from docker_cmd import get_docker_cmd

def port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

def wait(check, seconds=25):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        try:
            if check(): return
        except (OSError, ValueError): pass
        time.sleep(.2)
    raise RuntimeError("service did not become ready")

def main():
    ports = {name: port() for name in ("api", "simulation", "intelligence")}
    schema = "go_gateway_" + uuid.uuid4().hex
    env = os.environ.copy()
    env.update({
        "PYTHONPATH": f"{ROOT}:{ROOT / 'packages/contracts/gen/python'}",
        "COMPUTE_TOKEN": secrets.token_hex(32),
        "API_ADDR": f"127.0.0.1:{ports['api']}",
        "SIMULATION_ADDR": f"127.0.0.1:{ports['simulation']}",
        "INTELLIGENCE_ADDR": f"127.0.0.1:{ports['intelligence']}",
        "UI_ORIGIN": "http://127.0.0.1:3100",
        "DATABASE_URL": f"postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable&search_path={schema}",
    })
    procs = []
    def start(command):
        p = subprocess.Popen(command, cwd=ROOT, env=env, start_new_session=True)
        procs.append(p)
    def request(path, method="GET", body=None):
        c = http.client.HTTPConnection("127.0.0.1", ports["api"], timeout=10)
        headers = {"Content-Type": "application/json", "X-Role": "operator"}
        if method != "GET": headers["Idempotency-Key"] = str(uuid.uuid4())
        try:
            c.request(method, path, json.dumps(body) if body is not None else None, headers)
            response = c.getresponse()
            return response.status, json.loads(response.read())
        finally: c.close()
    try:
        subprocess.run(["docker", "compose", "up", "-d", "postgres"], cwd=ROOT, check=True)
        subprocess.run(["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "traffic", "-d", "traffic", "-c", f"CREATE SCHEMA {schema}"], cwd=ROOT, check=True)
        python = str(ROOT / ".venv/bin/python") if (ROOT / ".venv/bin/python").exists() else sys.executable
        start([python, "-m", "services.shared.server", "simulation", "--port", str(ports["simulation"])])
        start([python, "-m", "services.shared.server", "intelligence", "--port", str(ports["intelligence"])])
        binary = ROOT / ".runtime" / "traffic-go-api-smoke"
        subprocess.run(["go", "build", "-o", str(binary), "./apps/api/cmd/api"], cwd=ROOT, check=True)
        start([str(binary)])
        wait(lambda: request("/health/live")[0] == 200)
        assert request("/api/v1/network")[0] == 200
        status, run = request("/api/v1/scenarios/peak_surge/start", "POST", {"schema_version":"1.0", "seed":1101, "mode":"recommend"})
        assert status == 200, (status, run)
        assert request("/api/v1/audit")[0] == 200
        print("PASS direct Go gateway: REST, gRPC compute, migration and audited scenario start")
    finally:
        for p in procs:
            if p.poll() is None: os.killpg(p.pid, signal.SIGTERM)
        for p in procs:
            try: p.wait(timeout=4)
            except subprocess.TimeoutExpired: os.killpg(p.pid, signal.SIGKILL)
        subprocess.run(["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "traffic", "-d", "traffic", "-c", f"DROP SCHEMA IF EXISTS {schema} CASCADE"], cwd=ROOT, check=False)

if __name__ == "__main__": main()
