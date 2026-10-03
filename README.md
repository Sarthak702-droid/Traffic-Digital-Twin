<div align="center">

# Traffic Digital Twin

Local virtual traffic demonstration with recorded ITD v1.2 video analytics, aggregate network flow, forecasts, and operator-reviewed virtual signal plans.

**No live CCTV or physical signal control.**

</div>

## Table of Contents

- [About The Project](#about-the-project)
- [Built With](#built-with)
- [Getting Started](#getting-started)
- [Verification](#verification)
- [Repository Structure](#repository-structure)
- [Design and Scope](#design-and-scope)

## About The Project

Traffic Digital Twin is a synthetic MVP for corridor operations research and operator workflow prototyping.

It supports:

- Recorded video-derived boundary inputs (ITD v1.2 finalized windows)
- Aggregate finite-capacity simulation
- Forecast generation and candidate timing comparison
- Operator-reviewed virtual plan approval with auditability

It does **not** support live traffic actuation, physical controller control, or production deployment.

<p align="right">(<a href="#table-of-contents">back to top</a>)</p>

## Built With

- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [Go](https://go.dev/)
- [PostgreSQL](https://www.postgresql.org/)
- [Python](https://www.python.org/)
- [gRPC](https://grpc.io/)
- [Tailwind CSS](https://tailwindcss.com/)

<p align="right">(<a href="#table-of-contents">back to top</a>)</p>

## Getting Started

### Prerequisites

- Node.js 22+
- Go 1.25+
- Python 3.12+
- Docker Compose

### Installation

Install dependencies while online:

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r services/requirements.lock
go mod download
docker compose up -d --wait postgres
```

Start the local Go control-plane stack:

```sh
python3 scripts/bootstrap-local.py
python3 scripts/create-gateway-user.py .runtime/gateway-users.json operator --role operator
npm run build
npm start
```

Open http://127.0.0.1:3100.

Default local ports:

- Web app: `3100`
- Go public API: `8081`
- Python simulation gRPC: `50051`
- Python intelligence gRPC: `50052`
- PostgreSQL: `5433`

### Epic 1 Operator Flow

1. Sign in using the provisioned local gateway account.
2. Select synthetic seeded scenario or configure required processed clip inputs.
3. Start a virtual run and inspect outcomes in Audit & Health.
4. Restart Go and refresh to verify persistence in PostgreSQL.

<p align="right">(<a href="#table-of-contents">back to top</a>)</p>

## Verification

```sh
go test -race ./apps/api/... ./db/...
PYTHONPATH=.:packages/contracts/gen/python .venv/bin/pytest services/shared -q
npm run test:ui
npm run typecheck
npm run build
```

Full integration with local PostgreSQL and Python contract endpoint:

```sh
TWIN_ENGINE=aggregate PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m services.shared.server simulation --port 50051
# In another terminal:
TEST_DATABASE_URL='******127.0.0.1:5433/traffic?sslmode=disable' \\
SIMULATION_GRPC_ADDR=127.0.0.1:50051 \\
go test -race -count=1 ./apps/api/... ./db/...
```

Browser acceptance:

```sh
npx playwright install chromium
node scripts/verify-browser.mjs
```

<p align="right">(<a href="#table-of-contents">back to top</a>)</p>

## Repository Structure

```text
├── apps/                    # Frontend and backend application code
│   ├── api/                 # Go API gateway, orchestrator, and PostgreSQL store
│   └── web/                 # React/Vite operator dashboard and UI panels
├── dashboard/               # Delivery tracking dashboard server and client
├── db/                      # PostgreSQL migrations and sqlc query definitions
├── docs/                    # Architecture guides, PRDs, and delivery plans
├── packages/                # Shared contracts, scenarios, and configs
├── reports/                 # Verification audits, benchmarks, and manifests
├── scripts/                 # Development and verification automation
├── services/                # Private Python gRPC compute services
└── tests/                   # End-to-end integration test suites
```

<p align="right">(<a href="#table-of-contents">back to top</a>)</p>

## Design and Scope

See:

- [Architecture](docs/architecture.md)
- [API and Architecture Alignment](docs/API-ARCHITECTURE-SPEC-ALIGNMENT.md)
- [Contracts](packages/contracts/README.md)
- [PRD](docs/PRD.md)
- [Contracts Plan](docs/contracts-plan.md)
- [Epic 1 Acceptance Evidence](docs/epics/epic1-acceptance.md)

<p align="right">(<a href="#table-of-contents">back to top</a>)</p>
