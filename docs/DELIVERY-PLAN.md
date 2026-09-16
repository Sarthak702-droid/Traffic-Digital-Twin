# Traffic Digital Twin — prioritized delivery backlog

Sources: root `PRD` and `AGENT.MD`. The latter references `docs/PRD.md`, which is absent; the supplied root PRD is the source of truth.

This is a proposed implementation plan, not evidence of completed work. The dashboard is a standalone documentation artifact; it does not replace the required product stack.

## Priorities

- **P0 Essential:** release blocker; do not cut.
- **P1 Important:** simplify the guided presentation if necessary, preserving the complete core demonstration.
- **P2 Optional:** CV, advanced charts and nonessential motion; remove first.
- **Deferred / out of scope:** listed separately, not silently counted as MVP stories.

## Analysis and decisions

### CV has conflicting scope language

PRD §3.1 lists a sample-video pipeline as must-build. AGENT.MD explicitly calls it optional, and PRD §27 cuts it in a 10-day build. Plan it as P2; core traffic remains synthetic.

### Safety and replay move earlier

The PRD places some reliability work late. This plan begins the safety envelope, audit and replay plumbing alongside integration, with final recording and rehearsal after scenarios stabilize.

### C2 is a boundary in the first build

The emergency route reaches C2, but PRD §2.1 controls only C1/C3. Show ETA and route progress at C2; signal offsets/pre-clearance there require explicit signal configuration.

### Ten days requires parallel capacity

The compressed view is a proposed sequence, not a delivery promise. Frontend, Go/backend, simulation/intelligence and QA must overlap. CV and optional polish are removed; release gates remain.

### Planning dashboard is not the product UI

This standalone HTML/CSS/JS artifact lives under docs. The traffic MVP retains the required Next.js/Go/Python stack and six-screen navigation. No traffic service is implemented by this dashboard.

## Delivery sequence

Calendar windows assume parallel Frontend, Backend, Simulation/Intelligence and QA work. They are not person-day estimates or a commitment. Dependency fields are completion gates; broad windows include preparatory work. Safety, audit and replay are cross-cutting.

Foundation → deterministic state → forecasts + safety → candidate rollouts/AGDA → PN-MPC → comparison + operator decisions → incident → emergency → acceptance + offline rehearsal.

The 10-day alternative defers P2 work and compresses integration; if protected gates cannot pass, extend delivery rather than cut them. Day 10 (compressed) / Day 15 (full) is stabilization and rehearsal.

## E01 — Foundation & shared contracts [P0]

**Owner:** Platform · **Window:** days 1–2 · **Epic inputs:** None

Every downstream feature depends on a single, typed and configurable model.

**Sources:** PRD §§2, 7, 9–14, 26; AGENT.MD: Architecture, Core traffic state

### S01 — Freeze scope and repository boundaries [P0]

As the engineering team, I want a documented architecture and scope freeze, so that implementation stays within the MVP.

**Owner:** Platform · **Days:** 1–1 · **Depends on:** None

Acceptance criteria:

- Create the required apps/web, apps/api, services/simulation, services/intelligence, packages/contracts, packages/scenario-config, db/migrations and db/queries layout.
- Record Browser → Go → Python via gRPC; Go owns validation, persistence, decisions and audit.
- Use the prescribed Next.js/React/TypeScript, Go/chi/pgx/sqlc and Python/SUMO stack; exclude prohibited infrastructure and identity tracking.

### S02 — Define typed state, event and command contracts [P0]

As an integration engineer, I want versioned shared schemas, so that all components agree on traffic and decision semantics.

**Owner:** Platform · **Days:** 1–2 · **Depends on:** S01

Acceptance criteria:

- Define Node, Link, Movement, SignalPhase, TrafficState, Forecast, Recommendation, OperatorAction, Incident, EmergencyEvent, HealthState and AuditEvent.
- Include movement queue, arrival/departure rate, speed, occupancy, receiving capacity, phase and waiting age with explicit units.
- Specify REST endpoints and all nine PRD WebSocket message types; validate Go/Python gRPC payloads.

### S03 — Configure the C1–C6 network as data [P0]

As a scenario author, I want graph and signal configuration outside UI code, so that another corridor can be loaded without rewriting components.

**Owner:** Simulation · **Days:** 1–2 · **Depends on:** S02

Acceptance criteria:

- Represent the supplied C1–C6 topology, directed links, turning ratios, lengths and storage in configuration.
- C1 and C3 are controlled junctions; C2/C4/C5/C6 start as boundaries.
- Validate geometry, phase conflicts, timing bounds and deterministic scenario seeds.

### S04 — Create Go API and useful persistence [P0]

As an operator, I want durable run and decision records, so that actions survive service restarts.

**Owner:** Backend · **Days:** 1–2 · **Depends on:** S02

Acceptance criteria:

- Set up chi, PostgreSQL migrations and sqlc queries for configs, runs, recommendations, operator actions, incidents, emergencies, health and audit.
- Validate commands in Go and expose configuration/state/history APIs.
- Keep high-frequency state in memory; persist useful aggregates/events rather than every frame.

## E02 — Deterministic simulation & live state [P0]

**Owner:** Simulation · **Window:** days 2–4 · **Epic inputs:** E01

A credible digital twin is the base for prediction, comparison and every scenario.

**Sources:** PRD §§10, 13–14, 16, 21, 24; AGENT.MD: Demo scenarios, Golden replay

### S05 — Build seeded SUMO scenarios and reset [P0]

As an operator, I want repeatable demand and virtual signals, so that the same demo can be reproduced.

**Owner:** Simulation · **Days:** 2–3 · **Depends on:** S03

Acceptance criteria:

- Build SUMO/TraCI network, routes and synthetic demand for exactly peak_surge, incident_c3 and ambulance_corridor.
- Apply plans only to virtual signals; seed and reset restore identical initial conditions.
- Start and reset complete in less than 5 seconds on the demo machine.

### S06 — Stream aggregate traffic through Go [P0]

As an operator, I want fresh traffic state in the browser, so that the view reflects the active simulation.

**Owner:** Backend · **Days:** 3–4 · **Depends on:** S04, S05

Acceptance criteria:

- Publish aggregates at 1 Hz via Python gRPC → Go → WebSocket → browser.
- Carry run ID, timestamp, source and per-movement state; include smoothing for noisy observations when applicable.
- Measure state-to-browser latency below 500 ms locally; make stale/disconnected state visible.

### S07 — Enforce virtual signal timing and phase state [P0]

As a traffic engineer, I want explicit phase transitions, so that simulations respect signal semantics.

**Owner:** Simulation · **Days:** 3–4 · **Depends on:** S05

Acceptance criteria:

- Expose current phase, remaining time, movement permissions and downstream capacity.
- Represent min/max green, amber, all-red, clearance and conflict constraints from configuration.
- Ensure deterministic phase progression and test conservation of arrivals/departures.

## E03 — Command center & junction intelligence [P0]

**Owner:** Frontend · **Window:** days 1–5 · **Epic inputs:** E01, E02

The operator must understand current state and future risk without a dense wall of charts.

**Sources:** PRD §§5–8.4; AGENT.MD: Product UI

### S08 — Build the product shell and disclosure [P0]

As an executive viewer, I want a calm and honest operational interface, so that demo outputs cannot be mistaken for live control.

**Owner:** Frontend · **Days:** 1–2 · **Depends on:** S01

Acceptance criteria:

- Provide only Command Center, Network/Junction Intelligence, Vision Analytics, Incidents, Emergency and Audit & Health product navigation.
- Always display DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL.
- Use a dark neutral theme, restrained status colors and accessible controls; support operator/supervisor/viewer needs.

### S09 — Render the data-driven animated twin [P0]

As an operator, I want moving traffic and signal state on C1–C6, so that I can see how connected traffic evolves.

**Owner:** Frontend · **Days:** 3–4 · **Depends on:** S03, S06, S08

Acceptance criteria:

- Load geometry from configuration; never hard-code it in React.
- Render direction, queue, flow, speed and signal overlays with smooth interpolation between 1 Hz updates.
- Show no more than five summary KPIs and expose the highest-priority alert and recommendation.

### S10 — Inspect junction state and future horizons [P0]

As an operator, I want a junction drawer and forecast selector, so that I can trace a predicted risk to its cause.

**Owner:** Frontend · **Days:** 4–5 · **Depends on:** S09, S12

Acceptance criteria:

- Click C1/C3 to inspect approach queues, arrivals/departures, speed, occupancy, storage, phase and remaining time.
- Provide NOW, +30s, +1m, +2m and +5m views; label outputs simulation forecast and 5-minute output advisory.
- Display spillback ETA, upstream cause and expected recommendation impact; do not invent confidence bands.

## E04 — Forecasts, platoons & spillback [P0]

**Owner:** Intelligence · **Window:** days 4–5 · **Epic inputs:** E02

Prediction before C1 congestion is the key proof of value.

**Sources:** PRD §§16–17, 20–21; AGENT.MD: Forecasting

### S11 — Implement conservation-based forecasting [P0]

As an operator, I want bounded queue forecasts, so that I can anticipate congestion.

**Owner:** Intelligence · **Days:** 4–5 · **Depends on:** S06, S07

Acceptance criteria:

- Implement Q(t+1) = max(0, Q(t) + arrivals − departures).
- Limit departures by phase, saturation, queue and downstream receiving capacity.
- Output queues, occupancy and arrivals at 30/60/120/300 seconds; test non-negative queues and conservation.

### S12 — Propagate platoons and predict spillback [P0]

As an operator, I want upstream-aware alerts and ETA facts, so that I can intervene before C1 becomes critical.

**Owner:** Intelligence · **Days:** 5–5 · **Depends on:** S11

Acceptance criteria:

- Propagate discharge using link travel time, destination split and ETA tolerance.
- Return spillback risk/ETA and deterministic explanation facts including upstream source.
- Peak-surge fixture alerts before C1 becomes critical, with approximately 90–120-second scenario lead time; verify against seeded simulation.

## E05 — Safety envelope & human authority [P0]

**Owner:** Backend · **Window:** days 3–9 · **Epic inputs:** E01, E02

Safety is a prerequisite for any candidate application, including emergency priority.

**Sources:** PRD §§8.3, 18.3, 22–23; AGENT.MD: Safety validator, Recommendation actions

### S13 — Validate every candidate and application [P0]

As a supervisor, I want central safety validation in Go, so that unsafe plans never reach the twin.

**Owner:** Backend · **Days:** 3–6 · **Depends on:** S02, S04, S07

Acceptance criteria:

- Reject conflicting greens, min/max green violations, amber/all-red/clearance breaches, excessive holds and modeled pedestrian/cross-road wait violations.
- Enforce manual locks, blocked/full receiving links, incident closures and emergency protections.
- On validation failure retain the safe current plan and audit a structured reason; test each rule.

### S14 — Support observe, recommend and manual modes [P0]

As an operator, I want explicit control of recommendation authority, so that automation cannot override my decision.

**Owner:** Backend + Frontend · **Days:** 6–9 · **Depends on:** S13, S08

Acceptance criteria:

- Default the demo to recommendation-only mode; observe mode still shows forecasts.
- Manual mode immediately stops new recommendations and honors movement locks.
- Intelligence failure stops recommendations and exposes degradation; there is no physical actuation endpoint.

### S15 — Approve, modify and reject with audit [P0]

As an operator, I want bounded decision controls, so that I retain final authority over the simulated plan.

**Owner:** Backend + Frontend · **Days:** 8–9 · **Depends on:** S13, S19, S22, S25

Acceptance criteria:

- Expose SIMULATE, APPROVE IN DIGITAL TWIN, MODIFY and REJECT for every recommendation.
- Require a reason for modify/reject, validate bounded edits server-side and revalidate the plan before applying.
- Record actor, timestamp, recommendation ID, before/after, reason, safety result and scenario/run ID; test critical operator flows and invalid edits.

## E06 — AGDA & network recommendations [P0]

**Owner:** Intelligence · **Window:** days 6–7 · **Epic inputs:** E04, E05

Recommendations must coordinate C1/C3 and explain why they improve predicted conditions.

**Sources:** PRD §§18–20; AGENT.MD: Signal decision algorithm

### S16 — Implement bounded AGDA phase allocation [P0]

As a traffic engineer, I want demand and fairness aware allocation, so that green time serves need without feeding blocked links.

**Owner:** Intelligence · **Days:** 6–6 · **Depends on:** S11, S13

Acceptance criteria:

- Normalize queue, predicted arrivals and wait age; use weights 0.8 and 0.4 with receiving factor 1 − occupancy².
- Apply fairness, emergency boost and incident penalty; allocate flexible green with clipping/redistribution inside the cycle budget.
- Test bounds, budget feasibility, waiting-age fairness and blocked receiving links; reject infeasible budgets.

### S17 — Generate coordinated candidate signal plans [P0]

As an operator, I want bounded network candidates, so that C1 clearance and C3 release work together.

**Owner:** Intelligence · **Days:** 6–7 · **Depends on:** S12, S16

Acceptance criteria:

- Use AGDA plus ±5/10-second split/offset adjustments, allowed cycle lengths and safe configured phase order.
- Coordinate green windows with platoon ETA and gate upstream release when storage is constrained.
- Discard unsafe plans before rollout; do not create arbitrary phases.

### S18 — Simulate and score PN-MPC candidates [P0]

As an operator, I want the safest low-cost coordinated recommendation, so that network outcomes guide decisions.

**Owner:** Intelligence · **Days:** 7–7 · **Depends on:** S17, S21

Acceptance criteria:

- Every ~5 seconds evaluate a bounded candidate set over ~120 seconds.
- Score queue, delay, stops, spillback (weight 3), fairness, signal switching, emergency delay and manual preference; invalid candidates have infinite cost.
- Return best plan and two feasible alternatives when available, explicitly explain when fewer exist; measure generation under 2 seconds on the demo machine.
- Test deterministic scoring and scenario behavior; keep application subject to operator and safety checks.

### S19 — Explain recommendations from structured facts [P0]

As an operator, I want a traceable recommendation explanation, so that I understand the proposed timing change.

**Owner:** Intelligence + Frontend · **Days:** 7–7 · **Depends on:** S18

Acceptance criteria:

- Include recommendation ID, priority, affected junctions, trigger, timing changes, predicted impact and safety status.
- Derive explanations from upstream flow, arrival ETA, queue/storage and simulated candidate results.
- No invented operational facts, trained-ML claims or unsupported confidence bands.

## E07 — Before-vs-after evidence [P0]

**Owner:** Simulation + Frontend · **Window:** days 6–8 · **Epic inputs:** E02, E05

The operator must test the proposed intervention on equal initial conditions.

**Sources:** PRD §§8.4, 10.1, 13, 21.1; AGENT.MD: Definition of done

### S21 — Create isolated, equal-seed simulation branches [P0]

As an operator, I want baseline and candidate rollouts from one snapshot, so that comparisons are fair and never mutate the active run.

**Owner:** Simulation · **Days:** 6–7 · **Depends on:** S05, S07, S13

Acceptance criteria:

- Clone the same initial state and random seed for baseline and candidate.
- Isolate rollout state from live scenario; validate candidate timing before execution.
- Return max queue, average delay, spillback occurrence and stops/vehicle with units and simulation provenance.

### S22 — Show synchronized comparison and impact [P0]

As an operator, I want a synchronized split view, so that I can compare the proposed plan before approving it.

**Owner:** Frontend · **Days:** 8–8 · **Depends on:** S09, S19, S21

Acceptance criteria:

- Wire SIMULATE to Go and display matched timeline/baseline/candidate views.
- Show only the four outcome metrics with clear simulated labels and honest unchanged/worse outcomes.
- Keep recommendation identity and initial-state provenance visible; handle simulation errors without silently applying the plan.

## E08 — Audit, health & replay resilience [P0]

**Owner:** Backend + QA · **Window:** days 2–14 · **Epic inputs:** E01, E02

Reliability and traceability must grow with the system, not wait until the final rehearsal.

**Sources:** PRD §§8.8, 12–13, 23–25; AGENT.MD: Audit, Golden replay

### S25 — Persist recommendation and decision audit events [P0]

As a supervisor, I want an append-only decision history, so that I can trace who changed what and why.

**Owner:** Backend · **Days:** 2–4 · **Depends on:** S04

Acceptance criteria:

- Record recommendations and operator actions including timestamp, actor, recommendation ID, before/after, reason, safety result and run ID.
- Serve paginated audit history and audit.appended events through Go.
- Test successful and rejected decisions, persistence and association with the correct scenario.

### S26 — Expose health and safe degraded states [P0]

As an operator, I want visible component health, so that a failed service cannot masquerade as healthy traffic.

**Owner:** Backend + Frontend · **Days:** 4–13 · **Depends on:** S06, S08

Acceptance criteria:

- Show Go, simulation, intelligence, CV and database availability with timestamps/staleness.
- Show controller NOT CONNECTED, CCTV DEMO/SAMPLE and emergency API SIMULATED.
- Stop recommendations when intelligence fails; display missing/low-confidence state and explain absent optional CV.

### S27 — Build golden replay through the real delivery path [P0]

As a presenter, I want a deterministic replay fallback, so that the demo survives SUMO or CV failure offline.

**Owner:** Backend + QA · **Days:** 3–14 · **Depends on:** S02, S06

Acceptance criteria:

- Implement live/replay selection behind a presenter/admin control; replay travels through Go and the same WebSocket/frontend contracts.
- Replay/reset preserve event order, timing and scenario/run identity; visibly indicate replay.
- Capture a known-good eight-minute event stream once scenarios stabilize and verify failure switch-over.

### S28 — Provide audit and health inspection [P0]

As a supervisor, I want an inspectable event timeline and health panel, so that I can verify control and system limitations.

**Owner:** Frontend · **Days:** 9–13 · **Depends on:** S15, S25, S26

Acceptance criteria:

- Display timestamp, type, junction, recommendation, operator action, before/after, reason and result.
- Navigate from decisions to their audit evidence and display degraded states without hiding them.
- Test critical operator action → persisted audit → visible timeline flow.

## E09 — C3 incident & network recovery [P0]

**Owner:** Simulation + Intelligence · **Window:** days 10–10 · **Epic inputs:** E06, E07, E08

Incident behavior must protect storage and show recovery, not just extend green.

**Sources:** PRD §§8.6, 21.2; AGENT.MD: Incident mode

### S29 — Inject C3 capacity loss with controls [P0]

As an operator, I want a configurable C3 incident, so that I can demonstrate capacity loss and propagation.

**Owner:** Simulation + Frontend · **Days:** 10–10 · **Depends on:** S05, S09, S25

Acceptance criteria:

- Default C3 capacity to 35% of normal; offer incident type and severity/capacity controls.
- Start/reset through Go, record incident lifecycle and display affected links and upstream queues.
- Reset reproducibly restores the original capacity and seed.

### S30 — Gate release and estimate recovery cycles [P0]

As an operator, I want a network recovery strategy, so that the incident does not spread avoidable spillback.

**Owner:** Intelligence · **Days:** 10–10 · **Depends on:** S29, S18, S22

Acceptance criteria:

- Reduce upstream release, maximize safe discharge and protect receiving storage.
- Forecast C6/upstream propagation and estimate recovery cycles from simulation.
- Compare baseline/candidate; end-to-end test verifies no release into blocked/full links.

## E10 — Emergency corridor & cross-traffic recovery [P0]

**Owner:** Simulation + Intelligence · **Window:** days 11–11 · **Epic inputs:** E06, E08, E09

Emergency priority is only credible with safe transitions and a bounded return to normal.

**Sources:** PRD §§8.7, 21.3, 23; AGENT.MD: Emergency mode

### S31 — Track the simulated emergency route and ETA [P0]

As an operator, I want a simulated emergency on C6 → C3 → C1 → C2, so that I can see corridor readiness ahead of the vehicle.

**Owner:** Simulation + Frontend · **Days:** 11–11 · **Depends on:** S29, S12, S25

Acceptance criteria:

- Create a simulated authenticated emergency event through Go and record it.
- Display vehicle location, per-junction ETA, pre-clearance schedule, signal state and transition countdown.
- Treat boundary nodes as route points unless explicitly configured as signalized; do not invent a C2 signal.

### S32 — Pre-clear safely and compensate displaced traffic [P0]

As an operator, I want safe priority followed by recovery, so that emergency passage does not starve cross traffic.

**Owner:** Intelligence + QA · **Days:** 11–11 · **Depends on:** S31, S13, S18, S30

Acceptance criteria:

- Enforce normal → amber → all-red → priority → passage → recovery at controlled junctions.
- Emergency priority cannot bypass conflicts, manual/safety constraints or downstream protections; conflicts yield a visible safe outcome.
- Show displaced queues, compensating cycles and return to normal within a configured bound; end-to-end test the full sequence.

## E11 — Presentation & release acceptance [P0]

**Owner:** QA + Product · **Window:** days 5–15 · **Epic inputs:** E03, E04, E05, E06, E07, E08, E09, E10

A reliable eight-minute offline demonstration is the release gate.

**Sources:** PRD §§5, 21, 24–28; AGENT.MD: Tests required, Definition of done

### S33 — Automate the three scenario acceptance journeys [P0]

As the release team, I want repeatable acceptance tests, so that the protected demo capabilities do not regress.

**Owner:** QA · **Days:** 5–14 · **Depends on:** S10, S15, S22, S30, S32

Acceptance criteria:

- Cover Go validation/safety/audit, forecast propagation, AGDA bounds/fairness, PN-MPC scoring and frontend operator flows.
- Run an end-to-end test for peak surge, C3 incident and ambulance corridor with deterministic resets.
- Verify early congestion warning, equal-seed comparison, reasons/audit, safe emergency transitions and recovery.

### S34 — Author the guided DGP presentation [P1]

As a presenter, I want an eight-minute guided story, so that executives understand the outcome without verbal rescue.

**Owner:** Product + Frontend · **Days:** 13–14 · **Depends on:** S28, S30, S32

Acceptance criteria:

- Provide START DGP DEMONSTRATION with current state → prediction → recommendation → comparison → incident → ambulance → human override/audit → shadow-pilot ask.
- Use deterministic scenarios and visibly preserve synthetic/no-live-control disclosure.
- Prepare a concise demo script and preflight checklist; presentation polish cannot block core functionality.

### S35 — Package, benchmark and rehearse offline [P0]

As a presenter, I want a tested offline package and backup, so that the demonstration survives internet and service loss.

**Owner:** QA + Platform · **Days:** 14–15 · **Depends on:** S27, S33

Acceptance criteria:

- Bundle local runtime assets/configs, golden replay and backup recording; run the full demo with internet disabled.
- Measure first load <3s, API p95 <150ms, stream latency <500ms, recommendation <2s, start/reset <5s and 1 Hz updates.
- Verify smooth animation and no browser memory growth during a 30-minute rehearsal; record machine and measurements.
- Day 15 is bug fixes and rehearsal only; do not declare done until every protected acceptance journey passes.

## E12 — Optional vision & presentation polish [P2]

**Owner:** CV + Frontend · **Window:** days 12–14 · **Epic inputs:** E01, E02, E03

Useful supporting evidence, but explicitly cut before any protected core capability.

**Sources:** PRD §§3.1, 8.5, 15, 27; AGENT.MD: Computer Vision, Priority if time slips

### S36 — Convert one sample video into traffic aggregates [P2]

As a viewer, I want sample-video traffic analytics at C3, so that I understand how cameras could supply state.

**Owner:** CV · **Days:** 12–12 · **Depends on:** S02, S06

Acceptance criteria:

- Use OpenCV → pretrained YOLO → ByteTrack → lane/ROI mapping → aggregate TrafficState through Go.
- Count once at the directional crossing line, estimate queues/occupancy and label uncalibrated speed as a demo estimate.
- Use clearly labeled non-Odisha sample video, temporary camera-local IDs only; no ANPR, faces or cross-camera identity.

### S37 — Show optional vision overlays and upstream impact [P2]

As a viewer, I want video overlays and aggregate metrics, so that the link between observation and prediction is visible.

**Owner:** Frontend + CV · **Days:** 12–13 · **Depends on:** S36, S12, S08

Acceptance criteria:

- Show boxes, temporary tracks, lanes/counting line and queue ROI for the single sample video.
- Display class counts, lane flow, queue, occupancy, direction and C1 arrival/ETA/risk outputs.
- Missing CV must not block the demo or golden replay; display unavailable honestly.

### S38 — Refine optional charts and motion [P2]

As a viewer, I want restrained presentation polish, so that the explanation is easier to follow.

**Owner:** Frontend · **Days:** 14–14 · **Depends on:** S10, S22

Acceptance criteria:

- Add heatmaps/advanced charts only if they clarify already-tested behavior and time remains.
- Use 150–250ms transitions and smooth vehicle interpolation; critical alerts pulse once rather than continuously.
- Respect reduced motion; remove nonessential animation before compromising reliability.

## Risks and open decisions

- **Safety configuration is not yet fixed** (Traffic / Simulation; S03 · S13): Specify actual min/max greens, clearance intervals, conflict matrices, max holds, fairness thresholds and emergency recovery bounds before scenario tuning.
- **Candidate rollout may miss the latency target** (Intelligence; S18 · S35): Benchmark on the demo machine, bound candidates and reuse snapshots. Do not trade away safety or fabricate results to meet 2 seconds.
- **Simulation and optimizer integration is the critical dependency** (Platform; S02 · S06): Freeze typed contracts first; develop forecast and UI against deterministic fixtures while live integration is completed.
- **The 10–15 day window lacks staffing assumptions** (Product; S01 · S35): Confirm team availability and target laptop early. Dates below are planning windows; acceptance, not the calendar, decides release readiness.

## Explicitly deferred / excluded

- Real Odisha CCTV or signal-controller connections and physical actuation
- ANPR, facial recognition and cross-camera identity tracking
- RL, GNN, custom trained forecasting without real evidence
- Kafka, Kubernetes, Redis, extra microservices and service mesh
- City-wide model, citizen app, enforcement/e-challan and cloud deployment

## Release gate

All protected stories must meet their acceptance criteria. An executive can follow the eight-minute demo: current state, early C1 risk and upstream cause, coordinated plan, equal-seed comparison, operator decisions, incident recovery, emergency pre-clearance and recovery, audit, offline reset and replay fallback. No claims of completed implementation or measured performance have been made.
