"""Start the full local stack (Database, Backend services, and Frontend).

Delegates to scripts/start-all.py.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from start_all import main  # noqa: E402

if __name__ == "__main__":
    main()
