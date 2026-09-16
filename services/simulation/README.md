# Simulation boundary

Python 3.12+, SUMO/TraCI. Epic 1 provides the generated gRPC interface and request validation only. Seeded SUMO execution, phase application and streaming are Epic 2; reset/get-state RPCs return UNIMPLEMENTED until then. No database credentials or browser HTTP routes belong here.

Run from root: `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m services.shared.server simulation --port 50051`.
