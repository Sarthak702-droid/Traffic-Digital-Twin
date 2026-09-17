> **2026-09-17 requirements update:** Read PRD §§9–11 and 32–34 and `docs/UX-PRODUCTION-AUDIT.md` first. The user now requires a Python public API gateway and dedicated Go DB writer. These requirements supersede the historical Go-only browser ingress/direct Go persistence/no-extra-services statements below only for the gateway/writer migration. Existing Python compute stays private. The original audit was documentation-only. The subsequent user request authorizes remediation; see `docs/REMEDIATION-STATUS.md`. Historical completion requires revised acceptance.

# AGENT.md — Traffic Digital Twin MVP

Read `docs/PRD.md` first. This file only defines execution rules.

## Goal
Build a deterministic, premium, offline-capable **Traffic Digital Twin + Predictive Decision-Support MVP** for the C1–C6 demo network.

It must show:
- current traffic state,
- +30s / +1m / +2m / +5m forecast,
- spillback prediction,
- multi-junction signal recommendations,
- before-vs-after simulation,
- operator Approve / Modify / Reject,
- incident recovery,
- emergency green corridor + recovery,
- audit + system health,
- optional sample-video CV analytics.

**Demo only:** synthetic/sample data, no live Odisha signal control.

## Stack

**Frontend**
- Next.js + React + TypeScript
- Tailwind + shadcn/ui
- Zustand + TanStack Query
- ECharts
- custom SVG/Canvas digital twin

**Backend**
- Go
- chi
- pgx + sqlc
- PostgreSQL
- WebSocket
- gRPC to Python services

**Simulation / Intelligence**
- Python
- SUMO + TraCI
- NumPy / SciPy
- OpenCV
- YOLO + ByteTrack for optional CV

Do not add Kafka, Kubernetes, Redis, microservices, RL, GNN, ANPR or face recognition for the MVP.

## Architecture

```text
Browser
  │ REST + WebSocket
  ▼
Go API / Orchestrator
  ├── PostgreSQL
  ├── Audit + Safety + Operator Workflow
  ├── gRPC → SUMO Simulation
  └── gRPC → Prediction / Optimization / CV
```

Rules:
- Browser talks only to Go.
- Go owns persistence, validation, audit, operator actions and replay.
- Python owns simulation, forecasting, optimization and CV.
- Python never writes operator decisions directly to DB.

## Required repo layout

```text
apps/web
apps/api
services/simulation
services/intelligence
packages/contracts
packages/scenario-config
db/migrations
db/queries
docs
AGENT.md
```

Do not create extra services without a real need.

## Product UI
Navigation only:
1. Command Center
2. Network / Junction Intelligence
3. Vision Analytics
4. Incidents
5. Emergency
6. Audit & Health

Design:
- premium command-centre look,
- dark neutral base,
- generous spacing,
- one dominant visual per page,
- minimal cards/charts,
- no cyberpunk/neon clutter.

Status colours only:
- green = normal,
- amber = warning,
- red = critical,
- purple = emergency,
- grey = unavailable.

Always show:
`DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL`

### Command Center
Show C1–C6 network, moving traffic, signal state, queue/flow/speed, alerts, forecast slider and active recommendation.

### Junction drawer
On node click show:
- queue by approach,
- flow / speed / occupancy,
- current signal phase + remaining time,
- forecast at 30s / 1m / 2m / 5m,
- spillback ETA/risk,
- upstream cause,
- recommendation + expected impact.

### Recommendation actions
Every recommendation must support:
`SIMULATE` · `APPROVE IN DIGITAL TWIN` · `MODIFY` · `REJECT`

Modify/reject requires a reason and must be audited.

## Core traffic state
Use these shared concepts only:
`Node, Link, Movement, SignalPhase, TrafficState, Forecast, Recommendation, OperatorAction, Incident, EmergencyEvent, HealthState, AuditEvent`.

Per movement maintain at least:
- queue,
- arrival rate,
- departure rate,
- speed,
- occupancy,
- downstream capacity,
- current phase,
- waiting age.

Never hard-code C1–C6 geometry in React. Load network/scenario JSON.

## Forecasting
Do not claim trained ML without real data.

Base queue model:

```text
Q(t+1) = max(0, Q(t) + arrivals - departures)
```

Propagate discharged flow downstream using link travel time to estimate platoon arrivals.

Forecast horizons: `30s, 60s, 120s, 300s`.

Output:
- future queue,
- occupancy,
- arrivals,
- spillback risk,
- spillback ETA,
- explanation facts.

## Signal decision algorithm
Use two layers.

### 1. AGDA — fast phase allocator
For each candidate phase compute:

```text
need = queue + 0.8*predicted_arrivals + 0.4*waiting_age
receive = 1 - downstream_occupancy^2
priority = need * receive * fairness + emergency_boost - incident_penalty
```

Allocate green proportionally within configured min/max green limits.

Never feed traffic into a blocked/full downstream link.

### 2. PN-MPC — network decision layer
Every ~5 s:
1. read current network state,
2. forecast ~120 s,
3. generate bounded signal-plan candidates,
4. simulate candidates in the digital twin,
5. score each candidate,
6. return the safest lowest-cost plan.

Cost should penalize:

```text
queue
+ delay
+ stops
+ 3*spillback
+ unfair waiting
+ excessive signal changes
+ emergency delay
```

The optimizer recommends; it never bypasses safety or the operator in this MVP.

## Safety validator
Reject any action that violates:
- conflicting greens,
- minimum green,
- maximum green,
- amber,
- all-red interval,
- configured pedestrian/clearance constraints,
- manual lock,
- blocked/full downstream link,
- emergency protection rules.

If safety validation fails, keep the current safe plan and log the reason.

## Incident mode
Required demo: **C3 capacity reduction/blockage**.

System must:
- reduce upstream release,
- maximize safe discharge through the constrained area,
- protect downstream storage,
- forecast queue propagation,
- estimate recovery cycles.

## Emergency mode
Required route: **C6 → C3 → C1 → C2**.

System must:
- calculate ETA per junction,
- pre-clear junctions ahead,
- preserve amber/all-red safety,
- display emergency state,
- restore displaced cross traffic after passage,
- return to normal operation through recovery cycles.

## Computer Vision
Optional demo input only; use sample video clearly labelled as non-Odisha feed.

Pipeline:
`Video → YOLO → ByteTrack → lane/ROI mapping → count/flow/queue/occupancy/speed estimate → TrafficState`

Rules:
- track IDs are camera-local and temporary,
- no ANPR,
- no face recognition,
- no cross-camera identity tracking,
- speed must be labelled estimated unless calibrated.

## APIs / realtime
- REST for commands, config, history and operator actions.
- WebSocket for live network state, forecasts, alerts, recommendation state and health.
- Use typed shared contracts; no ambiguous `data/info/aiOutput` blobs.

## Database
Persist only what is useful:
- network/scenario config,
- recommendation records,
- operator actions,
- incidents,
- emergency events,
- health events,
- audit log.

High-frequency simulation state may stay in memory; do not write every frame to PostgreSQL.

## Audit
Every recommendation and operator action must record:
- timestamp,
- actor,
- recommendation ID,
- before/after values,
- reason,
- safety result,
- scenario/run ID.

## Demo scenarios
Exactly three primary scenarios:
1. **Peak surge:** C6 → C3 → C1; predict C1 congestion before it occurs.
2. **Incident:** C3 blockage; show propagation + recovery strategy.
3. **Emergency:** C6 → C3 → C1 → C2; show pre-clearance + post-event recovery.

Use deterministic seeds and a one-click reset.

## Golden replay
Provide a deterministic replay event stream that drives the same Go/WebSocket/frontend path if SUMO/CV fails during the presentation.

The full demo must work offline.

## Tests required
At minimum test:
- Go validation + safety + audit,
- forecast propagation,
- AGDA bounds/fairness,
- PN-MPC candidate scoring,
- incident behavior,
- emergency safety sequence,
- frontend critical operator flows,
- one end-to-end run for each of the 3 scenarios.

## Definition of done
The MVP is done when a user can:
1. start/reset a scenario,
2. see C1–C6 traffic move in real time,
3. inspect a junction,
4. view future congestion/spillback,
5. receive an explainable multi-junction recommendation,
6. simulate before-vs-after impact,
7. approve/modify/reject it,
8. run incident and emergency scenarios,
9. see audit + system health,
10. complete the full demo offline with replay fallback.

## Priority if time slips
Never cut:
1. digital twin,
2. forecasting,
3. recommendation engine,
4. before-vs-after simulation,
5. human control,
6. incident,
7. emergency,
8. audit/replay.

Cut first:
- CV polish,
- heatmaps,
- advanced charts,
- cloud deployment,
- nonessential animations.

## Final rule
Optimize for **credible prediction, safe recommendations, clear operator control and demo reliability** — not technical complexity.
