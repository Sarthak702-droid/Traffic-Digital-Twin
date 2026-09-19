#!/usr/bin/env python3
"""Run Python microservice tests with guaranteed path resolution for virtualenv and contracts."""

import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

# Ensure repository root and contract paths are in sys.path
for p in [ROOT, ROOT / "packages/contracts/gen/python"]:
    str_p = str(p)
    if str_p not in sys.path:
        sys.path.insert(0, str_p)

# Ensure .venv site-packages is in sys.path regardless of how python is invoked
for venv_site in (ROOT / ".venv/lib").glob("python*/site-packages"):
    str_site = str(venv_site)
    if str_site not in sys.path:
        sys.path.insert(0, str_site)

try:
    import pytest
except ImportError:
    print(f"[test:python] ERROR: pytest could not be imported by Python ({sys.executable}).")
    print(f"[test:python] sys.path is: {sys.path}")
    sys.exit(1)

if __name__ == "__main__":
    args = sys.argv[1:] if len(sys.argv) > 1 else ["-v", "services"]
    exit_code = pytest.main(args)
    sys.exit(exit_code)
