"""Universal Docker command resolution for host, containers, and Flatpak."""
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]

# Prepend .runtime/bin and ~/.local/bin to PATH so subprocess finds docker & go everywhere
runtime_bin = str(ROOT / ".runtime/bin")
local_bin = str(Path.home() / ".local/bin")
current_path = os.environ.get("PATH", "")
paths_to_add = [p for p in [runtime_bin, local_bin] if p not in current_path]
if paths_to_add:
    os.environ["PATH"] = ":".join(paths_to_add) + (f":{current_path}" if current_path else "")

def get_docker_cmd():
    """Return docker command list suitable for subprocess execution."""
    resolved = shutil.which("docker")
    if resolved:
        return [resolved]
    for p in ["/usr/bin/docker", "/usr/local/bin/docker", "/snap/bin/docker", f"{local_bin}/docker", f"{runtime_bin}/docker"]:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return [p]
    if shutil.which("flatpak-spawn"):
        return ["flatpak-spawn", "--host", "docker"]
    return ["docker"]
