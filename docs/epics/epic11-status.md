# Epic 11 acceptance evidence — presentation, automated scenario acceptance, and offline release rehearsal

**Status:** completed on the `epic11` branch.

Epic 11 delivers the complete presentation, automated acceptance test journeys, and offline release packaging for the Predictive Traffic Digital Twin. Operating under control-room governance, the system guarantees 100% human authority and visibly preserves synthetic-only demonstration disclosure across all interfaces. Zero live physical signal actuators or road controllers are touched.

## S33 — Automate the three scenario acceptance journeys

- An automated, non-mocked acceptance test suite (`scripts/verify-epic11-scenarios.py`) exercises all three core scenarios end-to-end through the real Go gateway, private Python gRPC simulation/intelligence services, and PostgreSQL in-process persistence module:
  - **Peak Demand Surge (C6 → C3 → C1, seed 1101):** Validates deterministic run start, 1 Hz traffic telemetry, vehicle conservation physics, forward queue forecasting (+30s, +60s, +120s, +300s), early congestion warning at C1 before gridlock occurs, AGDA safety envelope bounds (10s min green – 55s max green, amber + all-red clearance intervals), and equal-seed simulated Before-vs-After comparison.
  - **C3 Incident & Bottleneck Recovery (seed 2202):** Validates typed capacity reduction controls (tested with 50% capacity ratio), proactive upstream metering at C6, downstream capacity gating, and deterministic reset generating a new run ID while preserving seed 2202 and the 50% virtual capacity ratio.
  - **Ambulance Corridor Priority (C6 → C3 → C1 → C2, seed 3303):** Validates corridor lifecycle progression (`scheduled` → `pre_clearance` → `priority` → `recovery` → `complete`), safe transitions through amber and all-red clearance, and cross-traffic fairness recovery.
  - **Safety Lock Conflict Protection:** When a timing lock is engaged on approach `C3-FROM-C6`, an emergency corridor start is rejected with HTTP 409 Conflict, and an immutable `emergency.rejected` record with `rejected: safety_protection` is written to the audit ledger. Releasing the lock via `DELETE /api/v1/locks/C3-FROM-C6` cleans up the active lock and permits subsequent emergency scheduling.
  - **Route & Error Matrix:** Verifies HTTP 400 (malformed JSON, negative seeds, out-of-bounds splits), HTTP 403 (viewer role forbidden from write mutations), HTTP 404 (non-existent junctions and recommendations), HTTP 409 (conflict/active locks), and HTTP 503 (gRPC compute offline).
  - **Concurrency:** 20 simultaneous concurrent requests executed without deadlock, race conditions, or dropped connections.
  - **Audit Pagination:** Over 100 immutable audit events generated and queried via `/api/v1/audit?limit=50&after=...`, verifying strict sequence ordering without duplicate entries across pages.

## S34 — Author the guided DGP presentation

- The Command Center provides a prominent top bar launcher: `START DGP DEMONSTRATION` (PRD §§5, 8.1).
- The 8-step executive briefing modal (`apps/web/components/dgp-presentation.tsx`) delivers an eight-minute guided briefing:
  1. *Current Network State:* C1–C6 corridor topology, 1 Hz gateway broadcasts, zero live actuator control.
  2. *Future Congestion Prediction:* Vehicle conservation physics, forward horizons (+30s, +60s, +120s, +300s), proactive spillback warning.
  3. *Coordinated Recommendation:* Coordinated green splits, strict Go safety envelopes (10s–55s, amber, all-red).
  4. *Before-vs-After Twin Simulation:* Equal-seed parallel branch simulation with 4 objective outcome metrics (queue, delay, spillback, stops).
  5. *C3 Incident Scenario:* Bottleneck detection, C6 upstream metering, observed cycle-by-cycle queue drainage.
  6. *Ambulance Corridor Priority:* C6 → C3 → C1 → C2 route, amber/all-red clearance, post-event cross-traffic fairness recovery.
  7. *Human Authority & Audit Trail:* Operator approval, modify with mandatory reason, reject, 1-click manual override, immutable PostgreSQL audit ledger.
  8. *Shadow-Pilot Recommendation:* Odisha Police TMC shadow-pilot proposal, 0% physical controller actuation risk, camera feed ingestion.
- **Presenter Preflight Checklist:** Built-in 8-point preflight inspection panel verifying PostgreSQL connection, Go gateway health, private Python gRPC compute, deterministic seeds, golden replay availability, keyboard navigation, and synthetic traffic disclosure compliance.
- **Presenter Talking Points Drawer:** Toggleable speaker script for each slide containing target duration (60s/slide, total ~8 min), executive pitch to DGP, technical truth under the hood, and anticipated leadership Q&A with crisp answers.
- **Live Telemetry & Offline Fallback:** When connected, displays live stream badges (`LIVE TWIN ACTIVE` or `GOLDEN REPLAY STREAM`) with real-time telemetry; when disconnected, displays clean `EXPLANATORY BRIEFING · OFFLINE REHEARSAL` baselines without unsupported claims.
- **Accessibility & Responsiveness:** Fully accessible via keyboard (`ArrowRight`, `ArrowLeft`, `Home`, `End`, `PageUp`, `PageDown`, `Escape`) and verified responsive on standard mobile viewports (390 × 844) with zero horizontal overflow.
- **Mandatory Disclosure:** Prominently displays `DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL` across all presentation slides.

## S35 — Package, benchmark and rehearse offline

- **Self-Contained Offline Golden Replay Bundle:** `packages/replay/` contains deterministic 480-frame (8-minute) recorded streams for all 3 scenarios (`peak_surge.jsonl.gz`, `incident_c3.jsonl.gz`, `ambulance_corridor.jsonl.gz`) with SHA256 checksums verified against `packages/replay/manifest.json`. The entire demonstration runs locally without internet connectivity.
- **Performance Benchmark Scorecard (`scripts/verify-epic11-benchmarks.py`):**
  - *First Load Latency:* **0.49 ms** (SLA Gate: < 3,000 ms) — **PASS**
  - *API Response Latency (p95):* **1.66 ms** (SLA Gate: < 150 ms) — **PASS**
  - *Scenario Start Turnaround:* **1,055.10 ms** (SLA Gate: < 5,000 ms) — **PASS**
  - *Scenario Reset Turnaround:* **39.50 ms** (SLA Gate: < 5,000 ms) — **PASS**
  - *Stream Frequency:* **1.0 Hz** (SLA Gate: 1.0 Hz) — **PASS**
  - *Rehearsal Soak & Stability:* **0.38 MB** RSS growth over 25 continuous cycles (SLA Gate: < 50 MB, zero leak) — **PASS**

## Verification Commands

- `npm run typecheck` — passed: TypeScript types checked across all workspaces.
- `npm run test:ui` — passed: 74 UI tests in Vitest including 9 new Epic 11 S34 tests for DGP briefing, preflight checklist, speaker script, keyboard navigation, and live telemetry badges.
- `npm run build` — passed: Vite production build succeeded in 777ms.
- `GOCACHE=/tmp/traffic-go-build-cache go test ./apps/api/...` — passed: all Go unit and integration tests passed, including idempotency upsert and lock cleanup.
- `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m pytest services/simulation/tests/test_engine.py services/intelligence/tests/ -x` — passed: 30 Python deterministic simulation and intelligence tests passed.
- `.venv/bin/python scripts/verify-epic11-scenarios.py` — passed: end-to-end verification of all 3 scenario journeys, safety lock protection, error matrix, concurrency, and >100 audit event pagination.
- `.venv/bin/python scripts/verify-epic11-benchmarks.py` — passed: SLA benchmark gates and offline replay package verification.
- `node scripts/verify-epic11-browser.mjs` — passed: Playwright E2E browser session on desktop and mobile viewports, generating `test-results/epic11-desktop.png` and `test-results/epic11-mobile.png`.
- `DASHBOARD_URL=http://127.0.0.1:3013 node scripts/verify-dashboard.mjs` — passed: dashboard displays Epic 11 completed with evidence links.

## Residual Limits

- Operator authentication in this demonstration uses explicit session and role headers (`X-Role: operator`); integration with a statewide SSO/IAM identity provider remains an enterprise deployment phase.
- Physical signal actuation remains strictly prohibited in this release. All signal timing and emergency green corridors are synthetic projections intended for shadow-pilot observation.
