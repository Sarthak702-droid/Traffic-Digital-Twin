> **Architecture alignment — 2026-09-18:** Go is the public REST/WebSocket control plane and persistence owner; Python services are private gRPC compute services. This repository is a synthetic engineering prototype and is **not** approved for live traffic control.

# Traffic Digital Twin

Traffic Digital Twin is a local operator-focused prototype for evaluating **virtual traffic signal plans** using:
- Recorded video-derived boundary demand
- Aggregate finite-capacity traffic simulation
- Forecasting and candidate plan comparison
- Audited operator approval/reject workflows

It does **not** connect to live CCTV and does **not** actuate physical traffic controllers.

## Key capabilities

- Authenticated operator workflows with role-based control actions
- Recorded-video observation ingestion for demand inputs
- Forecast horizons at 30/60/120/300 seconds (when eligible)
- Baseline vs candidate virtual plan scoring from the same snapshot
- Safe-boundary virtual plan application with durable audit trail
- Support for both:
  - original two-controlled-junction graph
  - synthetic three-controlled-junction graph

## Tech stack

- **Web UI:** React + TypeScript + Vite (`apps/web`)
- **Public API / Control plane:** Go + PostgreSQL (`apps/api`, `db`)
- **Compute services:** Python gRPC (`services/simulation`, `services/intelligence`, `services/vision`)
- **Shared contracts/config:** protobuf + JSON/TS packages (`packages/contracts`, `packages/scenario-config`, `packages/camera-config`)

## Prerequisites

- Node.js 22+
- Go 1.25+
- Python 3.12+
- Docker Compose

Install all dependencies while online; runtime is intended to work without external APIs/fonts/maps.

## Quick start

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r services/requirements.lock
go mod download
docker compose up -d --wait postgres
```

Start local services:

```sh
python3 scripts/bootstrap-local.py
python3 scripts/create-gateway-user.py .runtime/gateway-users.json operator --role operator
npm run build
npm start
```

Open the UI at **http://127.0.0.1:3100**.

Default local ports:
- Go API: `8081`
- Python simulation gRPC: `50051`
- Python intelligence gRPC: `50052`
- PostgreSQL: `5433`

## Authentication notes

- There is **no default password**.
- Create users via `scripts/create-gateway-user.py`; credentials are stored in ignored `.runtime` files.
- Session and role enforcement is owned by the Go control plane.

## Operator workflow (prototype)

1. Sign in and select a scenario type (peak/incident/emergency) or video-backed demand path.
2. Start a virtual run and inspect finalized observations.
3. Compare baseline vs bounded candidate plans.
4. Approve/modify/reject with explicit reason handling.
5. Apply approved plan at safe boundary; review audit records.

## Verification

Run core checks:

```sh
go test -race ./apps/api/... ./db/...
PYTHONPATH=.:packages/contracts/gen/python .venv/bin/pytest services/shared -q
npm run test:ui
npm run typecheck
npm run build
```

Browser acceptance (with Go + UI running):

```sh
npx playwright install chromium
node scripts/verify-browser.mjs
```

## Repository layout

```text
apps/        # Go API and React/Vite web app
db/          # PostgreSQL migrations and sqlc queries
docs/        # Architecture, plans, PRD and acceptance evidence
packages/    # Shared contracts, topology, camera/scenario configs
reports/     # Verification and benchmark artifacts
scripts/     # Bootstrap, validation and utility scripts
services/    # Python gRPC simulation/intelligence/vision services
tests/       # Integration and end-to-end tests
```

## Scope and constraints

- Prototype-only: no production deployment guarantees
- Recorded clips are immutable evidence; virtual plans do not alter source footage
- No live RTSP ingestion in this milestone
- Physical controller integration is intentionally out of scope

## Additional references

- [Implementation Plan](docs/IMPLEMENTATION-PLAN.md)
- [Worktree Execution Plan](docs/WORKTREE-EXECUTION-PLAN.md)
- [API & Architecture Alignment](docs/API-ARCHITECTURE-SPEC-ALIGNMENT.md)
- [Contracts Plan](docs/contracts-plan.md)
- [Architecture Overview](docs/architecture.md)
