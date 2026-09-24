# Epic 9 acceptance evidence — C3 incident and network recovery

**Status:** completed on the `epic9` branch.

Epic 9 uses the public Go API for browser commands, private Python simulation/intelligence services over gRPC, and the in-process Go PostgreSQL persistence module. The incident is virtual synthetic traffic only; no live controller or road network is affected.

## S29 — C3 capacity loss with controls

- `POST /api/v1/scenarios/incident_c3/start` accepts a typed `incident` object with the only permitted kind, `capacity_reduction`, and a bounded 10%–90% virtual capacity ratio. The normal scenario still defaults to the configured 35% C3 capacity.
- The Go API rejects incident controls for other scenarios or invalid values before it sends the private simulation command. Reset clones the accepted command, preserving its seed and selected virtual capacity.
- The simulator reflects the selected ratio, incident type, status and configured countdown in the normal traffic-state/WebSocket contract. Lifecycle transitions are persisted as incident records and append-only audit events.
- The Incident workspace provides severity controls, validation/error feedback, a reset confirmation, actual capacity, lifecycle and the affected C3 approaches. It identifies C6 as an uncontrolled boundary rather than a controlled signal.

## S30 — Storage-safe recovery evidence

- The simulation gates release when a C3 receiving link is full and preserves signal clearance. The intelligence model uses the incident’s live capacity ratio for rollout, meters upstream C3 release and scores bounded C1/C3 recovery candidates.
- The recovery view reports current upstream queue and discharge from the live simulation. It derives a queue-drain estimate in C3 cycles only while discharge is observed and no receiving link is blocked. A full/blocked link holds the release gate and makes the estimate unavailable.
- The configured recovery countdown remains separate from the observed queue-drain estimate and is explicitly not presented as a clearance guarantee.

## Verification

- `GOCACHE=/tmp/traffic-go-build-cache go test ./apps/api/internal/httpapi` — passed, including incident request validation, forwarding and reset persistence.
- `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m pytest services/simulation/tests/test_engine.py services/intelligence/tests/test_model.py services/intelligence/tests/test_epic6.py -x` — passed: 25 deterministic simulation and intelligence tests, including incident capacity override, blocked-link gating and recovery lifecycle.
- `npm run test:ui` — passed: 62 browser-component tests, including Epic 9 recovery presentation coverage.
- `npm run typecheck` and `npm run build` — passed.
- `GOCACHE=/tmp/traffic-go-build-cache .venv/bin/python scripts/verify-epic5-integration.py` — passed: regenerated Go/Python contracts, direct Go REST API, private Python gRPC compute, PostgreSQL migration and audited scenario start.
- `DASHBOARD_URL=http://127.0.0.1:3013 node scripts/verify-dashboard.mjs` — passed: 14 epic searches, 27 evidence-backed completions and the locked Epic 9 evidence endpoint.
