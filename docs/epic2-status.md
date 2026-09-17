> **Revalidation notice — 2026-09-17:** Revalidated and accepted against revised gateway/writer boundaries, mode contracts, and production release gates. Seeded SUMO simulation, runtime safety validation, 1 Hz observation smoothing, WebSocket tunnel via Python gateway, and virtual signal state are active and verified. Stories S05–S07 are completed.

# Epic 2 — implementation status

Reviewed 2026-09-17 against E02 / S05–S07 in `docs/backlog.json`.
Status: Complete; all acceptance criteria met and verified.

## Implemented

- S05: compile the configured network into SUMO, generate seeded demand for all three scenario IDs (`peak_surge`, `incident_c3`, `ambulance_corridor`) using configured turning ratios and scenario demand rates, start/reset through Go with persisted run activation and audit, and repeat initial conditions identically with the same seed.
- S06: Python gRPC stream, Go frame validation/fan-out, browser WebSocket subscription, live movement metrics with exponential observation smoothing (PRD §16), reconnect and stale/disconnected indicators. Frames include run ID, time, source, scenario, seed, and active plan.
- S07: configured min/max green bounds, amber, all-red, clearance and conflict constraints enforced by a runtime safety validator; deterministic fixed and alternative signal cycles; current phase, countdown, permissions, and downstream storage estimates.

## Completed improvements

- **Demand generation turning ratios & scenario rates**: `write_demand` draws turns conditionally based on movement `turning_ratio` at each controlled node and respects scenario-configured rates (`base_rate_vps`, `feeder_rate_vps`, `surge_rate_vps`, `surge_start_s`, `surge_end_s`, `demand_duration_s`).
- **Runtime independent safety validator**: `validate_runtime_safety` in `services/simulation/safety.py` validates all signal states at runtime before applying them to SUMO. Detects and rejects conflicting green movements across the entire network, green permissions during amber or all-red/clearance, and timing bounds violations. Fails safe to all-red upon any violation.
- **Pedestrian and clearance constraint enforcement**: `all_red_s >= pedestrian_clearance_s` is strictly validated and asserted across full cycles on all controlled junctions. `ApplyPlan` gRPC endpoint and Go API bounded plan modifications are supported and validated.
- **Observation smoothing**: Implemented exponential smoothing for `arrival_rate_vpm`, `departure_rate_vpm`, and `avg_speed_kph` in `services/simulation/engine.py` per PRD §16, dampening discrete one-second rate jumps while preserving exact integer vehicle conservation (`arrivals_total - departures_total == vehicle_count`).
- **Dedicated automated Go test coverage**: `simulation_test.go` covers all component health states, input validation, launch failure modes (gRPC reset error 503, mismatched run/seed/scenario 502, contract validation error 502), frame filtering (mismatched runs, out-of-order frames), and non-blocking subscriber delivery.
- **Dedicated browser live-state coverage**: `live-panel.test.tsx` and `live.test.tsx` cover waiting, disconnected, stale/no-fresh-data, live measurements, signal strip countdowns, golden replay mode, controlled junction inspector, and boundary nodes.

## Verification evidence

- **Simulation test suite**: 20 tests passed (`services/simulation/tests/test_engine.py`, `test_safety.py`, `test_service.py`), verifying repeatable seeded reset across all 3 scenarios, vehicle conservation, runtime safety validation, exact stage durations, observation smoothing, and incident/emergency handling.
- **Go test suite**: All tests passed (`go test -v ./...` in `apps/api`), including `simulation_test.go`, `workflow_integration_test.go`, `decision_test.go`, `server_test.go`, `config_test.go`, `contracts_test.go`, and `store_test.go`.
- **Frontend test suite**: 13 tests passed (`pnpm --prefix apps/web test`), covering `live-panel.test.tsx`, `live.test.tsx`, and `network.test.tsx`.
- **Frontend TypeScript check**: `pnpm --prefix apps/web exec tsc --noEmit` passed with 0 errors.
- **End-to-end acceptance verification (`scripts/verify-epic2.mjs`)**:
  - Full PostgreSQL → Go → Python → WebSocket → Browser start/reset journey for `peak_surge`, `incident_c3`, and `ambulance_corridor`.
  - Start times: 170–392 ms (well below 5,000 ms threshold).
  - Reset times: 140–337 ms (well below 5,000 ms threshold).
  - State-to-browser delivery latency: 8–26 ms (well below 500 ms threshold).
  - Sustained delivery: 1.000 Hz cadence across 61 samples.
  - Reconnect and golden replay fallback: passed.
