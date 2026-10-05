import json
import sys
from pathlib import Path
from scripts.prototype_evaluation import run_virtual_suite

protocol = json.loads((Path("packages/scenario-config/prototype-evaluation-v1.json")).read_text())
res = run_virtual_suite(protocol, ".runtime/benchmark")
print(json.dumps({k: v for k, v in res.items() if k != "cases"}, indent=2))
if not res["gate_pass"]:
    sys.exit(1)
