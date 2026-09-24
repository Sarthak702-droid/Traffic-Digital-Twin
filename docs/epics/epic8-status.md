# Epic 8 acceptance evidence — audit, health and replay resilience

**Status:** completed on the `epic8` branch.

Epic 8 is implemented through the public Go API, its in-process PostgreSQL persistence module, and the existing browser REST/WebSocket contracts. The private Python intelligence service remains compute-only over gRPC.

## S25 — Durable audit history

- Recommendation and operator-decision writes persist the actor, run, recommendation ID, before/after plan, reason, safety result and timestamp in the append-only `audit_events` table.
- `GET /api/v1/audit?after=&limit=` uses a durable sequence cursor, and `/ws/v1/live` emits `audit.appended` from the same persisted history.
- Decision persistence commits recommendation state, operator action, audit record and idempotent command outcome as one transaction. Uncertain outcomes remain available for reconciliation.

## S26 — Truthful health and degraded operation

- `/api/v1/health` and `health.updated` report the Go API, PostgreSQL, simulation and private intelligence service with a current report timestamp.
- The API explicitly reports `signal_controller: NOT CONNECTED`, `cctv: DEMO/SAMPLE`, and `emergency_api: SIMULATED`; these optional integrations are visible in the operator health panel.
- Simulation or intelligence loss suppresses recommendations. The client records the newest health frame, marks unavailable simulation data stale, and disables command actions until fresh evidence returns.

## S27 — Deterministic golden replay

- The protected `POST /api/v1/replay/{scenario}` path verifies the recording checksum and configuration ID, creates a persisted replay run, preserves event order at one-second cadence and emits the normal WebSocket event contract with `replay: true`.
- The Workspace exposes the replay control, labels replay-derived traffic, disables live mutations during replay, and explains that PostgreSQL is still required to create the run audit.

## S28 — Inspectable operator UI

- The Audit & Health view shows timestamp, event type, actor, safety outcome, affected junctions, recommendation, run ID, reason and inspectable before/after values.
- Cursor pagination is explicit and cannot advance without a newer durable cursor. The view refreshes from `audit.appended` and polling, while loading, empty and error states remain distinct.
- The health popover and the Audit & Health panel show each component’s real state and last-check timestamp. Expected demo limitations are visually distinct from a failed core dependency.

## Verification

- `GOCACHE=/tmp/traffic-go-build-cache go test ./apps/api/internal/httpapi` — passed (including health, replay safeguards and WebSocket tests).
- `npm run typecheck` — passed.
- `npm run test -w apps/web -- components/epic8.test.tsx components/epic3.test.tsx components/epic5.test.tsx components/live-panel.test.tsx lib/live.test.tsx` — passed: 5 files, 34 tests.
- `npm run build -w apps/web` — passed.
- `GOCACHE=/tmp/traffic-go-build-cache .venv/bin/python scripts/verify-epic5-integration.py` — passed: direct Go REST API, private Python gRPC intelligence, migration and audited scenario start.
- `DASHBOARD_URL=http://127.0.0.1:3012 node scripts/verify-dashboard.mjs` — passed: 14 epic searches, 25 evidence-backed completions and the locked Epic 8 evidence endpoint.
