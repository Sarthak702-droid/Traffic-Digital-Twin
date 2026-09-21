# Simulation boundary

Python 3.12+ aggregate cell-flow runtime. It implements seeded boundary demand, finite link/cell storage, external backlog, virtual signal-controlled junction transfers, reset/get-state/stop RPCs and 1 Hz streaming for C1/C3. No vehicle identities, external traffic binaries, database credentials or browser HTTP routes belong here.

Run from root: `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m services.shared.server simulation --port 50051`.

Install dependencies from `services/requirements.lock`. Set `TWIN_ENGINE=aggregate` (the default) and `SIMULATION_ADDR=127.0.0.1:50051` for Go. Aggregate command receipts are stored under ignored `.runtime/aggregate/`.

Test from root: `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m pytest services/simulation/tests -q`.

The incident scenario applies an explicit C3 discharge-capacity multiplier only while active. Emergency progress and ETA are modeled events, not a measured vehicle location. Metrics are labeled `flow-metrics-v1`; link stock, density, queue estimate and modeled speed are aggregate outputs.
