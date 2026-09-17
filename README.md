> **Production readiness — 2026-09-17: not ready.** Gateway/writer and UX remediation are in progress. See [verified implementation checkpoint](docs/REMEDIATION-STATUS.md) for passing checks and remaining blockers. The [audit](docs/UX-PRODUCTION-AUDIT.md) records the pre-fix baseline; historical epic acceptance does not approve production.

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

Prepare the new local gateway/writer stack (the writer owns migrations):

```sh
python3 scripts/bootstrap-local.py
python3 scripts/create-gateway-user.py .runtime/users.json operator --role operator
docker compose exec -T postgres psql -U traffic -d traffic < scripts/init-local-db.sql
npm run build
python3 scripts/dev-stack.py
```

Bootstrap preserves an existing environment. Password entry is interactive. Generated secrets remain in ignored `.runtime` files. Open **http://127.0.0.1:3100** and sign in. Public gateway: **8080**; private Go domain: **8081**; internal gateway: **8002**; Go writer: **8083**. PostgreSQL: **5433**. The domain uses a read-only database account; only the writer uses write credentials. These are development startup instructions; full-stack acceptance and production deployment remain pending.

`.env.example` documents overrides. Next's proxy reads `API_ORIGIN`; rebuild Next when changing it. Keep private services on loopback. Local HTTP does not establish a production transport-security pass.

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

See [architecture](docs/architecture.md), [contracts](packages/contracts/README.md), [PRD](docs/PRD.md) and [Epic 1 acceptance evidence](docs/epic1-acceptance.md).
