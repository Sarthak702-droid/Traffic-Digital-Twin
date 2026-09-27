#!/usr/bin/env python3
"""E02 evaluation entry point for recorded and synthetic model evidence."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "packages/contracts/gen/python"))
from scripts.prototype_evaluation import main

if __name__ == "__main__":
    main()
