# Epic 1 acceptance — Foundation & shared contracts

Status: **accepted for Epic 1 scope**. Stories S01–S04 are completed. This is not a claim that the complete Traffic Digital Twin MVP or any subsequent epic is finished.

## S01 — Freeze scope and repository boundaries

- Required apps/web, apps/api, services/simulation, services/intelligence, packages/contracts, packages/scenario-config, db/migrations and db/queries exist.
- `docs/architecture.md` freezes the Browser → Go → Python gRPC boundary, ownership of validation/persistence/audit, prescribed stack, offline/demo constraints and explicit exclusions.
- The Vite/React/TypeScript application compiles and connects to chi/pgx/PostgreSQL through the same-origin Go API proxy. Python service packages declare the future SUMO/TraCI and NumPy/SciPy engine dependencies; actual engines are later-epic work.
- `docs/PRD.md` points to the supplied canonical root PRD. The standalone legacy planning checkout is preserved; its backlog is versioned as `docs/backlog.json`.

## S02 — Define typed state, event and command contracts

- Protobuf defines all twelve required domain concepts, movement state with explicit units, run commands, typed simulation/intelligence interfaces and all nine event variants.
- Generated Go and Python bindings are committed. TypeScript and JSON schema derive from the protobuf descriptor; REST network types and OpenAPI are versioned alongside them.
- The nine PRD WebSocket types are network.state, junction.state, forecast.updated, recommendation.created, recommendation.updated, incident.updated, emergency.updated, health.updated and audit.appended.
- Go and Python reject invalid versions, sources, timestamps, negative/nonfinite values and out-of-range occupancy. The live gRPC integration accepts valid Go payloads and rejects invalid ones in Python.
- The WebSocket transport emits actual component health and has a regression check for the configured frontend origin. Other event producers remain in their owning epics.

## S03 — Configure the C1–C6 network as data

- JSON contains 6 nodes, 10 directed links, physical-unit configuration, storage, turning ratios, movements, compatible phase definitions, conflict pairs and three deterministic seeds.
- C1/C3 are controlled; C2/C4/C5/C6 are boundaries. The incident retains 35% capacity; the emergency route is C6 → C3 → C1 → C2.
- Go validates unique IDs/geometry, directed connectivity, turning sums, phase coverage, conflict completeness, compatible greens, positive min/max/clearance bounds and scenario seeds/routes.
- Negative tests cover corrupt geometry, duplicate IDs/seeds, missing links/conflicts, bad timing/turning ratios, boundary phases and disconnected routes.
- React draws supplied geometry and supports keyboard/touch inspection; a replacement-network test verifies nodes are not hard-coded in React.

## S04 — Create Go API and useful persistence

- Transactional, advisory-locked migrations and generated sqlc/pgx queries cover configs, runs, recommendations, operator actions, incidents, emergencies, component health, audit and >=5-second aggregates.
- Go validates commands and exposes configuration, current-state availability, junction configuration, run history, audit pagination and component health APIs.
- Run preparation and audit insertion are atomic. The PostgreSQL integration test closes/reopens the connection, verifies saved runs and audit, rejects immutable-config rewrites, rejects audit mutation and forces an audit error to prove run insertion rolls back.
- Traffic state is validated and cloned into a mutex-protected in-memory cache. No per-frame database writes occur.
- The UI prepares durable runs for all three scenario types and displays saved history and audit. Unavailable state and unimplemented execution are explicit, not fabricated.

## Verification performed

All of these passed on the local implementation (final verification: 2026-09-17 IST):

1. `go test -race -count=1 ./apps/api/... ./db/...` with TEST_DATABASE_URL and SIMULATION_GRPC_ADDR enabled: validation, API, state isolation, frontend-origin/WebSocket regression, PostgreSQL migration/durability/atomicity and live Go→Python integration.
2. `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/pytest services/shared -q`: 8 tests, including contract/schema coverage.
3. `npm run test:ui`: 3 tests for supplied geometry, keyboard selection and invalid configuration.
4. `npm run typecheck` and `npm run build`: strict TypeScript and production Vite build.
5. `node scripts/verify-browser.mjs`: desktop/mobile UI, keyboard/Escape drawer, invalid seed, all three scenario preparations, durable reload, audit, emergency route and no page runtime errors. Screenshots saved locally under test-results/.

6. `node scripts/verify-dashboard.mjs`: all 12 epic searches, four repository-backed completions, accepted-status locking, evidence endpoint and epic overview.
7. Protobuf/TypeScript/schema regeneration reproduced identical artifact hashes.

A browser-discovered proxy-origin bug initially prevented saving runs. The fix allows only the configured frontend origin, preserves cross-origin rejection and has Go regression coverage. Mobile node shortcut buttons supplement the scaled graph.

## Scope boundaries

No trained models, SUMO execution, live state measurements, forecasting, signal actuation, full runtime safety validator, incident execution, emergency pre-clearance, CV or golden replay are claimed here. Those remain in their planned epics. The configuration timing values are synthetic engineering assumptions, not field-calibrated signal settings.

Dashboard completion is repository-backed in `docs/delivery-status.json`; completed evidence takes precedence over device-local status. GitHub PR publication requires the target repository URL and push access.
