> **Architecture alignment — 2026-09-18:** The supplied backend and API-concepts specifications are authoritative: Go exposes the public REST/WebSocket gateway and owns persistence; Python is private gRPC compute. This is a synthetic MVP and is not approved for live traffic control.

# Traffic Digital Twin

Local, synthetic demonstration software. **No live signal control.** Epic 1 provides a validated network foundation, shared contracts, durable scenario preparation and a working configuration UI. Traffic simulation, forecasts and recommendations belong to subsequent epics.

## Start

Requirements: Node.js 22+, Go 1.25+, Python 3.12+, Docker Compose. Install dependencies while online; startup uses no external APIs, fonts or maps.

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r services/requirements.lock
go mod download
docker compose up -d --wait postgres
```

Start the local Go-control-plane stack:

```sh
python3 scripts/bootstrap-local.py
npm run build
npm start
```

Bootstrap preserves an existing environment and keeps generated compute credentials in ignored `.runtime` files. Open **http://127.0.0.1:3100**. Public Go API: **8081** (or the next available loopback port); private Python simulation and intelligence gRPC services: **50051** and **50052**; PostgreSQL: **5433**. Go performs migrations and durable writes through its persistence modules. These are development startup instructions; full-stack acceptance and production deployment remain pending.

`API_ORIGIN` controls the Vite proxy. Keep private services on loopback. Local HTTP does not establish a production transport-security pass.

The existing delivery dashboard is separate: `node server.mjs` from the repository root, or `npm run dashboard`. It reads `docs/backlog.json` (the versioned copy of the original independent planning project) and repository completion evidence in `docs/delivery-status.json`. The legacy `docs/planning-dashboard` checkout remains untouched and is not required to run this project.

## Epic 1 workflow

1. Inspect the graph and select any node by click or keyboard.
2. Inspect configured lengths, storage and protected phase bounds.
3. Choose a scenario and deterministic seed; prepare a run.
4. Check the saved run and its audit entry in Audit & Health.
5. Restart Go and refresh: records remain in PostgreSQL.

Preparing a run does not start SUMO or apply signal timing. Unimplemented runtime operations fail explicitly. Empty measurements remain unavailable.

## Verification

```sh
go test -race ./apps/api/... ./db/...
PYTHONPATH=.:packages/contracts/gen/python .venv/bin/pytest services/shared -q
npm run test:ui
npm run typecheck
npm run build
```

Full integration, with local PostgreSQL and the Python contract endpoint running:

```sh
PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m services.shared.server simulation --port 50051
# In another terminal:
TEST_DATABASE_URL='postgres://traffic:traffic_demo@127.0.0.1:5433/traffic?sslmode=disable' \
SIMULATION_GRPC_ADDR=127.0.0.1:50051 \
go test -race -count=1 ./apps/api/... ./db/...
```

The PostgreSQL integration test uses a uniquely named schema and removes only its own fixtures. It tests migrations, immutable configuration, connection restart durability, append-only audit and transaction rollback when audit insertion fails. Tests without these environment variables explicitly skip the two external integrations.

Browser acceptance: install Chromium once with `npx playwright install chromium`; with production UI and Go running, `node scripts/verify-browser.mjs`. It saves screenshots under `test-results/`, checks desktop/mobile layout, keyboard inspection, all three run types, persistence on reload and audit visibility. It creates real local demo run records.

## Design and scope

See [architecture](docs/architecture.md), [API and architecture alignment](docs/API-ARCHITECTURE-SPEC-ALIGNMENT.md), [contracts](packages/contracts/README.md), [PRD](docs/PRD.md) and [Epic 1 acceptance evidence](docs/epic1-acceptance.md).
