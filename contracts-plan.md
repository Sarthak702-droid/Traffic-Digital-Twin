# Traffic Digital Twin — Contracts & Time Semantics Plan (T02)

## 1. Clocks & Time Semantics

The system enforces four distinct, decoupled clocks:

1. **`source_time_s` (Source Clock)**:
   - Video presentation timestamp relative to clip start ($t=0$ at start of chosen segment).
   - Frame timestamps are calculated via $frame\_index / FPS$ or video container PTS.
   - Immutable; independent of wall-clock processing speed.

2. **`event_time_s` (Detection / Crossing Clock)**:
   - Timestamp in `source_time_s` when an eligible tracked bounding box reference point (bottom center) crosses the defined counting segment in the valid direction.

3. **`available_at_s` (Availability Clock)**:
   - When a 5-second finalized observation bin $[t_{start}, t_{end})$ becomes available for downstream consumption ($available\_at\_s \ge t_{end}$).
   - No consumer or forecasting algorithm may access bin $[t_{start}, t_{end})$ before $t_{end}$.

4. **`simulation_time_s` (Virtual Traffic Clock)**:
   - Discrete 1-second ticks ($dt = 1.0\text{s}$) representing the virtual C1–C6 network time.
   - Causal delayed uniform release: Observation bin $[t-5, t)$ available at $t$ releases its total mass $M$ across $[t, t+5)$ at rate $M/5 \text{ veh/s}$.
   - Displays an honest 5-second derived-input lag in the UI; no fictitious physical synchronization.

5. **`wall_clock`**: Used strictly for orchestration, latency benchmarking, worker heartbeats, and audit timestamps.

---

## 2. Authoritative Data Schemas

### 2.1 CameraObservation Schema (`camera-observation-v1`)

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

### 2.3 Mass Conservation Identity

The aggregate simulation strictly satisfies:
$$\text{initial\_internal\_stock} + \sum \text{cumulative\_offered\_external\_demand} = \text{current\_internal\_stock} + \sum \text{boundary\_backlog} + \sum \text{cumulative\_boundary\_exits}$$

---

## 3. Boundary Camera Roles & Topology

| Camera Slot | Virtual Direction | Role in Aggregate Simulation |
|---|---|---|
| **CAM-01** | C2 $\rightarrow$ C1 | Authoritative external boundary input 1 |
| **CAM-02** | C4 $\rightarrow$ C1 | Authoritative external boundary input 2 |
| **CAM-03** | C5 $\rightarrow$ C1 | Authoritative external boundary input 3 |
| **CAM-04** | C3 $\rightarrow$ C1 | Internal-link analytics only (no mass injection) |
| **CAM-05** | C1 $\rightarrow$ C3 | Internal-link analytics only (no mass injection) |
| **CAM-06** | C6 $\rightarrow$ C3 | Authoritative external boundary input 4 |

Remaining 6 clips (CAM-07 through CAM-12) participate in concurrent vision analytics and performance benchmarking without injecting duplicate traffic.
