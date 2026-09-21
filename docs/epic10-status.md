# Epic 10 acceptance evidence — emergency corridor and cross-traffic recovery

**Status:** completed on the `epic10` branch.

Epic 10 remains a deterministic, synthetic-only emergency scenario. Browser commands use the public Go API; the Go owner persists lifecycle and audit evidence through its in-process persistence module; Python remains the private gRPC simulation worker. There is no emergency dispatch integration or physical signal control.

## S31 — Track the simulated emergency route and ETA

- The seeded `ambulance_corridor` scenario follows **C6 → C3 → C1 → C2**. The simulator emits only the published lifecycle states: `scheduled`, `pre_clearance`, `priority`, `recovery`, and `complete`.
- The live state contract validates event identity, a route-aligned finite modeled ETA array, and the lifecycle enum before the API broadcasts or persists it.
- The Emergency workspace now has a route-readiness console: modeled route progress, every route point’s ETA, C3/C1’s current signal indication and transition countdown, lifecycle track, and reset-to-same-seed action.
- C6 and C2 are explicitly shown as boundary route points with **Not configured** signal state. The UI does not invent a C2 signal or promise a green wave.
- A failed, offline, unauthorised, or stale command remains disabled or presents the API error. The persistent simulation health and product-wide synthetic/no-live-control disclosure remain visible.

## S32 — Protected pre-clearance and recovery

- The Python scheduler applies emergency preference only at normal safe transition boundaries: green → amber → all-red → priority. It retains conflict validation and downstream receiving-capacity gating for every permitted movement.
- A manual mode or any timing lock makes the Go gateway reject an emergency start before it is sent to Python. The persistence module appends `emergency.rejected` with `rejected: safety_protection`, providing a durable safe outcome rather than silently overriding operator protection.
- The panel displays live non-corridor queue displacement at controlled corridor junctions plus the configured recovery-cycle bound. During recovery, the simulator’s bounded fairness selection restores cross traffic; completion is shown as live scenario state, not as a queue-clearance guarantee.
- The engine produces deterministic modeled ETAs throughout the synthetic event. It clears emergency priority after passage and reports bounded recovery/complete states; it does not claim observed vehicle position.

## Verification

- `npm run typecheck` — passed.
- `npm run test:ui` — passed: 65 tests, including the Epic 10 route-state, boundary-node, transition-countdown, and recovery-panel coverage.
- `GOCACHE=/tmp/traffic-go-build-cache go test ./apps/api/internal/httpapi` — passed, including the lock/manual rejection, audit, and unlocked start regression.
- `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m pytest services/simulation/tests/test_engine.py -x` — passed: 10 deterministic simulation tests, including all emergency lifecycle stages and clearance progression.
- `npm run build` — passed.

## Residual limits

- The operator identity is the repository’s local session/demo authentication boundary; a shared production identity provider remains outside this Epic’s scope.
- The simulated recovery bound describes scheduler cycles, not a real-road clearance SLA. No physical controller, dispatch feed, or real emergency vehicle is connected.
