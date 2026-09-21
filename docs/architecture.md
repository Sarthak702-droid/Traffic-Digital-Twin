# Backend architecture aligned to the supplied specifications

**Implemented architecture:** Browser → Go API gateway and orchestration (`apps/api/cmd/api`) → PostgreSQL through Go persistence modules. Private Python simulation (`services/simulation`) and intelligence (`services/intelligence`) services are reached only through typed gRPC/Protobuf calls from Go.

The Go process owns public REST and WebSocket ingress, request/correlation IDs, validation, operator authorization, safety validation, audit records, migrations, and transactional durable writes through pgx/sqlc-backed repositories. Python computes forecasts, candidate plans, aggregate finite-capacity flow simulations, and optional CV aggregates; it never exposes the public API or writes authoritative business data. The MVP deliberately has no Python HTTP gateway and no separately deployed Go DB-writer service.

See [API and architecture alignment](API-ARCHITECTURE-SPEC-ALIGNMENT.md), [delivery plan](DELIVERY-PLAN.md), and the supplied backend and API-concepts specifications.

The foundation notes below detail the component layout, contracts, and data-driven configuration.

---

# Epic 1 — architecture and scope freeze

Sources: [PRD](PRD.md), root `AGENT.MD`, stories S01–S04 in the delivery backlog.

The product is a local demonstration with synthetic traffic and sample video only. It never connects to physical signals or Odisha CCTV. No ANPR, facial recognition, cross-camera identity tracking, Kafka, Redis, Kubernetes, service mesh, RL or GNN is introduced.

## Boundaries

Browser → same-origin Vite proxy → Go/chi API → PostgreSQL and Python gRPC.

- `apps/web`: Vite / React 19 / strict TypeScript, Tailwind, shadcn-style Radix primitives, TanStack Query for API state, Zustand for selection. ECharts is available for later forecasting; no empty or invented charts.
- `apps/api`: request validation, immutable config registration, durable run preparation and atomic audit, in-memory high-frequency state and WebSocket transport. The seeded local operator is `demo-operator`; this is not a multi-user authentication system.
- `services/simulation`: Python gRPC boundary; the default provider is the aggregate CTM-style flow engine with no per-vehicle runtime state.
- `services/intelligence`: Python gRPC boundary; NumPy/SciPy forecasting and optimization belong to later epics. Python has no persistence connection.
- `packages/contracts`: versioned protobuf, generated Go/Python and TypeScript, JSON schema, OpenAPI and fixtures.
- `packages/scenario-config`: graph data, engineering timing assumptions, movement conflicts and deterministic scenario definitions.
- `db`: transactional versioned migrations, sqlc queries and generated pgx bindings.

The browser never calls Python. Go/Python communicate using generated `traffic.v1` gRPC stubs. Both languages validate the state boundary, including finite nonnegative units, occupancy range, identifiers, version and source. Schema version `1.0` is independent of the protobuf package `v1`.

## Epic 1 behavior

The UI inspects configuration, not traffic measurements. The Go state endpoint returns 503 until a validated simulator state is present. No random traffic numbers, completed scenario claims, estimates of impact or dummy recommendations are displayed.

`POST /api/v1/runs` prepares a persisted scenario/seed/mode record plus an audit entry in one transaction. Aggregate simulation starts only through the private provider after durable preparation. A transaction failure leaves neither record behind. Runs survive restart and configuration is immutable per ID: changing config requires a new ID. Startup validates the file before registering it or listening.

The simulator/state execution APIs and recommendation commands have explicit 501/503 responses until their owning epics. Every action remains subject to the future safety/application boundary. The UI cannot approve a signal plan prematurely.

Migrations use a transaction and advisory lock and are idempotent. Audit rows reject updates/deletes via a database trigger. This is protection against application rewrites, not a claim against a database administrator. JSON values remain structured objects, not base64. State is copied into a mutex-protected cache; only aggregates >=5 seconds have a persistence table.

## Configuration and engineering assumptions

C1 and C3 are controlled; C2/C4/C5/C6 are boundaries. Coordinates, links, lengths, lanes, storage, turning ratios, movements, phases and routes are loaded from JSON. React has no embedded geometry. Lengths and capacities are synthetic engineering parameters, not measurements.

Protected incoming approaches are served independently. Every pair from different approaches conflicts conservatively; each phase contains compatible movements from one approach. Green is 10–55 seconds, amber 3 seconds, all-red 2 seconds in this configuration. These bounds are demo assumptions, not validated field settings. Conflict completeness and phase coverage are validated. Pedestrian timing and full runtime safety sequencing remain Epic 5 and cannot be claimed from this configuration validator.

Exactly three seeds are defined: peak_surge 1101, incident_c3 2202 and ambulance_corridor 3303. The incident retains 35% capacity. Routes must follow directed links.

## Operational constraints

All listeners default to loopback: UI 3100, Go 8081, PostgreSQL 5433, Python contract services 50051/50052. Mutations reject cross-origin requests, oversized/unknown JSON fields and invalid commands. Database failures are explicit, never silently replaced by ephemeral success. The API uses bounded database contexts and graceful HTTP shutdown.

The PostgreSQL Compose credentials are only for an isolated local demo; they are not deployment secrets. Install dependencies once while online; the resulting application, fonts, topology and persisted data need no external service at runtime. Full golden replay and offline distribution are later epics.
