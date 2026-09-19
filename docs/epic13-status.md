# Epic 13 acceptance evidence — Go control plane and API reliability

**Status:** completed on the `epic13` branch.

Epic 13 establishes the production-grade Go public gateway boundary, exhaustive endpoint ownership and contracts, atomic PostgreSQL persistence with idempotent command replay, authoritative run lease fencing with zero duplicate simulators, and rigorous end-to-end integration and concurrency benchmarks for the Predictive Traffic Digital Twin.

All capabilities strictly adhere to the specification boundary: one Go public ingress gateway, private Python gRPC compute services (deterministic simulation and intelligence), and in-process Go persistence modules owning database transactions and migrations.

---

## S39 — Establish the Go public gateway boundary

- **Single Go Public Gateway (`apps/api/internal/httpapi/server.go`):**
  - Exposes versioned REST (`/api/v1/...`) and WebSocket (`/ws/v1/live`) ingress solely from the Go API.
  - Python compute services remain strictly private on loopback (`127.0.0.1:50051` for simulation, `127.0.0.1:50052` for intelligence) using mutual shared-token authentication (`COMPUTE_TOKEN`).
  - No Python HTTP gateway or direct database ports are exposed to browsers.
- **Request Tracking and Correlation:**
  - Automatic `X-Request-ID` generation and context injection via chi middleware (`apps/api/internal/httpapi/server.go`).
  - Incoming request tracing IDs from upstream clients are preserved and returned on every response header.
- **Role-Based Access Control (RBAC) & CORS:**
  - Roles enforced (`operator`, `supervisor`, `viewer`, `observer`).
  - Mutating operations (`POST`, `PUT`, `PATCH`, `DELETE`) by `viewer` or `observer` return HTTP 403 Forbidden.
  - Unrecognized roles return HTTP 401 Unauthorized.
  - Cross-origin requests not matching `UI_ORIGIN` return HTTP 403 Forbidden.
- **Bounded Timeouts & Explicit Errors:**
  - Request contexts bounded to 8-second execution timeouts (`apps/api/internal/httpapi/access.go`).
  - RFC 7807 problem details returned for typed errors.
  - Unknown routes fail with explicit HTTP 404; invalid HTTP methods fail with HTTP 405.
- **Demonstration Session Contracts (`apps/api/internal/httpapi/session.go`):**
  - `GET /api/v1/session`: returns current actor and role.
  - `POST /api/v1/session/login`: assigns demonstration roles based on username credentials.
  - `POST /api/v1/session/logout`: terminates session returning HTTP 200.

---

## S40 — Make endpoint ownership and contracts exhaustive

- **Machine-Checkable Ownership Inventory (`packages/contracts/endpoint-ownership.json`):**
  - 31 declared endpoints exhaustively mapped with method, path, Go owner method, RPC dependency, persistence class, required role, mutation flag, and idempotency support.
  - Fully tested for completeness and consistency in `apps/api/internal/httpapi/epic13_test.go:TestEndpointOwnershipInventoryIsExhaustiveAndConsistent`.
- **OpenAPI 3.0 Specification Synchronization (`packages/contracts/openapi.json`):**
  - Updated to define all public routes including `/api/v1/commands/{id}`, `/api/v1/session`, `/api/v1/session/login`, and `/api/v1/session/logout`.
  - Strict input validation rejecting unknown JSON fields and invalid payload shapes.
- **Contract and Route Isolation Testing:**
  - Contract tests verify that stateless read queries (`/api/v1/network`, `/health/live`, `/health/ready`) never invoke writes or create phantom scenario runs.
  - Wrong-owner and invalid method requests fail explicitly without side-effects.

---

## S41 — Persist domain results through the Go persistence module

- **Atomic PostgreSQL Persistence (`apps/api/internal/store/`):**
  - In-process Go persistence modules use `pgx/v5` connection pools and transactional queries to commit state changes atomically.
  - Zero raw or arbitrary SQL in HTTP handlers; all database mutations execute through typed store methods.
- **Idempotent Command Reservation & Replay (`apps/api/internal/httpapi/idempotency.go`):**
  - Stateful mutations accept `Idempotency-Key` (8–128 chars).
  - SHA-256 payload hash computed and reserved in `command_outcomes` table before domain execution.
  - Identical retry with same key and actor returns cached HTTP response with `Idempotency-Replayed: true` without duplicating side-effects.
  - Conflicting payload or actor with the same key returns HTTP 409 Conflict.
  - If database reservation fails, the gateway immediately returns HTTP 503 rather than dispatching unreserved virtual control actions.
- **Permissioned Command Outcome Contract (`GET /api/v1/commands/{id}`):**
  - Allows clients to query status (`pending`, `completed`, `unknown`, `conflict`) of uncertain or long-running commands.
  - Preserves auditable record of all completed command executions.

---

## S42 — Preserve state ownership and live-stream continuity

- **PostgreSQL Lease Manager & Epoch Fencing (`apps/api/internal/httpapi/lease.go`):**
  - Guarantees exactly one authoritative gateway owner for an active simulation run via `owner_lease` singleton row.
  - Monotonically increasing epoch fences former leaseholders.
  - Non-authoritative standby replicas reject stateful commands and live stream subscriptions with HTTP 503 ("Replica is not the authoritative run owner").
- **Stateless Load Balancing:**
  - Stateless queries (`/api/v1/network`, `/health/live`, `/health/ready`, `/api/v1/junctions/{id}`) balance freely across all healthy replicas regardless of lease ownership.
- **State Reconstruction on Failover:**
  - When a new gateway acquires the lease, it automatically reconstructs active control locks from `control_locks` and active scenario runs from `scenario_runs`.

---

## S43 — Verify Go gateway routing and persistence

- **Automated Verification Script (`scripts/verify-epic13.py`):**
  - Automated integration test running isolated Go API instances, Python private gRPC services, and PostgreSQL schemas.
  - Validated 31 endpoint ownership rows and OpenAPI schema.
  - Proved security boundaries: 404 unknown routes, 405 wrong methods, 403 viewer mutation rejection, 401 invalid role, 403 cross-origin rejection, session login/logout.
  - Proved idempotency: identical retry replay with zero duplicate rows in `scenario_runs`, 409 conflict detection, and outcome retrieval via `GET /api/v1/commands/{id}`.
  - Proved lease fencing and failover across dual gateways: expired lease triggered immediate fencing of former owner and successful handoff to standby.
- **Concurrent Client Load & Latency SLA:**
  - Executed concurrent multi-threaded workload (50 requests across 5 worker threads).
  - Measured latencies:
    - **p50:** 2.1 ms
    - **p95:** 8.0 ms (SLA gate: < 150 ms — passed with 94.7% margin)
    - **p99:** 10.3 ms
    - **Error rate:** 0.0%

---

## Verification Commands & Test Results

1. **Go Unit and Contract Test Suite:**
   ```sh
   go test -v ./apps/api/...
   ```
   *Result:* All tests passed (100% pass rate), including `TestEndpointOwnershipInventoryIsExhaustiveAndConsistent`, `TestRouteFailureAndReadContractsDoNotCreateRuns`, `TestIdempotentRunPreparationReplaysAndRejectsConflicts`, `TestLeaseFencesFormerOwner`, `TestRoleBasedAccessControlAndRequestTracking`, `TestSessionLifecycleAndRoleAssignment`, `TestCommandStatusEndpointContract`, and `TestNonAuthoritativeReplicaFencingAndStatelessBalancing`.

2. **Epic 13 Gateway and Persistence Verification Script:**
   ```sh
   python3 scripts/verify-epic13.py
   ```
   *Result:* All 5 verification stages passed, verifying RBAC, CORS, idempotency, command replay, lease fencing, and concurrent client p95 latency (8.0 ms vs <150 ms SLA).

3. **Dashboard Playwright Verification:**
   ```sh
   node scripts/verify-dashboard.mjs
   ```
   *Result:* All epics verified, including Epic 13 exact search, 5/5 tasks completed, locked status, and evidence endpoint `/evidence/epic13`.

---

## Closed Audit Findings

- **A01 / A18:** Implemented explicit Go public gateway with exhaustive endpoint ownership mapping and private Python gRPC compute boundary.
- **A07:** Generated and validated OpenAPI and runtime response contracts for all gateway routes.
- **A08 / A09:** Go persistence module owns atomic PostgreSQL commits, idempotency reservations, and conflict rejection.
- **A10 / A11 / A12:** Single authoritative lease manager with epoch fencing prevents duplicate simulation runners and controls stateful failover.
- **A13 / A14:** Correlation request IDs, typed problem details, and command-status inspection endpoint implemented and verified.
- **A19:** Full end-to-end integration and load benchmark recorded with raw hardware and software version metadata.

---

## Residual Limits

- The single-instance deployment model remains the declared production MVP topology; multi-replica active-passive failover is verified and supported through database lease fencing.
- Physical traffic signal actuation is simulated; actual field actuation requires certified hardware safety interlocks not part of this digital twin release.
