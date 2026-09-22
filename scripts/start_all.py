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
import fcntl
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
LOCK_FILE = RUNTIME_DIR / "stack.lock"
SERVICE_STATE_FILE = RUNTIME_DIR / "services.json"
SERVICE_PORTS = (8081, 50051, 50052, 3100)


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
        raise RuntimeError(
            "PostgreSQL is not running and Docker Compose could not start it. "
            "Start Docker (and ensure this user can access its socket), then run npm start again."
        ) from e

    log("Waiting for PostgreSQL to be ready on 127.0.0.1:5433...")
    for _ in range(30):
        if check_port("127.0.0.1", 5433, timeout=1.0):
            break
        time.sleep(1)
    else:
        raise RuntimeError("PostgreSQL did not become available on port 5433.")


def write_local_env(env_data: dict) -> None:
    """Persist local configuration without ever logging its secret values."""
    temporary = ENV_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(env_data, indent=2) + "\n")
    os.chmod(temporary, 0o600)
    temporary.replace(ENV_FILE)

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
        write_local_env(env_data)
    else:
        env_data = json.loads(ENV_FILE.read_text())

    # Upgrade prior gateway/writer launcher state without requiring users to
    # delete local demo data or secrets.  Earlier revisions used
    # WRITE_DATABASE_URL and pointed Vite at a retired :8080 gateway.  The
    # current Go gateway owns persistence and listens on :8081 by default.
    changed = False
    if not env_data.get("COMPUTE_TOKEN"):
        env_data["COMPUTE_TOKEN"] = secrets.token_hex(32)
        changed = True
    if not env_data.get("DATABASE_URL"):
        env_data["DATABASE_URL"] = env_data.get(
            "WRITE_DATABASE_URL", "postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable"
        )
        changed = True
    if env_data.get("API_ORIGIN") == "http://127.0.0.1:8080":
        env_data["API_ORIGIN"] = "http://127.0.0.1:8081"
        changed = True
    if changed:
        write_local_env(env_data)
        log("Migrated legacy local launcher settings to the Go gateway configuration.")

    # The local development contract uses stable ports. Silently moving only
    # one component creates a mixed stack where the browser can keep talking to
    # an older API/frontend process.
    api_port = 8081

    # Merge into process environment
    merged = dict(os.environ)
    merged.update(env_data)
    merged.setdefault("TWIN_ENGINE", "aggregate")
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


def wait_for_port(name: str, port: int, process: subprocess.Popen, timeout: float = 20.0):
    """Do not start a dependent service until its listener is actually ready."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        exit_code = process.poll()
        if exit_code is not None:
            raise RuntimeError(f"{name} exited before becoming ready (exit code {exit_code}).")
        if check_port("127.0.0.1", port, timeout=0.2):
            # Do not mistake an unrelated/old listener for this child. Give the
            # newly launched process a stabilization window and re-check it.
            time.sleep(0.25)
            if process.poll() is None and check_port("127.0.0.1", port, timeout=0.2):
                return
        time.sleep(0.2)
    raise RuntimeError(f"{name} did not listen on 127.0.0.1:{port} within {timeout:.0f} seconds.")


def _process_start_time(pid: int, proc_root: Path = Path("/proc")) -> str | None:
    """Return Linux's stable process start tick, used to guard against PID reuse."""
    try:
        stat = (proc_root / str(pid) / "stat").read_text()
        # The command name is parenthesized and may itself contain spaces.
        fields = stat[stat.rfind(")") + 2:].split()
        return fields[19]  # field 22 overall; fields starts at field 3
    except (OSError, IndexError):
        return None


def _write_service_state(children: list[tuple[str, subprocess.Popen]]) -> None:
    records = []
    for name, process in children:
        start_time = _process_start_time(process.pid)
        if start_time is not None:
            records.append({"name": name, "pid": process.pid, "start_time": start_time})
    temporary = SERVICE_STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps({"services": records}, indent=2) + "\n")
    temporary.replace(SERVICE_STATE_FILE)


def _registered_service_pids(proc_root: Path = Path("/proc")) -> set[int]:
    """Read crash-surviving child records, rejecting PIDs that were reused."""
    try:
        records = json.loads(SERVICE_STATE_FILE.read_text()).get("services", [])
    except (OSError, ValueError, AttributeError):
        return set()
    found = set()
    for record in records:
        try:
            pid = int(record["pid"])
            expected_start = str(record["start_time"])
        except (KeyError, TypeError, ValueError):
            continue
        if _process_start_time(pid, proc_root) == expected_start:
            found.add(pid)
    return found


def _listening_socket_inodes(ports: set[int], proc_root: Path = Path("/proc")) -> set[str]:
    """Find socket inodes listening on our ports without depending on lsof/fuser."""
    inodes: set[str] = set()
    for table in ("tcp", "tcp6"):
        try:
            lines = (proc_root / "net" / table).read_text().splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            fields = line.split()
            try:
                local_port = int(fields[1].rsplit(":", 1)[1], 16)
                state = fields[3]
                inode = fields[9]
            except (IndexError, ValueError):
                continue
            if state == "0A" and local_port in ports:  # TCP_LISTEN
                inodes.add(inode)
    return inodes


def _listener_pids(ports: set[int], proc_root: Path = Path("/proc")) -> set[int]:
    inodes = _listening_socket_inodes(ports, proc_root)
    found: set[int] = set()
    if inodes:
        try:
            entries = list(proc_root.iterdir())
        except OSError:
            entries = []
        for entry in entries:
            if not entry.name.isdigit():
                continue
            try:
                descriptors = list((entry / "fd").iterdir())
            except OSError:
                continue
            for descriptor in descriptors:
                try:
                    target = os.readlink(descriptor)
                except OSError:
                    continue
                if target.startswith("socket:[") and target[8:-1] in inodes:
                    found.add(int(entry.name))
                    break

    # Supplemental host-level resolution using ss, lsof, and fuser
    try:
        ss_filter = " or ".join(f"sport = :{p}" for p in ports)
        out = subprocess.run(["ss", "-tlnp", ss_filter], capture_output=True, text=True, timeout=1)
        import re
        for match in re.finditer(r"pid=(\d+)", out.stdout):
            found.add(int(match.group(1)))
    except Exception:
        pass
    for p in ports:
        try:
            out = subprocess.run(["lsof", "-ti", f":{p}"], capture_output=True, text=True, timeout=1)
            for line in out.stdout.splitlines():
                if line.strip().isdigit():
                    found.add(int(line.strip()))
        except Exception:
            pass
        try:
            out = subprocess.run(["fuser", f"{p}/tcp"], capture_output=True, text=True, timeout=1)
            for token in (out.stdout + " " + out.stderr).split():
                clean = token.strip().rstrip("/m").rstrip("/e")
                if clean.isdigit():
                    found.add(int(clean))
        except Exception:
            pass
    return found


def _belongs_to_workspace(entry: Path) -> bool:
    root = str(ROOT)
    try:
        raw = (entry / "cmdline").read_bytes()
        command = raw.replace(b"\0", b" ").decode(errors="replace")
    except OSError:
        command = ""
    try:
        cwd = str((entry / "cwd").resolve())
    except OSError:
        cwd = ""
    try:
        executable = str((entry / "exe").resolve())
    except OSError:
        executable = ""
    return any(
        value == root or value.startswith(root + os.sep) or root in value
        for value in (cwd, executable, command)
    )


def workspace_service_pids(proc_root: Path = Path("/proc")) -> set[int]:
    """Find only stale service processes that belong to this workspace.

    Flatpak/VS Code terminals can make host listeners invisible to lsof/fuser
    even though a new process can still see that the port is occupied. Reading
    proc metadata gives the launcher a scoped fallback without killing an
    unrelated service which happens to use one of the same ports.
    """
    found: set[int] = set()
    own_pid = os.getpid()
    listener_pids = _listener_pids(set(SERVICE_PORTS), proc_root)
    try:
        entries = list(proc_root.iterdir())
    except OSError:
        return found
    for entry in entries:
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid == own_pid:
            continue
        try:
            raw = (entry / "cmdline").read_bytes()
            command = raw.replace(b"\0", b" ").decode(errors="replace")
        except OSError:
            continue
        in_workspace = _belongs_to_workspace(entry)
        owns_stack_port = pid in listener_pids
        is_api = (
            str(ROOT / "bin" / "api") in command
            or "apps/api/cmd/api" in command
            or (str(ROOT / ".runtime") in command and "traffic-api" in command)
        )
        is_compute = "services.shared.server" in command and (" simulation " in f" {command} " or " intelligence " in f" {command} ")
        is_vite = ("vite" in command and "--port 3100" in command) or ("apps/web" in command and "vite" in command)

        # Match workspace-owned stack processes, or any process listening on our specific stack ports
        # that matches our service signatures
        if in_workspace and (owns_stack_port or is_api or is_compute or is_vite):
            found.add(pid)
        elif owns_stack_port and (is_api or is_compute or is_vite or "vite" in command or "traffic" in command):
            found.add(pid)
    return found


def _terminate_pid(pid: int, sig: signal.Signals):
    """Terminate a process and its process group (unless it's the current launcher group)."""
    own_pgid = os.getpgrp()
    try:
        pgid = os.getpgid(pid)
    except OSError:
        pgid = None

    if pgid is not None and pgid > 1 and pgid != own_pgid:
        try:
            os.killpg(pgid, sig)
        except OSError:
            pass
    try:
        os.kill(pid, sig)
    except OSError:
        pass


def acquire_instance_lock():
    """Return a held lock file, or None when this workspace is already live."""
    handle = LOCK_FILE.open("a+")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.seek(0)
        owner = handle.read().strip() or "unknown"
        if all(check_port("127.0.0.1", port, timeout=0.2) for port in (8081, 50051, 50052, 3100)):
            log(f"Traffic Digital Twin is already running (launcher PID {owner}).")
            log("Frontend: http://127.0.0.1:3100 · Go API: http://127.0.0.1:8081")
            handle.close()
            return None
        handle.close()
        raise RuntimeError(f"Another launcher (PID {owner}) is still starting or shutting down; wait and retry.")
    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


def cleanup_stale_services():
    # Only clean processes positively identified as belonging to this
    # workspace. Never kill an unrelated process merely because it owns one of
    # our expected ports.
    ports = list(SERVICE_PORTS)

    # First use a workspace-scoped proc scan. This covers stale children
    # orphaned by an earlier Flatpak/VS Code terminal where lsof/fuser cannot
    # resolve the owning host process.
    # The state file survives an ungraceful launcher/terminal exit. Start-time
    # validation ensures that a recycled PID can never be terminated.
    scoped = _registered_service_pids() | workspace_service_pids()
    if scoped:
        log(f"Stopping {len(scoped)} stale workspace service process(es)...")
    for pid in scoped:
        _terminate_pid(pid, signal.SIGTERM)

    if scoped:
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and any((Path("/proc") / str(pid)).exists() for pid in scoped):
            time.sleep(0.05)
        for pid in scoped:
            if (Path("/proc") / str(pid)).exists():
                _terminate_pid(pid, signal.SIGKILL)

    SERVICE_STATE_FILE.unlink(missing_ok=True)

    # Wait for ports to be released by kernel
    for p in ports:
        for _ in range(25):
            if not check_port("127.0.0.1", p, timeout=0.08):
                break
            time.sleep(0.08)

    # If any port is still busy, forcefully kill remaining listener processes and release ports
    busy_ports = [p for p in ports if check_port("127.0.0.1", p, timeout=0.2)]
    if busy_ports:
        leftover_pids = _listener_pids(set(busy_ports)) - {os.getpid()}
        if leftover_pids:
            log(f"Force-stopping remaining listener process(es) on port(s) {busy_ports}: {leftover_pids}")
            for pid in leftover_pids:
                _terminate_pid(pid, signal.SIGKILL)

        # Use fuser and lsof to forcefully drop lingering sockets on still-busy ports
        for p in busy_ports:
            try:
                subprocess.run(["fuser", "-k", "-9", f"{p}/tcp"], capture_output=True, timeout=1)
            except Exception:
                pass
            try:
                out = subprocess.run(["lsof", "-ti", f":{p}"], capture_output=True, text=True, timeout=1)
                for line in out.stdout.splitlines():
                    if line.strip().isdigit():
                        _terminate_pid(int(line.strip()), signal.SIGKILL)
            except Exception:
                pass

        # Wait up to 3.0s for the kernel to release all busy ports
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            if not any(check_port("127.0.0.1", p, timeout=0.1) for p in busy_ports):
                break
            time.sleep(0.1)

    busy = [str(p) for p in ports if check_port("127.0.0.1", p, timeout=0.2)]
    if busy:
        details = []
        for port_str in busy:
            p = int(port_str)
            pids = _listener_pids({p}) - {os.getpid()}
            pid_info = []
            for pid in pids:
                try:
                    cmd = (Path("/proc") / str(pid) / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
                    pid_info.append(f"PID {pid} ({cmd.strip()[:60]})")
                except Exception:
                    pid_info.append(f"PID {pid}")
            if pid_info:
                details.append(f"{p} [{' ; '.join(pid_info)}]")
            else:
                details.append(str(p))
        raise RuntimeError(
            "Required local port(s) still occupied: " + ", ".join(details) +
            ". Stop the owning process; the launcher will not create a mixed stack on fallback ports."
        )


def main():
    instance_lock = acquire_instance_lock()
    if instance_lock is None:
        return
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
    try:
        signal.signal(signal.SIGHUP, shutdown)
    except (AttributeError, ValueError):
        pass

    def _set_pdeathsig():
        try:
            import ctypes
            libc = ctypes.CDLL("libc.so.6")
            libc.prctl(1, signal.SIGTERM)  # PR_SET_PDEATHSIG = 1
        except Exception:
            pass

    log("Starting services stack...")
    try:
        for name, cmd in commands:
            log(f"Launching {name}...")
            proc = subprocess.Popen(cmd, env=env, cwd=str(ROOT), start_new_session=True, preexec_fn=_set_pdeathsig)
            children.append((name, proc))
            _write_service_state(children)

            if name == "Python Simulation gRPC":
                wait_for_port(name, 50051, proc)
            elif name == "Python Intelligence gRPC":
                wait_for_port(name, 50052, proc)
            elif name == "Go API Gateway":
                for _ in range(50):
                    if proc.poll() is not None:
                        raise RuntimeError(f"Go API Gateway exited before becoming ready (exit code {proc.returncode}).")
                    try:
                        req = urllib.request.Request(env["API_ORIGIN"] + "/health/live")
                        urllib.request.urlopen(req, timeout=1).close()
                        break
                    except OSError:
                        time.sleep(0.2)
                else:
                    raise RuntimeError("Go API Gateway did not become ready")
            elif name == "Frontend Web (Vite)":
                wait_for_port(name, 3100, proc)

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

        while True:
            failed = next(((name, p) for name, p in children if p.poll() is not None), None)
            if failed is not None:
                failed_name, failed_proc = failed
                raise RuntimeError(f"Service {failed_name} exited with code {failed_proc.returncode}")
            time.sleep(0.5)

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
        SERVICE_STATE_FILE.unlink(missing_ok=True)
        instance_lock.close()
        log("All services stopped.")


if __name__ == "__main__":
    main()
