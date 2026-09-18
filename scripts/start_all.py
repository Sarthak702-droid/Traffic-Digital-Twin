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
            GATEWAY_INTERNAL_ORIGIN="http://127.0.0.1:8002",
            GATEWAY_INTERNAL_PORT="8002",
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
    merged["GATEWAY_INTERNAL_PORT"] = str(int(env_data.get("GATEWAY_INTERNAL_PORT", 8002)))
    merged["GATEWAY_INTERNAL_ORIGIN"] = f"http://127.0.0.1:{merged['GATEWAY_INTERNAL_PORT']}"
    merged["API_ORIGIN"] = f"http://127.0.0.1:{gateway_port}"
    merged["UI_ORIGIN"] = "http://127.0.0.1:3100"
    return merged


import shutil

def find_executable(name: str, fallback_paths: list[str]) -> str:
    resolved = shutil.which(name)
    if resolved:
        return resolved
    for p in fallback_paths:
        expanded = os.path.expanduser(p)
        if os.path.isfile(expanded) and os.access(expanded, os.X_OK):
            return expanded
    return name


def cleanup_stale_services():
    # Clean up lingering local processes on digital twin service ports
    ports = [8081, 8082, 8002, 8083, 8085, 8086, 50051, 50052, 3100]
    for p in ports:
        try:
            out = subprocess.check_output(["lsof", "-t", f"-i:{p}"], stderr=subprocess.DEVNULL)
            pids = [int(x.strip()) for x in out.decode().split() if x.strip()]
            for pid in pids:
                if pid != os.getpid():
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except OSError:
                        pass
        except Exception:
            pass
        try:
            subprocess.run(["fuser", "-k", "-9", f"{p}/tcp"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    # Wait for ports to be released by kernel
    for p in ports:
        for _ in range(25):
            if not check_port("127.0.0.1", p, timeout=0.08):
                break
            time.sleep(0.08)


def main():
    cleanup_stale_services()
    ensure_postgres()
    env = ensure_local_env()

    # Root-level resolution for Go services (precompiled binary or Go compiler)
    bin_dir = ROOT / "bin"
    bin_dir.mkdir(exist_ok=True)
    bin_writer = bin_dir / "writer"
    bin_api = bin_dir / "api"

    go_bin = find_executable("go", [
        "/usr/local/go/bin/go",
        "/home/sarthaktripathy/.local/bin/go",
        os.path.expanduser("~/.local/bin/go"),
        os.path.expanduser("~/go/bin/go"),
        "/usr/bin/go",
        "/bin/go",
        "/snap/bin/go",
        "/opt/go/bin/go",
    ])
    go_available = bool(shutil.which(go_bin) or (os.path.isfile(go_bin) and os.access(go_bin, os.X_OK)))

    # If binaries do not exist and Go is available, compile them once
    if go_available and (not bin_writer.exists() or not bin_api.exists()):
        log("Compiling Go services to bin/ for instant startup...")
        try:
            subprocess.run([go_bin, "build", "-o", str(bin_writer), "./apps/api/cmd/writer"], check=True, cwd=ROOT)
            subprocess.run([go_bin, "build", "-o", str(bin_api), "./apps/api/cmd/api"], check=True, cwd=ROOT)
        except Exception as e:
            log(f"Pre-compilation note: {e}")

    # Determine command for Writer
    if bin_writer.exists() and os.access(bin_writer, os.X_OK):
        writer_cmd = [str(bin_writer)]
    elif go_available:
        writer_cmd = [go_bin, "run", "./apps/api/cmd/writer"]
    else:
        raise RuntimeError(
            "Neither pre-compiled Go binaries (bin/writer, bin/api) nor the Go compiler ('go') were found.\n"
            "Please install Go (https://go.dev/dl/) or ensure bin/writer and bin/api exist."
        )

    # Determine command for Domain API
    if bin_api.exists() and os.access(bin_api, os.X_OK):
        api_cmd = [str(bin_api)]
    elif go_available:
        api_cmd = [go_bin, "run", "./apps/api/cmd/api"]
    else:
        raise RuntimeError("Neither pre-compiled bin/api nor Go compiler found.")

    venv_dir = ROOT / ".venv"
    venv_py = venv_dir / "bin" / "python"
    # IMPORTANT: Do NOT .resolve() — that follows symlinks to /usr/bin/python3
    # which bypasses venv site-packages. The unresolved path lets Python detect
    # pyvenv.cfg in the parent directory and activate the venv properly.
    py_bin = str(venv_py) if venv_py.exists() else sys.executable

    # Activate venv for child processes so grpcio and other packages are found
    if venv_dir.exists():
        env["VIRTUAL_ENV"] = str(venv_dir)
        # Remove any inherited PYTHONHOME that would override the venv
        env.pop("PYTHONHOME", None)

    npm_bin = find_executable("npm", [
        "/usr/local/bin/npm",
        "~/.nvm/versions/node/v24.18.0/bin/npm",
        "~/.nvm/current/bin/npm",
        "/usr/bin/npm",
        "~/.local/bin/npm",
    ])

    # Ensure binary directories are in PATH for child processes
    # venv bin MUST be first so the venv python is used for subprocesses
    extra_paths = [
        str(venv_dir / "bin") if venv_dir.exists() else "",
        str(bin_dir),
        os.path.dirname(go_bin) if go_available else "",
        os.path.expanduser("~/go/bin"),
        os.path.dirname(npm_bin),
        os.path.expanduser("~/.local/bin"),
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ]
    cur_path = env.get("PATH", "")
    to_add = [p for p in extra_paths if p and os.path.isdir(p) and p not in cur_path.split(":")]
    if to_add:
        env["PATH"] = ":".join(to_add) + (":" + cur_path if cur_path else "")

    commands = [
        ("Go DB Writer", writer_cmd),
        ("Python API Gateway", [py_bin, "-m", "services.gateway.server"]),
        ("Python Simulation gRPC", [py_bin, "-m", "services.shared.server", "simulation", "--port", "50051"]),
        ("Python Intelligence gRPC", [py_bin, "-m", "services.shared.server", "intelligence", "--port", "50052"]),
        ("Go Domain API", api_cmd),
        ("Frontend Web (Vite)", [npm_bin, "run", "dev", "-w", "apps/web"]),
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
            proc = subprocess.Popen(cmd, env=env, cwd=str(ROOT), start_new_session=True)
            children.append((name, proc))

            # Wait for writer readiness
            if "writer" in name.lower():
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
            if "gateway" in name.lower():
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

        gw_p = env.get("GATEWAY_PORT", "8080")
        print(
            f"""
\033[1;32m========================================================================\033[0m
\033[1;32m🚦 TRAFFIC DIGITAL TWIN IS LIVE!\033[0m
\033[1;32m========================================================================\033[0m
  \033[1mFrontend:\033[0m       \033[34mhttp://127.0.0.1:3100\033[0m
  \033[1mAPI Gateway:\033[0m    http://127.0.0.1:{gw_p}
  \033[1mDatabase:\033[0m       PostgreSQL on 127.0.0.1:5433 (traffic)

  \033[1mDemo Accounts:\033[0m
  • Operator:     \033[33moperator\033[0m   / \033[33moperator_demo_password\033[0m
  • Supervisor:   \033[33msupervisor\033[0m / \033[33msupervisor_demo_password\033[0m
  • Viewer:       \033[33mviewer\033[0m     / \033[33mviewer_demo_password\033[0m

  \033[1mServices:\033[0m
  [✓] PostgreSQL 16 (Docker)
  [✓] Go DB Writer (:8083)
  [✓] Python Gateway (:{gw_p} public, :8082 internal)
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
