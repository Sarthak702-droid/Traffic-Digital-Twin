#!/usr/bin/env python3
"""Unified single-command launcher for Traffic Digital Twin.

Starts:
1. PostgreSQL database container (Docker Compose) and verifies database readiness.
2. Go DB Writer service (runs schema migrations).
3. Python API Gateway & WebSocket tunnel.
4. Python Simulation gRPC service (:50051).
5. Python Intelligence gRPC service (:50052).
6. Go Domain API service (:8081).
7. Frontend Vite Web server (:3100).
"""
import hashlib
import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

RUNTIME_DIR = ROOT / ".runtime"
RUNTIME_DIR.mkdir(exist_ok=True)
ENV_FILE = RUNTIME_DIR / "local-env.json"
USERS_FILE = RUNTIME_DIR / "users.json"


def log(msg: str):
    print(f"\033[36m[twin]\033[0m {msg}", flush=True)


def check_port(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (OSError, ConnectionRefusedError):
        return False


def ensure_postgres():
    log("Checking PostgreSQL database...")
    if check_port("127.0.0.1", 5433, timeout=0.5):
        log("PostgreSQL is already running on 127.0.0.1:5433.")
        return

    log("Starting PostgreSQL via Docker Compose...")
    try:
        subprocess.run(["docker", "compose", "up", "-d", "postgres"], check=True, cwd=ROOT)
    except Exception as e:
        log(f"\033[33mWarning:\033[0m could not launch docker compose: {e}")

    log("Waiting for PostgreSQL to be ready on 127.0.0.1:5433...")
    for _ in range(30):
        if check_port("127.0.0.1", 5433, timeout=1.0):
            break
        time.sleep(1)
    else:
        raise RuntimeError("PostgreSQL did not become available on port 5433.")

    # Initialize reader role if needed
    init_sql = ROOT / "scripts" / "init-local-db.sql"
    if init_sql.exists():
        try:
            subprocess.run(
                ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "traffic", "-d", "traffic"],
                input=init_sql.read_bytes(),
                check=False,
                cwd=ROOT,
            )
        except Exception:
            pass


def ensure_local_env() -> dict:
    if not ENV_FILE.exists():
        log("Generating private local environment secrets...")
        env_data = {
            key: secrets.token_hex(32)
            for key in ["DOMAIN_TOKEN", "DOMAIN_WRITE_TOKEN", "WRITER_TOKEN", "SESSION_SECRET", "COMPUTE_TOKEN"]
        }
        env_data.update(
            WRITE_DATABASE_URL="postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable",
            READ_DATABASE_URL="postgres://traffic_reader:traffic_reader_demo@127.0.0.1:5433/traffic?sslmode=disable",
            GATEWAY_INTERNAL_ORIGIN="http://127.0.0.1:8082",
            GATEWAY_USERS_FILE=str(USERS_FILE),
            API_ORIGIN="http://127.0.0.1:8080",
            UI_ORIGIN="http://127.0.0.1:3100",
        )
        fd = os.open(ENV_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(env_data, f, indent=2)
    else:
        env_data = json.loads(ENV_FILE.read_text())

    # Ensure users exist
    if not USERS_FILE.exists():
        log("Provisioning default demo accounts (operator, supervisor, viewer)...")
        default_users = {
            "operator": ("operator_demo_password", "operator"),
            "supervisor": ("supervisor_demo_password", "supervisor"),
            "viewer": ("viewer_demo_password", "viewer"),
        }
        users_data = {}
        for username, (password, role) in default_users.items():
            salt = secrets.token_hex(24)
            pwd_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600000).hex()
            users_data[username] = {
                "role": role,
                "salt": salt,
                "hash": pwd_hash,
                "version": 1,
            }
        fd = os.open(USERS_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(users_data, f, indent=2)
        os.chmod(USERS_FILE, 0o600)

    # Choose gateway port
    gateway_port = int(os.environ.get("GATEWAY_PORT") or env_data.get("GATEWAY_PORT") or 8080)
    if check_port("127.0.0.1", gateway_port, timeout=0.2):
        # 8080 is in use by another service, search 8085+
        candidate = 8085
        while check_port("127.0.0.1", candidate, timeout=0.2):
            candidate += 1
        log(f"Port {gateway_port} is busy; assigning API Gateway to port {candidate}")
        gateway_port = candidate

    # Merge into process environment
    merged = dict(os.environ)
    merged.update(env_data)
    merged.setdefault("PYTHONPATH", ".:packages/contracts/gen/python")
    merged["GATEWAY_PORT"] = str(gateway_port)
    merged["API_ORIGIN"] = f"http://127.0.0.1:{gateway_port}"
    merged["UI_ORIGIN"] = "http://127.0.0.1:3100"
    return merged


def main():
    ensure_postgres()
    env = ensure_local_env()

    commands = [
        ("Go DB Writer", ["go", "run", "./apps/api/cmd/writer"]),
        ("Python API Gateway", [".venv/bin/python", "-m", "services.gateway.server"]),
        ("Python Simulation gRPC", [".venv/bin/python", "-m", "services.shared.server", "simulation", "--port", "50051"]),
        ("Python Intelligence gRPC", [".venv/bin/python", "-m", "services.shared.server", "intelligence", "--port", "50052"]),
        ("Go Domain API", ["go", "run", "./apps/api/cmd/api"]),
        ("Frontend Web (Vite)", ["npm", "run", "dev", "-w", "apps/web"]),
    ]

    children = []

    def shutdown(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    log("Starting services stack...")
    try:
        for name, cmd in commands:
            log(f"Launching {name}...")
            proc = subprocess.Popen(cmd, env=env, start_new_session=True)
            children.append((name, proc))

            # Wait for writer readiness
            if cmd[-1] == "./apps/api/cmd/writer":
                for _ in range(50):
                    try:
                        req = urllib.request.Request(
                            "http://127.0.0.1:8083/internal/write",
                            data=b'{"operation":"ping","actor":"startup","payload":{}}',
                            headers={"X-Service-Token": env["WRITER_TOKEN"], "Content-Type": "application/json"},
                        )
                        urllib.request.urlopen(req, timeout=1).close()
                        break
                    except OSError:
                        time.sleep(0.2)
                else:
                    raise RuntimeError("Go DB Writer did not become ready on port 8083")

            # Wait for gateway readiness
            if "services.gateway.server" in cmd:
                for _ in range(50):
                    try:
                        req = urllib.request.Request(
                            env["GATEWAY_INTERNAL_ORIGIN"] + "/internal/write",
                            data=b'{"operation":"ping","actor":"startup","payload":{}}',
                            headers={"X-Service-Token": env["DOMAIN_WRITE_TOKEN"], "Content-Type": "application/json"},
                        )
                        urllib.request.urlopen(req, timeout=1).close()
                        break
                    except OSError:
                        time.sleep(0.2)
                else:
                    raise RuntimeError("Python API Gateway did not become ready")

        print(
            """
\033[1;32m========================================================================\033[0m
\033[1;32m🚦 TRAFFIC DIGITAL TWIN IS LIVE!\033[0m
\033[1;32m========================================================================\033[0m
  \033[1mFrontend:\033[0m       \033[34mhttp://127.0.0.1:3100\033[0m
  \033[1mAPI Gateway:\033[0m    http://127.0.0.1:8080
  \033[1mDatabase:\033[0m       PostgreSQL on 127.0.0.1:5433 (traffic)

  \033[1mDemo Accounts:\033[0m
  • Operator:     \033[33moperator\033[0m   / \033[33moperator_demo_password\033[0m
  • Supervisor:   \033[33msupervisor\033[0m / \033[33msupervisor_demo_password\033[0m
  • Viewer:       \033[33mviewer\033[0m     / \033[33mviewer_demo_password\033[0m

  \033[1mServices:\033[0m
  [✓] PostgreSQL 16 (Docker)
  [✓] Go DB Writer (:8083)
  [✓] Python Gateway (:8080 public, :8082 internal)
  [✓] Python Simulation (:50051)
  [✓] Python Intelligence (:50052)
  [✓] Go Domain API (:8081)
  [✓] Frontend Web UI (:3100)
\033[1;32m========================================================================\033[0m
Press \033[1;31mCtrl+C\033[0m to stop all services.
""",
            flush=True,
        )

        while all(p.poll() is None for _, p in children):
            time.sleep(0.5)

        failed_name, failed_proc = next((n, p) for n, p in children if p.poll() is not None)
        raise RuntimeError(f"Service {failed_name} exited with code {failed_proc.returncode}")

    except KeyboardInterrupt:
        log("Shutting down services stack...")
    finally:
        for name, p in children:
            if p.poll() is None:
                try:
                    os.killpg(p.pid, signal.SIGTERM)
                except OSError:
                    pass
        for name, p in children:
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except OSError:
                    pass
        log("All services stopped.")


if __name__ == "__main__":
    main()
