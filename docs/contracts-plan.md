# Traffic Digital Twin — Contracts & Time Semantics Plan (T02)

This document records the existing T02 time/observation design and the contract constraints for the [functional prototype milestone](IMPLEMENTATION-PLAN.md). The schema below describes the current `camera-observation-v1` shape; the additional source, forecast, plan and report fields are proposed requirements for C00/C01 in the [worktree task board](WORKTREE-EXECUTION-PLAN.md), not claims that the running services already expose them. The C1–C6 camera table is the current example profile, not a topology rule.

## 1. Clocks & Time Semantics

The system distinguishes five time coordinates:

1. **`source_time_s` (Source Clock)**:
   - Video presentation timestamp relative to clip start ($t=0$ at start of chosen segment).
   - Frame timestamps are calculated via frame index / FPS or video container PTS; the chosen method and any segment offset are recorded with the source.
   - Immutable; independent of wall-clock processing speed.

2. **`event_time_s` (Detection / Crossing Clock)**:
   - Timestamp in `source_time_s` when an eligible tracked bounding box reference point (bottom center) crosses the defined counting segment in the valid direction.

3. **`available_at_source_s` (Availability Coordinate)**:
   - Source-time watermark at which a finalized observation window $[t_{start}, t_{end})$ is eligible for downstream consumption (`available_at_source_s >= window_end_s`). Processing completion is also recorded in wall-clock time; a slow worker cannot make a bin available before it actually exists.
   - No consumer or forecasting algorithm may access a window before it is finalized and available. Missing, late, duplicate and out-of-order windows have explicit status; missing counts are not zero counts.

4. **`simulation_time_s` (Virtual Traffic Clock)**:
   - Discrete 1-second ticks ($dt = 1.0\text{s}$) representing the virtual network time. The configured run declares the mapping between source and simulation clocks; independent clips are never treated as a synchronized physical corridor.
   - Causal delayed uniform release: a finalized source window $[t-d, t)$ with mass $M$ becomes available at source coordinate $a \ge t$. Its declared run mapping sets simulation availability $A$; the mass releases across simulation interval $[A, A+d)$ at rate $M/d$ veh/s. The existing profile uses $d=5$ seconds and $a=t$ when processing is ready. Admission blocked by finite storage leaves offered mass in boundary backlog.
   - The UI shows the actual derived-input age and last completed window, rather than assuming a constant 5-second lag.

5. **`wall_clock`**: Used for processing completion, orchestration, latency benchmarking, worker heartbeats, session expiry and audit timestamps. It is not interchangeable with source or simulation time.

---

## 2. Authoritative Data Schemas

### 2.1 CameraObservation Schema (`camera-observation-v1`)

The current schema uses the legacy canonical ITD class key `pedestrain`; changing it requires a versioned migration, not a silent spelling correction. `validation_level` describes a recorded review event: detector output alone does not earn `agent_reviewed` or `independently_verified`. C00 must reconcile existing emitters that currently set `agent_reviewed` automatically. `processing_mode: online_inference` means fresh inference in this version; it does not establish real-time or 12-camera throughput.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CameraObservation",
  "type": "object",
  "required": [
    "schema_version",
    "observation_id",
    "camera_id",
    "clip_id",
    "session_id",
    "direction_id",
    "window_start_s",
    "window_end_s",
    "available_at_source_s",
    "crossings_veh",
    "counts_by_class",
    "flow_vpm",
    "queue_visible_veh_estimate",
    "queue_status",
    "speed_kph",
    "speed_status",
    "observation_status",
    "validation_level",
    "media_source",
    "processing_mode"
  ],
  "properties": {
    "schema_version": {"type": "string", "const": "camera-observation-v1"},
    "observation_id": {"type": "string"},
    "camera_id": {"type": "string"},
    "clip_id": {"type": "string"},
    "session_id": {"type": "string"},
    "direction_id": {"type": "string", "enum": ["approaching", "departing", "both"]},
    "window_start_s": {"type": "number", "minimum": 0},
    "window_end_s": {"type": "number", "minimum": 0},
    "available_at_source_s": {"type": "number"},
    "crossings_veh": {"type": "integer", "minimum": 0},
    "counts_by_class": {
      "type": "object",
      "properties": {
        "two_wheeler": {"type": "integer"},
        "autorickshaw": {"type": "integer"},
        "car": {"type": "integer"},
        "bus": {"type": "integer"},
        "lcv": {"type": "integer"},
        "truck": {"type": "integer"},
        "bicycle": {"type": "integer"},
        "pedestrain": {"type": "integer"}
      }
    },
    "flow_vpm": {"type": "number", "minimum": 0},
    "queue_visible_veh_estimate": {"type": ["integer", "null"]},
    "queue_status": {"type": "string", "enum": ["estimated_visible_region", "unavailable", "geometry_invalid", "degraded"]},
    "speed_kph": {"type": ["number", "null"]},
    "speed_status": {"type": "string", "enum": ["uncalibrated", "calibrated", "unavailable"]},
    "observation_status": {"type": "string", "enum": ["valid", "degraded", "invalid"]},
    "validation_level": {"type": "string", "enum": ["provisional_unreviewed", "agent_reviewed", "independently_verified"]},
    "media_source": {"type": "string", "enum": ["recorded_video", "synthetic_replay", "live_stream"]},
    "processing_mode": {"type": "string", "enum": ["cached_observations", "online_inference"]},
    "geometry_hash": {"type": "string"},
    "model_hash": {"type": "string"}
  }
}
```

### 2.2 PredictionSnapshot Schema (`prediction-snapshot-v1`)

Sanitized complete traffic state at simulation time $t$:
- `snapshot_id`: deterministic hash of run, time, and cell states.
- `simulation_time_s`: integer second.
- `cells`: map of link/cell occupancy (`veh`), queue length, waiting age.
- `boundary_backlogs`: map of external arrival queues waiting to enter receiving links.
- `cumulative_totals`: `cumulative_offered_external_demand`, `cumulative_boundary_exits`, `current_internal_stock`.
- `signal_states`: current active phase, elapsed phase duration, min/max bounds.
- `pending_plan`: approved/modified timing adjustments pending safe phase boundary switch.
- `released_demand_commitments`: remaining fractions of already available 5s bins waiting to be offered.
- **Sanitizer Rule**: Strips all future scenario events, future video bins, or random seed generators to prevent causal leakage into predictors.

For the prototype, the snapshot and analysis contract must also carry run ID, authoritative source-session ID, latest finalized-window watermark, snapshot sequence, configuration/model/metric versions and forecast origin. Bound history by run, source session and boundary; reset it on identity change. A display-only video seek leaves the authoritative input unchanged. A seek or restart that changes the input session invalidates dependent forecasts, comparisons and recommendations in Go and the UI. Approval rechecks this identity, even if a browser holds an old recommendation ID.

C00/C01 must specify forecast method, input age/quality, per-horizon availability (30/60/120/300 seconds), unavailable uncertainty where unsupported, and separate `recommend`, `no_action` and `cannot_evaluate` outcomes. They must specify corridor plan activation/offset semantics, comparable KPI units and window, and report provenance. A zero measured count remains distinct from an absent or stale observation. These fields are not asserted to exist in `camera-observation-v1` or the current protobuf.

### 2.3 Mass Conservation Identity

The aggregate simulation strictly satisfies, counting offered mass only after its causal release and including mass denied admission in boundary backlog:
$$\text{initial\_internal\_stock} + \sum \text{cumulative\_offered\_external\_demand} = \text{current\_internal\_stock} + \sum \text{boundary\_backlog} + \sum \text{cumulative\_boundary\_exits}$$

---

## 3. Boundary Camera Roles & Topology

The table is the current C1–C6 example mapping. The functional prototype moves this mapping into validated scenario/camera configuration and adds a synthetic three-controlled-junction network. An internal-link camera cannot also inject its observed count as new boundary mass. Road lengths, capacities, turning ratios and vehicle-space assumptions remain explicitly synthetic unless calibrated. Independent sample clips cannot support claims of measured corridor flow or speed without physical calibration.

| Camera Slot | Virtual Direction | Role in Aggregate Simulation |
|---|---|---|
| **CAM-01** | C2 $\rightarrow$ C1 | Authoritative external boundary input 1 |
| **CAM-02** | C4 $\rightarrow$ C1 | Authoritative external boundary input 2 |
| **CAM-03** | C5 $\rightarrow$ C1 | Authoritative external boundary input 3 |
| **CAM-04** | C3 $\rightarrow$ C1 | Internal-link analytics only (no mass injection) |
| **CAM-05** | C1 $\rightarrow$ C3 | Internal-link analytics only (no mass injection) |
| **CAM-06** | C6 $\rightarrow$ C3 | Authoritative external boundary input 4 |

CAM-07 through CAM-12 may be processed as independent analytics inputs or benchmarks without injecting duplicate traffic. Their simultaneous processing is subject to measured CPU/RAM, freshness and recommendation-latency budgets; 12-camera real-time concurrency is not a prototype completion gate. Live streams and physical signal actuation remain outside this milestone.

## 4. C00 contract freeze for the functional prototype

This section freezes the **proposed** wire and public shapes for C01 and its dependent tasks. It is not a claim that the running API implements them. Existing protobuf fields and numbers stay intact, including deprecated fields. C01 adds the fields below, regenerates Go/Python/TypeScript/JSON Schema together, and updates OpenAPI for public endpoints. The illustrative, non-runtime fixtures are in `packages/contracts/fixtures/prototype-contract/`.

### 4.1 Identity, clocks, and observation lifecycle

`input_session_id` is the run-wide authoritative input epoch assigned by Go. It changes when a seek/restart changes the input used by the run, or when its clip/geometry/model/mapping changes. A display-only seek leaves it alone. Per-camera `source_session_id` distinguishes processing attempts within that epoch. Identity for a cached observation is the tuple `(clip_sha256, geometry_sha256, detector_version, tracker_version, observation_schema_version, source_session_id, camera_id, window_start_s, window_end_s, available_at_source_s)`; a cache entry also records the configuration hash. Hashes are lowercase full SHA-256 hex, not path names or truncated hashes. `processed_at_utc` is an RFC3339 wall-clock completion timestamp. Source and simulation seconds are finite, nonnegative numbers; timestamps are never inferred from the current wall clock.

Add `SourceIdentity` with `clip_sha256` (1), `geometry_sha256` (2), `detector_version` (3), `tracker_version` (4), `observation_schema_version` (5), `source_session_id` (6), `config_hash` (7), and `processing_mode` (8). Add `FinalizedObservation` with `observation_id` (1), `camera_id` (2), `boundary_link_id` (3), `window_start_s` (4), `window_end_s` (5), `available_at_source_s` (6), `processed_at_utc` (7), `crossings_veh` (8), `observation_status` (9), `source_identity` (10), optional `queue_visible_veh_estimate` (11), `queue_status` (12), and `release_start_simulation_s` (13, optional until mapped into a run). `crossings_veh=0` with `observation_status=valid` is a measured zero. A missing record is missing input, never an implicit zero. Internal-link observations have an empty `boundary_link_id` and cannot inject external mass.

Add to `TrafficState`: `input_session_id` (33), `latest_finalized_window_end_source_s` (34, optional), `observation_history` (35, repeated `FinalizedObservation`), and `input_quality` (36). The history is a bounded, past-only view, sorted by boundary and start time. It contains only finalized windows whose end is no later than the source watermark and whose processing completion occurred before the analysis request. The run declares a source-to-simulation mapping and records each mapped window's `release_start_simulation_s`. This is at or after the actual eligible simulation tick, never before the finalized window exists. `available_at_source_s` is a source coordinate and may never be compared directly with a wall-clock timestamp or assumed equal to a simulation tick.

Status vocabulary: observation `valid`, `degraded`, `invalid`; input quality `fresh`, `cached_valid`, `synthetic`, `missing`, `stale`, `degraded`, `out_of_order`, `duplicate`, `replay`. Only `valid` observations from the bound input epoch may feed the ordinary forecast. A new epoch invalidates prior analysis even if an identical clip later recovers. A valid cached result is labelled `cached_valid`, not fresh inference. Prerecorded replay is selected explicitly and labelled `replay`.

Reject a window with `end <= start`, `available_at_source_s < end`, non-finite time/count, negative count, mismatched hash/schema/session, unsupported direction or boundary assignment, or processing completion absent. Reject duplicate identity with different content. An identical duplicate may be idempotently ignored and reported as duplicate. Quarantine overlapping or out-of-order windows per `(run, input_session_id, boundary_link_id)`; do not silently sort them into a plausible history. Stale/degraded/invalid windows cannot become zero demand. Prevent an internal-link camera from also injecting boundary mass. Admission blocked by finite storage retains offered mass in boundary backlog under the conservation identity above.

`camera-observation-v1` keeps the legacy `pedestrain` key. Change the existing vision emitters' default and explicit `agent_reviewed` assignments to `provisional_unreviewed` during V01; only a recorded human review can raise the level. The current emitter uses shortened model/geometry hashes and omits processing completion; V01 must emit full identity for new processed results. Existing cached records without that identity are ineligible for valid cache reuse.

The F01 run handoff extends `RunCommand` additively with `input_session_id` (9) and repeated `BoundSource` selections (10). Each selection carries camera/source-session IDs and the clip, geometry, model, configuration and finalized-observation SHA-256 values plus detector/tracker/schema versions. Go resolves and audits these identities; private simulation must verify the exact selected processed artifact before use. No raw clip path, video, tracker identity or browser-selected role enters the gRPC command. Older seeded commands omit the new fields and remain wire-compatible.

### 4.2 Forecast and analysis

Add to `Forecast`: `method` (12: `persistence` or `ewma`), `origin_source_s` (13), `input_age_s` (14, wall-clock age since the latest eligible processing completion), `input_quality` (15), `horizon_status` (16: `available`, `insufficient_history`, `missing_input`, `stale_input`), optional `uncertainty_lower_veh` (17), optional `uncertainty_upper_veh` (18), and `uncertainty_status` (19: `calibrated` or `unavailable`). Add `HorizonAvailability` with `horizon_s` (1), `status` (2), and `reason` (3); add repeated `horizon_availability` to `Analysis` (16). Return one availability entry for each of 30/60/120/300 seconds, even if no numeric forecast can be returned for that horizon. S03 also uses `compute_unavailable` in `HorizonAvailability.status` when the analysis deadline or concurrency limit prevents numeric computation; its reason names the failed budget. Recorded-data *scoring* availability is distinct: `unsupported_reference` means no later reference window exists, not that a software forecast is unavailable. The lower/upper fields are absent unless calibrated against independent reference data; zero is not a substitute for unavailable uncertainty. `origin_source_s` is the end of the latest eligible finalized window, not a future target time. Forecasts never see windows processed after their analysis origin.

Add to `Analysis`: `input_session_id` (7), `snapshot_sequence` (8), `config_hash` (9), `model_version` (10), `metrics_version` (11), `forecast_origin_source_s` (12), `input_quality` (13), `outcome` (14: `recommend`, `no_action`, `cannot_evaluate`), and `outcome_reason` (15). `recommend` requires a safe candidate that exceeds the declared minimum benefit and includes an actionable recommendation. `no_action` means the current safe plan wins or the gain is too small; it has no actionable recommendation. `cannot_evaluate` means input or compute is unsuitable; it also has no actionable recommendation. Go independently verifies the run, epoch, sequence and versions before exposing or approving an action; a later good observation does not revive an old analysis.

### 4.3 Plan activation and matched comparison

Add optional `offset_s` to `TimingChange` (4), measured from the corridor cycle origin for that node. Add `activate_not_before_simulation_s` to `PlanCommand` (4) and `Recommendation` (10). The virtual scheduler applies the complete plan at the first valid *corridor-wide* safe boundary at or after that time, or retains the current plan with a terminal rejection/timeout outcome. It must validate clearance, locks, conflicting movements, downstream storage, and emergency protection against the actual activation boundary. Add to `PlanOutcome`: `applied_at_simulation_s` (4, optional), `input_session_id` (5), and `snapshot_sequence` (6). The public operator action is audited with actor from the verified Go session, command ID, reason, before/after plan, and terminal applied/rejected status.

Dispatch now also carries optional-presence `PlanCommand.expected_input_session_id` (5) and `expected_snapshot_sequence` (6). Both must be present for a new command; an explicitly empty seeded epoch and zero snapshot are valid identities. Under the engine lock, compare them with the current run before scheduler or receipt mutation. Reject mismatches. Previously accepted idempotent retries remain receipts, even after the snapshot advances. Go stores the exact dispatch payload in its existing durable intent JSON so outcome lookup retains the same command hash; older intent/receipt queries retain their original legacy payload. Generated Go/Python/TypeScript and JSON contracts change together; no existing protobuf tags or database columns change.

Add to `Recommendation`: `input_session_id` (11), `snapshot_sequence` (12), `config_hash` (13), `model_version` (14), `metrics_version` (15), and `forecast_origin_source_s` (16). Add to `CompareCommand`: `horizon_s` (4) and `demand_assumptions_hash` (5). All candidates, including current timing, use the same complete sanitized snapshot, source epoch, demand assumptions, horizon, and versions. Do not use future events, future bins, or a fresh random draw per candidate.

Keep existing `ComparisonResult` fields 15–23; `baseline_boundary_throughput_veh` and `candidate_boundary_throughput_veh` mean **boundary exits during the comparison window**. Add `baseline_worst_service_debt_s` (24), `candidate_worst_service_debt_s` (25), `baseline_boundary_wait_veh_s` (26), `candidate_boundary_wait_veh_s` (27), `input_session_id` (28), `snapshot_sequence` (29), `config_hash` (30), `forecast_origin_source_s` (31), `demand_assumptions_hash` (32), `window_start_simulation_s` (33), `window_end_simulation_s` (34), and `scoring_version` (35). Existing backlog fields 21–22 mean vehicles waiting to enter **at window end**. Queue delay fields 15–16 are veh·s integrated over the same window. Worst service debt is the maximum red/service debt of any served approach, a model metric in seconds. Boundary wait is the integral of backlog over time, in veh·s; it makes displaced delay visible. Keep deprecated stops, average delay, and individual journey-time fields unavailable in the public comparison. Scoring weights, candidate limit, horizon, concurrency, and minimum benefit are versioned configuration, not inferred from the winning candidate.

### 4.4 Public API and durable report

Go owns `/api/v1` commands and report export. Observation queries return the selected input epoch, clip/geometry/model provenance, source window and processing completion, actual freshness, status/reason, plus the measured aggregate. An empty result conveys `missing`, never `crossings_veh: 0`. The run-start command binds a specific input epoch and configuration hash; changing it creates a new epoch and invalidates previous forecast/comparison/recommendation IDs. A display seek endpoint or client action returns `display_only: true` and cannot mutate that binding. Mutating commands require a verified session, origin check and idempotency key; browser `X-Role`/`X-Actor` values have no authority.

The one-action authenticated report export is `GET /api/v1/runs/{id}/report`. Its versioned JSON carries report/run IDs, creation time, authoritative input epoch, safe source identifiers/hashes, configuration/model/metric/scoring versions, observation provenance and failures, forecast origin/method/quality/horizon availability, alternatives and matched baseline/candidate metrics, decisions and applied outcome, and measured resource use. A metric with no defensible measurement is `null` with an `availability` reason. Go persists this evidence as events occur so export survives restart. Exclude raw media, frame paths, tracking identities, credentials and private model assets. Field benefit and physical-control claims are absent. The fixture is a shape example, not benchmark evidence.

### 4.5 C01 compatibility and review checks

- Never renumber or reuse protobuf tags; retain existing deprecations. Unknown new fields must remain ignorable by an older reader, while C01 tests new-field binary and JSON round trips in Go and Python.
- New public JSON uses the generated snake_case names; protobuf 64-bit integers remain JSON strings. OpenAPI, TypeScript, JSON Schema and generated bindings change in one C01 commit.
- A source epoch mismatch, stale snapshot sequence/version, malformed timing, unsuitable input, or absent safe boundary rejects an approval without changing the current plan. Terminal outcomes and reasons remain queryable by command ID after session expiry and re-login.
- API, Python and UI review lenses: Go must retain authority and durable audit; Python must enforce causal state and matched comparison; UI must display the status/units/origin without manufacturing unavailable values. These cross-layer checks are C00 design review criteria, not completed implementation claims.

### Q01 additive integration contract (2026-10-01)

`TrafficState.simulation_paused` is field 37. Private `ClockCommand` carries run/input-session identity and an explicit paused boolean; `Simulation.SetClock` holds only the virtual engine clock. Authenticated Go `POST /api/v1/runs/{id}/clock` owns origin/role/lease/idempotency checks and durable intent/outcome audit. Confirmed command recovery returns the original held snapshot sequence and virtual time. Stream heartbeat timestamps represent current delivery, not a changed source processing timestamp.

`SchedulerSnapshot` retains fields 1–5 and adds activation-not-before tick (6), per-node offsets (7), delayed releases (8), waiting nodes (9), optional requested/applied ticks (10/11), and rejection reason (12). Comparisons reconstruct the complete scheduler and reject pending offset-only plans. All generated bindings are regenerated together.

Public run-report v2 preserves v1 separately, uses strict aggregate-only chronological evidence, includes nullable unavailable identities/origins, and reads a repeatable PostgreSQL snapshot through authenticated Go. Its OpenAPI component definitions are self-contained; every owned HTTP route is represented. Raw media, individual tracking identities and secrets are excluded.

Unresolved E01 conflict: the frozen actionable processing-age cap of 10 seconds is not met by immutable cached observations whose actual processing completion is older. Source-window causal freshness and current state delivery are distinct. Q01 preserves `Forecast.input_age_s` semantics, displays processing age, and does not claim that the recorded-cache rehearsals pass this frozen age cap. Resolve the recorded-cache acceptance interpretation in a versioned protocol before fresh held-out evaluation.

### Audit controller follow-up: causal offered-rate window

`BoundaryDemandState.offered_window_s` is additive optional field 4; existing fields 1–3 retain their tags. Operating snapshots declare the number of past one-second offered-demand samples used by `offered_rate_vpm`, bounded at 60. Warmup uses only observed samples; zero samples means zero offered rate. Older states may omit the window, retaining their original declared rate without inventing a historical interval. This is offered external demand, including demand denied admission, and remains distinct from admitted link inflow and video observations. Reset clears the averaging history. `recent-flow-v2` includes the forecast version and averaging window in demand-assumption identity. Recorded EWMA eligibility and committed-release semantics remain unchanged.

`comparison-scoring-v1.2` preserves all weights, units, five-candidate limit, concurrency, 120-second comparison, 1.5-second deadline and ten-point minimum benefit. Operating proposals add pressure/backlog and causal routed-demand allocations plus bounded cycle alternatives. Full corridor plans still pass the existing timing, clearance, authority and activation checks. Legacy 1.0 candidate interpolation remains compatible. The common-cycle proposal derives offsets from candidate phase progression and configured route travel, bounded at ten seconds. Actual activation and regression guards remain authoritative; Compare/approval verifies explicit offsets against actual execution. This policy is bounded analytical search, not a global optimum.

Benchmark emergency route flow is measured over the same matched 120-second window for each policy. Actual request recovery may be observed separately through the declared 600-second run end, with its own observation interval. Extending recovery observation cannot add flow or improve metrics inside the comparison window. During protected priority/recovery, the local baseline retains the authorized current plan; it cannot bypass the activation guard. Censored or rejected recovery remains a failed case, and no lifecycle result is an individual ambulance travel-time claim.
