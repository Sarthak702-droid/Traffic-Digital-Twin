<a id="readme-top"></a>

<div align="center">

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]

<h1 align="center">Traffic Digital Twin</h1>

<p align="center">
Local virtual traffic demonstration using recorded ITD v1.2 observations, aggregate simulation, forecasts, and operator-reviewed virtual signal plans.
<br />
<strong>No live CCTV or physical signal control.</strong>
<br /><br />
<a href="docs/architecture.md"><strong>Explore the docs »</strong></a>
<br /><br />
<a href="#getting-started">View Setup</a>
·
<a href="https://github.com/Sarthak702-droid/Traffic-Digital-Twin/issues">Report Bug</a>
·
<a href="https://github.com/Sarthak702-droid/Traffic-Digital-Twin/issues">Request Feature</a>
</p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#built-with">Built With</a></li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#verification">Verification</a></li>
    <li><a href="#repository-structure">Repository Structure</a></li>
    <li><a href="#design-and-scope">Design and Scope</a></li>
  </ol>
</details>

## About The Project

Traffic Digital Twin is a synthetic MVP for corridor operations research and operator workflow prototyping.

Key capabilities:
- Recorded video-derived boundary demand from finalized ITD v1.2 windows
- Aggregate finite-capacity simulation and forecasting
- Candidate timing comparison with operator decision support
- Virtual-only plan approval with auditable workflow

Out of scope for this milestone:
- Live camera ingestion
- Physical controller actuation
- Production deployment claims

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Built With

- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [Go](https://go.dev/)
- [PostgreSQL](https://www.postgresql.org/)
- [Python](https://www.python.org/)
- [gRPC](https://grpc.io/)
- [Tailwind CSS](https://tailwindcss.com/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

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

Start local stack:

```sh
python3 scripts/bootstrap-local.py
python3 scripts/create-gateway-user.py .runtime/gateway-users.json operator --role operator
npm run build
npm start
```

Open **http://127.0.0.1:3100**.

Default ports:
- Web app: `3100`
- Go API: `8081`
- Python simulation gRPC: `50051`
- Python intelligence gRPC: `50052`
- PostgreSQL: `5433`

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

Typical local workflow:
1. Sign in with the provisioned local gateway account.
2. Select seeded synthetic scenario or configure required processed clip inputs.
3. Start a virtual run and inspect outcomes in Audit & Health.
4. Restart services and refresh to verify persistence in PostgreSQL.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Verification

```sh
go test -race ./apps/api/... ./db/...
PYTHONPATH=.:packages/contracts/gen/python .venv/bin/pytest services/shared -q
npm run test:ui
npm run typecheck
npm run build
```

Integration run with local PostgreSQL + contract endpoint:

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

<p align="right">(<a href="#readme-top">back to top</a>)</p>

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

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Design and Scope

- [Architecture](docs/architecture.md)
- [API and Architecture Alignment](docs/API-ARCHITECTURE-SPEC-ALIGNMENT.md)
- [Contracts](packages/contracts/README.md)
- [PRD](docs/PRD.md)
- [Contracts Plan](docs/contracts-plan.md)
- [Epic 1 Acceptance Evidence](docs/epics/epic1-acceptance.md)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/Sarthak702-droid/Traffic-Digital-Twin.svg?style=for-the-badge
[contributors-url]: https://github.com/Sarthak702-droid/Traffic-Digital-Twin/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Sarthak702-droid/Traffic-Digital-Twin.svg?style=for-the-badge
[forks-url]: https://github.com/Sarthak702-droid/Traffic-Digital-Twin/network/members
[stars-shield]: https://img.shields.io/github/stars/Sarthak702-droid/Traffic-Digital-Twin.svg?style=for-the-badge
[stars-url]: https://github.com/Sarthak702-droid/Traffic-Digital-Twin/stargazers
[issues-shield]: https://img.shields.io/github/issues/Sarthak702-droid/Traffic-Digital-Twin.svg?style=for-the-badge
[issues-url]: https://github.com/Sarthak702-droid/Traffic-Digital-Twin/issues
