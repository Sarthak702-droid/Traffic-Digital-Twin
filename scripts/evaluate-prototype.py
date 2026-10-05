#!/usr/bin/env python3
"""E02 evaluation entry point for recorded and synthetic model evidence."""

import sys
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Ensure matching Python version site-packages is prioritized in sys.path
py_ver_tag = f"python{sys.version_info.major}.{sys.version_info.minor}"
matching_site = ROOT / f".venv/lib/{py_ver_tag}/site-packages"
if matching_site.is_dir() and str(matching_site) not in sys.path:
    sys.path.insert(0, str(matching_site))
else:
    for venv_site in (ROOT / ".venv/lib").glob("python*/site-packages"):
        if str(venv_site) not in sys.path:
            sys.path.insert(0, str(venv_site))

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "packages/contracts/gen/python"))

from scripts.prototype_evaluation import main

if __name__ == "__main__":
    main()
