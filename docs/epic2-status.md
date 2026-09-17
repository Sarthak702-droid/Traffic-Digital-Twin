# Epic 2 — implementation status

Reviewed 2026-09-17 against E02 / S05–S07 in `docs/backlog.json`.
Status: implementation in progress; not accepted as complete.

## Implemented

- S05: compile the configured network into SUMO, generate seeded demand for all three scenario IDs, start/reset through Go with persisted run activation and audit, and repeat initial conditions with the same seed.
- S06: Python gRPC stream, Go frame validation/fan-out, browser WebSocket subscription, live movement metrics, reconnect and stale/disconnected indicators. Frames include run ID, time, source, scenario and seed.
- S07: configured min/max green bounds, amber and all-red durations; deterministic fixed signal cycles; current phase, countdown, permissions and downstream storage estimates.

## Not implemented or incomplete

- Demand generation does not use configured movement turning ratios; demand rates and surge windows are coded in the generator.
- The simulation engine does not independently reject conflicting or invalid phase configurations before applying them. The current fixture is covered by a conflict check in the simulation tests; this is not a general runtime safety validator.
- No distinct pedestrian/clearance constraint model beyond configured amber/all-red stages, or command to apply a proposed alternative signal plan. Broader safety and recommendation work belongs to later epics.
- No dedicated automated coverage for the new Go start/reset/stream failure paths or browser live-state/start/reset/reconnect flows.
- Observation smoothing is absent. Current synthetic rates are explicitly displayed as raw one-second counts expressed per minute; noisy external observation handling remains future work.

## Acceptance still to verify

- Full PostgreSQL → Go → Python → WebSocket → browser start/reset journey for each scenario.
- Measured state-to-browser latency below 500 ms and sustained 1 Hz delivery.
- End-to-end start/reset below 5 seconds, including persistence and browser response. Engine-only reset timing passes; cold network compilation and the full request path are not covered by that assertion.
- Exact stage-duration assertions and broader configuration-bound tests. Existing tests check transition order, nonconflicting green permissions and conservation on the supplied fixture.

## Later-epic behavior not present

- `incident_c3` changes demand but does not apply `capacity_ratio=0.35`, blockage, incident lifecycle or recovery (E09).
- `ambulance_corridor` inserts an ambulance on its configured route but has no ETA, pre-clearance, priority sequence or cross-traffic recovery (E10).
- Forecasting, optimization, before/after comparison, operator recommendation decisions and golden replay remain later-epic scope.

## Verification evidence

- Simulation suite: 5 tests passed with local TraCI sockets permitted, covering all three deterministic resets, vehicle conservation, phase transitions and an invalid command.
- Frontend TypeScript check: passed.
- `go test ./...`: passed with build-cache and local-socket permissions. This does not substitute for the pending full-stack acceptance journey.
- Existing frontend unit suite: 3 tests passed. These do not establish the new live integration acceptance criteria.
- `git diff --check`: passed.
