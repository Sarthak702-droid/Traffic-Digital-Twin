# Simulation boundary

Python 3.12+, SUMO/TraCI. Implements seeded demand, reset/get-state/stop RPCs, 1 Hz state streaming, and fixed virtual signal cycles for C1/C3. No database credentials or browser HTTP routes belong here.

Run from root: `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m services.shared.server simulation --port 50051`.

Install dependencies from `services/requirements.lock`. Set `SIMULATION_ADDR=127.0.0.1:50051` for Go. Generated SUMO files are cached under ignored `.runtime/sumo/`.

Test from root: `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m pytest services/simulation/tests -q`. SUMO needs permission to open a local TraCI socket.

The incident scenario currently changes demand only; capacity reduction is not applied. The ambulance scenario inserts an emergency vehicle but does not implement priority or recovery. See `docs/epic2-status.md` for acceptance gaps.
