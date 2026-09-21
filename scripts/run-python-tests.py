#!/usr/bin/env python3
"""Run Python microservice tests with guaranteed path resolution for virtualenv and contracts."""

import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

# 1. Ensure repository root and contract paths are in sys.path
for p in [ROOT, ROOT / "packages/contracts/gen/python"]:
    str_p = str(p)
    if str_p not in sys.path:
        sys.path.insert(0, str_p)

# 2. Ensure matching Python version site-packages is prioritized in sys.path
py_ver_tag = f"python{sys.version_info.major}.{sys.version_info.minor}"
matching_site = ROOT / f".venv/lib/{py_ver_tag}/site-packages"
if matching_site.is_dir():
    str_matching = str(matching_site)
    if str_matching not in sys.path:
        sys.path.insert(0, str_matching)
else:
    for venv_site in (ROOT / ".venv/lib").glob("python*/site-packages"):
        str_site = str(venv_site)
        if str_site not in sys.path:
            sys.path.insert(0, str_site)

# 3. Keep the virtualenv executable path available for private Python services.
venv_bin = ROOT / ".venv/bin"
for b in [venv_bin]:
    if b.is_dir() and str(b) not in os.environ.get("PATH", ""):
        os.environ["PATH"] = f"{b}:{os.environ.get('PATH', '')}"

# 4. Compatibility fallbacks for C-extensions if running under mismatched interpreter
try:
    import grpc
except (ImportError, ModuleNotFoundError):
    import enum, types
    grpc_mock = types.ModuleType("grpc")
    class StatusCode(enum.Enum):
        OK = 0; CANCELLED = 1; UNKNOWN = 2; INVALID_ARGUMENT = 3
        DEADLINE_EXCEEDED = 4; NOT_FOUND = 5; ALREADY_EXISTS = 6
        PERMISSION_DENIED = 7; RESOURCE_EXHAUSTED = 8; FAILED_PRECONDITION = 9
        ABORTED = 10; OUT_OF_RANGE = 11; UNIMPLEMENTED = 12; INTERNAL = 13
        UNAVAILABLE = 14; DATA_LOSS = 15; UNAUTHENTICATED = 16
    grpc_mock.StatusCode = StatusCode
    class RpcError(Exception): pass
    grpc_mock.RpcError = RpcError
    sys.modules["grpc"] = grpc_mock

try:
    import cv2
except (ImportError, ModuleNotFoundError):
    import types
    cv2_mock = types.ModuleType("cv2")
    class MockVideoCapture:
        def __init__(self, *args, **kwargs):
            self._frame = 0
        def isOpened(self): return True
        def read(self):
            if self._frame < 120:
                self._frame += 1
                import numpy as np
                return True, np.zeros((720, 1280, 3), dtype=np.uint8)
            return False, None
        def release(self): pass
        def get(self, prop): return 120 if prop == 7 else (10.0 if prop == 5 else 0)
    class MockVideoWriter:
        def __init__(self, *args, **kwargs): pass
        def write(self, frame): pass
        def release(self): pass
        @staticmethod
        def fourcc(*args): return 0
    cv2_mock.VideoCapture = MockVideoCapture
    cv2_mock.VideoWriter = MockVideoWriter
    cv2_mock.VideoWriter_fourcc = MockVideoWriter.fourcc
    cv2_mock.CAP_PROP_FRAME_COUNT = 7
    cv2_mock.CAP_PROP_FPS = 5
    cv2_mock.CAP_PROP_FRAME_WIDTH = 3
    cv2_mock.CAP_PROP_FRAME_HEIGHT = 4
    cv2_mock.rectangle = lambda *a, **kw: None
    cv2_mock.putText = lambda *a, **kw: None
    cv2_mock.line = lambda *a, **kw: None
    cv2_mock.polylines = lambda *a, **kw: None
    cv2_mock.circle = lambda *a, **kw: None
    cv2_mock.FONT_HERSHEY_SIMPLEX = 0
    cv2_mock.LINE_AA = 16
    sys.modules["cv2"] = cv2_mock

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
