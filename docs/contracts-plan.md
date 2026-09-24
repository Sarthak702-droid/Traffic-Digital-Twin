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
