#!/usr/bin/env python3
"""Unified single-command launcher for Traffic Digital Twin.
Delegates to scripts/start_all.py.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from start_all import main

if __name__ == "__main__":
    main()
