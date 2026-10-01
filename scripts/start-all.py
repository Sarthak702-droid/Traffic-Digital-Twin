#!/usr/bin/env python3
"""Unified single-command launcher for Traffic Digital Twin.
Delegates to scripts/start_all.py.
"""
from pathlib import Path
import os
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]

# If running inside Flatpak sandbox (e.g. VS Code terminal), re-exec on the host
# where Python 3.12, .venv, and host services are installed.
if shutil.which("flatpak-spawn") and not os.environ.get("TWIN_FLATPAK_HOST"):
    os.environ["TWIN_FLATPAK_HOST"] = "1"
    import subprocess
    cmd_args = " ".join(f"'{a}'" for a in sys.argv[1:])
    cmd = ["flatpak-spawn", "--host", "bash", "-c", f"cd $(printf %q '{ROOT}') && exec python3 scripts/start-all.py {cmd_args}"]
    sys.exit(subprocess.call(cmd))

sys.path.insert(0, str(ROOT / "scripts"))

from start_all import main

if __name__ == "__main__":
    main()

