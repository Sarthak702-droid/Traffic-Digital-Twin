#!/usr/bin/env python3
"""Unified single-command launcher for Traffic Digital Twin.

Starts:
1. PostgreSQL database container (Docker Compose) and verifies database readiness.
2. Python Simulation gRPC service (:50051).
3. Python Intelligence gRPC service (:50052).
4. Go API gateway, orchestration and persistence service (:8081).
5. Frontend Vite Web server (:3100).
"""
import hashlib
import json
import os
import secrets
import shutil
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


def log(msg: str):
    print(f"\033[36m[twin]\033[0m {msg}", flush=True)


def check_port(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (OSError, ConnectionRefusedError):
        return False


def _find_docker() -> str:
    """Locate the docker binary, searching PATH and common install locations."""
    resolved = shutil.which("docker")
    if resolved:
        return resolved
    for p in ["/usr/bin/docker", "/usr/local/bin/docker", "/snap/bin/docker",
              os.path.expanduser("~/.local/bin/docker"), "/opt/docker/bin/docker"]:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return "docker"  # fallback; will raise a clear error if not found


def ensure_postgres():
    log("Checking PostgreSQL database...")
    if check_port("127.0.0.1", 5433, timeout=0.5):
        log("PostgreSQL is already running on 127.0.0.1:5433.")
        return

    docker_bin = _find_docker()
    log("Starting PostgreSQL via Docker Compose...")
    try:
        subprocess.run([docker_bin, "compose", "up", "-d", "postgres"], check=True, cwd=ROOT)
    except Exception as e:
        log(f"\033[33mWarning:\033[0m could not launch docker compose: {e}")

    log("Waiting for PostgreSQL to be ready on 127.0.0.1:5433...")
    for _ in range(30):
        if check_port("127.0.0.1", 5433, timeout=1.0):
            break
        time.sleep(1)
    else:
        raise RuntimeError("PostgreSQL did not become available on port 5433.")

def ensure_local_env() -> dict:
    if not ENV_FILE.exists():
        log("Generating private local environment secrets...")
        env_data = {
            key: secrets.token_hex(32)
            for key in ["COMPUTE_TOKEN"]
        }
        env_data.update(
            DATABASE_URL="postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable",
            API_ORIGIN="http://127.0.0.1:8081",
            UI_ORIGIN="http://127.0.0.1:3100",
        )
        fd = os.open(ENV_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(env_data, f, indent=2)
    else:
        env_data = json.loads(ENV_FILE.read_text())

    # Upgrade prior gateway/writer launcher state without requiring users to
    # delete local demo data or secrets.
    env_data.setdefault("COMPUTE_TOKEN", secrets.token_hex(32))
    env_data.setdefault("DATABASE_URL", "postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable")

    # Choose the public Go API port before Vite starts so the proxy points to it.
    api_port = int(os.environ.get("API_PORT") or env_data.get("API_PORT") or 8081)
    if check_port("127.0.0.1", api_port, timeout=0.2):
        candidate = 8085
        while check_port("127.0.0.1", candidate, timeout=0.2):
            candidate += 1
        log(f"Port {api_port} is busy; assigning Go API to port {candidate}")
        api_port = candidate

    # Merge into process environment
    merged = dict(os.environ)
    merged.update(env_data)
    merged.setdefault("PYTHONPATH", ".:packages/contracts/gen/python")
    merged["API_ADDR"] = f"127.0.0.1:{api_port}"
    merged["API_ORIGIN"] = f"http://127.0.0.1:{api_port}"
    merged["UI_ORIGIN"] = "http://127.0.0.1:3100"
    return merged



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
    ports = [8081, 8085, 8086, 50051, 50052, 3100]
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
    if go_available:
        log("Compiling Go API to bin/ for instant startup...")
        try:
            subprocess.run([go_bin, "build", "-o", str(bin_api), "./apps/api/cmd/api"], check=True, cwd=ROOT)
        except Exception as e:
            log(f"Pre-compilation note: {e}")

    # Determine command for the public Go API.
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
        ("Python Simulation gRPC", [py_bin, "-m", "services.shared.server", "simulation", "--port", "50051"]),
        ("Python Intelligence gRPC", [py_bin, "-m", "services.shared.server", "intelligence", "--port", "50052"]),
        ("Go API Gateway", api_cmd),
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

            if name == "Go API Gateway":
                for _ in range(50):
                    try:
                        req = urllib.request.Request(env["API_ORIGIN"] + "/health/live")
                        urllib.request.urlopen(req, timeout=1).close()
                        break
                    except OSError:
                        time.sleep(0.2)
                else:
                    raise RuntimeError("Go API Gateway did not become ready")

        api_p = env["API_ADDR"].split(":")[-1]
        print(
            f"""
\033[1;32m========================================================================\033[0m
\033[1;32m🚦 TRAFFIC DIGITAL TWIN IS LIVE!\033[0m
\033[1;32m========================================================================\033[0m
  \033[1mFrontend:\033[0m       \033[34mhttp://127.0.0.1:3100\033[0m
  \033[1mGo API:\033[0m         http://127.0.0.1:{api_p}
  \033[1mDatabase:\033[0m       PostgreSQL on 127.0.0.1:5433 (traffic)

  \033[1mServices:\033[0m
  [✓] PostgreSQL 16 (Docker)
  [✓] Python Simulation (:50051)
  [✓] Python Intelligence (:50052)
  [✓] Go API Gateway / Orchestrator / Persistence (:{api_p})
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
