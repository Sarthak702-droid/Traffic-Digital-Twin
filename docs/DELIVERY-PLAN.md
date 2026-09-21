# Traffic Digital Twin — revised delivery plan

Revision 2.1 · 2026-09-18 · **Synthetic MVP only.** The supplied backend and API-concepts specifications replace the prior gateway/writer migration target.

Sources: the supplied `traffic_digital_twin_backend_architecture_spec.docx`, `traffic_digital_twin_api_concepts_spec.docx`, root `PRD`, `docs/API-ARCHITECTURE-SPEC-ALIGNMENT.md`, and `docs/backlog.json`. The live delivery dashboard reads `docs/backlog.json` plus `docs/delivery-status.json`.

All original stories are retained. E13 is now the Go control-plane alignment epic. S20/S23/S24 were already absent; IDs are deliberately not renumbered. Existing evidence remains historical until it is rechecked against the supplied specifications.

## Priority and execution

P0: mandatory release gate. P1: guided presentation can be simplified, but all displayed claims must remain truthful. P2: optional CV/polish, deferred before core reliability. Original days are planning placeholders, not commitments.

Sequence: complete Go gateway contract parity → verify in-process Go persistence and idempotency → prove gRPC degradation and live-event behavior → complete access/accessibility and real scenario acceptance. Design and test work can overlap; dependencies are acceptance gates.

Cross-cutting rules: browser ingress is the Go API gateway; Go owns domain validation, safety, persistence, audit and WebSocket delivery; Python workers keep private aggregate-flow/intelligence computation; reads/streams have explicit owners and persistence exemptions; no invented results or physical signal control. Every story must distinguish source implementation, historical evidence and newly measured acceptance.

## E01 — Foundation & shared contracts [P0]

**Owner:** Platform · **Provisional days:** 1–2 · **Epic inputs:** None

Every downstream feature depends on a single, typed and configurable model.

**Release gate:** Reaccept every story against revised gateway/writer ownership and applicable UX states; historical completion is not production acceptance.

**Findings:** A01, A03, A07, A09, A12, A13, A18, A19, A20

### S01 — Freeze scope and repository boundaries [P0]

As the engineering team, I want a documented architecture and scope freeze, so that implementation stays within the MVP.

**Owner:** Platform · **Provisional days:** 1–1 · **Depends on:** None

**Status:** completed — Verified and accepted; evidence in docs/epic1-acceptance.md.

**Audit findings:** A01, A13, A19, A20

Acceptance criteria:

- Create the required apps/web, apps/api, services/simulation, services/intelligence, packages/contracts, packages/scenario-config, db/migrations and db/queries layout.
- Record Browser → Python gateway → owning Go service → Python gateway → Go DB writer → PostgreSQL for durable commands; Go owns domain/safety, Python compute remains private.
- Use the prescribed Next.js/React/TypeScript, Go/chi/pgx/sqlc and Python aggregate cell-flow stack; exclude prohibited infrastructure and identity tracking.
- Document current Go-entry architecture separately from required Browser → Python gateway → Go domain service → gateway → Go DB writer; retain private Python compute. Publish an exhaustive route and persistence ownership matrix.
- Treat historical demo completion as historical only; record production blockers and no-live-control scope. Specify which release is isolated demo versus shared deployment.

### S02 — Define typed state, event and command contracts [P0]

As an integration engineer, I want versioned shared schemas, so that all components agree on traffic and decision semantics.

**Owner:** Platform · **Provisional days:** 1–2 · **Depends on:** S01

**Status:** completed — Verified and accepted; evidence in docs/epic1-acceptance.md.

**Audit findings:** A01, A07, A12, A18

Acceptance criteria:

- Define Node, Link, Movement, SignalPhase, TrafficState, Forecast, Recommendation, OperatorAction, Incident, EmergencyEvent, HealthState and AuditEvent.
- Include movement queue, arrival/departure rate, speed, occupancy, receiving capacity, phase and waiting age with explicit units.
- Specify REST endpoints and all nine PRD WebSocket message types; validate Go/Python gRPC payloads.
- Define method/path owner, principal, request/command ID, run ID, version, deadline, payload hash, persistence class and typed success/error schemas; separate Recommendation, ComparisonResult and start/reset results.
- Cover mode and lock routes, aliases, WebSocket upgrade/events, unknown paths/methods and validation errors in OpenAPI and parity tests; Go/Python must agree on accepted modes.

### S03 — Configure the C1–C6 network as data [P0]

As a scenario author, I want graph and signal configuration outside UI code, so that another corridor can be loaded without rewriting components.

**Owner:** Simulation · **Provisional days:** 1–2 · **Depends on:** S02

**Status:** completed — Verified and accepted; evidence in docs/epic1-acceptance.md.

**Audit findings:** A03

Acceptance criteria:

- Represent the supplied C1–C6 topology, directed links, turning ratios, lengths and storage in configuration.
- C1 and C3 are controlled junctions; C2/C4/C5/C6 start as boundaries.
- Validate geometry, phase conflicts, timing bounds and deterministic scenario seeds.
- Use configured 35% remaining incident capacity and configured timing bounds consistently in UI and briefing; do not imply C6/C2 signal control.
- Expose bundled config provenance and config version; validate semantic relationships at boundaries and reject mismatched config across Go/Python services.

### S04 — Create Go domain APIs and isolated Go database writer [P0]

As an operator, I want durable run and decision records, so that actions survive service restarts.

**Owner:** Backend · **Provisional days:** 1–2 · **Depends on:** S02

**Status:** completed — Verified and accepted; evidence in docs/epic1-acceptance.md.

**Audit findings:** A01, A09, A18

Acceptance criteria:

- Use chi for Go domain APIs and pgx/sqlc/PostgreSQL migrations in the Go writer for configs, runs, recommendations, operator actions, incidents, emergencies, health and audit.
- Validate commands in Go and expose configuration/state/history APIs.
- Keep high-frequency state in memory; persist useful aggregates/events rather than every frame.
- Route all durable writes, including migrations/config registration, through the Go writer boundary; domain query access is read-only. Atomically commit domain record, status, result and audit.
- Validate before persistence/publication; failure must not return durable success. Prove rollback, restart recovery and least-privilege writer access using real PostgreSQL.

## E02 — Deterministic simulation & live state [P0]

**Owner:** Simulation · **Provisional days:** 2–4 · **Epic inputs:** E01

A credible digital twin is the base for prediction, comparison and every scenario.

**Release gate:** Reaccept every story against revised gateway/writer ownership and applicable UX states; historical completion is not production acceptance.

**Findings:** A01, A06, A07, A09, A12, A14, A18

### S05 — Build seeded aggregate-flow scenarios and reset [P0]

As an operator, I want repeatable demand and virtual signals, so that the same demo can be reproduced.

**Owner:** Simulation · **Provisional days:** 2–3 · **Depends on:** S03

**Status:** completed — Verified and accepted; evidence in docs/epic2-status.md.

**Audit findings:** A07, A14

Acceptance criteria:

- Build finite-capacity aggregate network configuration and seeded boundary demand for exactly peak_surge, incident_c3 and ambulance_corridor.
- Apply plans only to virtual signals; seed and reset restore identical initial conditions.
- Start and reset complete in less than 5 seconds on the demo machine.
- Start/reset use canonical server mode and durable command identity through the Python gateway; lost responses and repeated submissions return the same command outcome.
- Confirm replacing an active run, preserve safe prior state on failure, clear stale comparisons and show precise prepared/running/failed/unknown state with recovery.

### S06 — Stream aggregate traffic through Go [P0]

As an operator, I want fresh traffic state in the browser, so that the view reflects the active simulation.

**Owner:** Backend · **Provisional days:** 3–4 · **Depends on:** S04, S05

**Status:** completed — Verified and accepted; evidence in docs/epic2-status.md.

**Audit findings:** A01, A06, A09, A12, A18

Acceptance criteria:

- Publish aggregates at 1 Hz via Python compute gRPC → owning Go service → Python gateway WebSocket → browser; no direct browser access to private services.
- Carry run ID, timestamp, source and per-movement state; include smoothing for noisy observations when applicable.
- Measure state-to-browser latency below 500 ms locally; make stale/disconnected state visible.
- Forward state through owning Go service → Python gateway → browser; validate before persistence or fanout and bind events to run/config/owner epoch.
- Invalidate stale analysis as well as frames; prove ordered reconnect, bounded buffers, jittered retry, multiple clients and stale-owner rejection.

### S07 — Enforce virtual signal timing and phase state [P0]

As a traffic engineer, I want explicit phase transitions, so that simulations respect signal semantics.

**Owner:** Simulation · **Provisional days:** 3–4 · **Depends on:** S05

**Status:** completed — Verified and accepted; evidence in docs/epic2-status.md.

**Audit findings:** A14

Acceptance criteria:

- Expose current phase, remaining time, movement permissions and downstream capacity.
- Represent min/max green, amber, all-red, clearance and conflict constraints from configuration.
- Ensure deterministic phase progression and test conservation of arrivals/departures.
- Reconcile accepted/pending/applied signal timing from actual phase transitions; do not call an enqueued plan physically or virtually applied before observation.
- Exercise simultaneous reset, lock and decision requests; one run owner and serialized command order must preserve configured clearances after failover.

## E03 — Command center & junction intelligence [P0]

**Owner:** Frontend · **Provisional days:** 1–5 · **Epic inputs:** E01, E02

The operator must understand current state and future risk without a dense wall of charts.

**Release gate:** Reaccept every story against revised gateway/writer ownership and applicable UX states; historical completion is not production acceptance.

**Findings:** A03, A04, A06, A13, A15, A16, A20

### S08 — Build the product shell and disclosure [P0]

As an executive viewer, I want a calm and honest operational interface, so that demo outputs cannot be mistaken for live control.

**Owner:** Frontend · **Provisional days:** 1–2 · **Depends on:** S01

**Status:** completed — Verified and accepted; evidence in docs/epic3-status.md.

**Audit findings:** A03, A04, A13, A15, A16, A20

Acceptance criteria:

- Provide only Command Center, Network/Junction Intelligence, Vision Analytics, Incidents, Emergency and Audit & Health product navigation.
- Always display DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL.
- Use a dark neutral theme, restrained status colors and accessible controls; support operator/supervisor/viewer needs.
- Render truthful loading/unknown/offline/degraded/denied states and distinguish demo personas from authenticated roles; no empty health response may show Normal.
- Define URL/back/reload behavior for all six sections; verify narrow screens, keyboard, focus, zoom, text scaling and dark-theme readability.

### S09 — Render the data-driven animated twin [P0]

As an operator, I want moving traffic and signal state on C1–C6, so that I can see how connected traffic evolves.

**Owner:** Frontend · **Provisional days:** 3–4 · **Depends on:** S03, S06, S08

**Status:** completed — Verified and accepted; evidence in docs/epic3-status.md.

**Audit findings:** A04, A06

Acceptance criteria:

- Load geometry from configuration; never hard-code it in React.
- Render direction, queue, flow, speed and signal overlays with smooth interpolation between 1 Hz updates.
- Show no more than five summary KPIs and expose the highest-priority alert and recommendation.
- No-data KPIs/alerts must be unknown rather than nominal or zero risk; map critical nodes using network configuration and distinguish configured free-flow speed from measurements.
- Hide or mark stale overlays; prevent decision use while live state/analysis identity or freshness is invalid, including replay and service loss.

### S10 — Inspect junction state and future horizons [P0]

As an operator, I want a junction drawer and forecast selector, so that I can trace a predicted risk to its cause.

**Owner:** Frontend · **Provisional days:** 4–5 · **Depends on:** S09, S12

**Status:** completed — Verified and accepted; evidence in docs/epic3-status.md.

**Audit findings:** A03, A04, A06, A15, A16

Acceptance criteria:

- Click C1/C3 to inspect approach queues, arrivals/departures, speed, occupancy, storage, phase and remaining time.
- Provide NOW, +30s, +1m, +2m and +5m views; label outputs simulation forecast and 5-minute output advisory.
- Display spillback ETA, upstream cause and expected recommendation impact; do not invent confidence bands.
- Remove fallback C1 arrival/occupancy narratives, fixed 24% impacts and unconditional safety claims; display response-derived facts with run, horizon and model provenance.
- Implement distinct empty/pending/error/stale forecast states, working keyboard tab semantics and retry; recommendation changes must invalidate old drawer impact.

## E04 — Forecasts, platoons & spillback [P0]

**Owner:** Intelligence · **Provisional days:** 4–5 · **Epic inputs:** E02

Prediction before C1 congestion is the key proof of value.

**Release gate:** Reaccept every story against revised gateway/writer ownership and applicable UX states; historical completion is not production acceptance.

**Findings:** A03

### S11 — Implement conservation-based forecasting [P0]

As an operator, I want bounded queue forecasts, so that I can anticipate congestion.

**Owner:** Intelligence · **Provisional days:** 4–5 · **Depends on:** S06, S07

**Status:** completed — Verified and accepted; evidence in docs/epic4-status.md.

**Audit findings:** Cross-cutting revised acceptance

Acceptance criteria:

- Implement Q(t+1) = max(0, Q(t) + arrivals − departures).
- Limit departures by phase, saturation, queue and downstream receiving capacity.
- Output queues, occupancy and arrivals at 30/60/120/300 seconds; test non-negative queues and conservation.
- Reject invalid/version-mismatched inputs and validate forecast outputs; expose model version and freshness through Go and gateway, never substitute unavailable forecasts with healthy values.
- Test timeout/unavailable compute and conservation/regression fixtures; latency claims require named machine and measured distribution.

### S12 — Propagate platoons and predict spillback [P0]

As an operator, I want upstream-aware alerts and ETA facts, so that I can intervene before C1 becomes critical.

**Owner:** Intelligence · **Provisional days:** 5–5 · **Depends on:** S11

**Status:** completed — Verified and accepted; evidence in docs/epic4-status.md.

**Audit findings:** A03

Acceptance criteria:

- Propagate discharge using link travel time, destination split and ETA tolerance.
- Return spillback risk/ETA and deterministic explanation facts including upstream source.
- Peak-surge fixture alerts before C1 becomes critical, with approximately 90–120-second scenario lead time; verify against seeded simulation.
- Replace static ETA bands/lead-time claims with sourced model evidence; document and test actual dispersion assumptions and distinguish travel ETA from spillback ETA.
- Verify each horizon/run mapping and before-congestion warning against seeded simulation; unavailable/expired evidence must not produce no-risk UI.

## E05 — Safety envelope & human authority [P0]

**Owner:** Backend · **Provisional days:** 3–9 · **Epic inputs:** E01, E02

Safety is a prerequisite for any candidate application, including emergency priority.

**Release gate:** Reaccept every story against revised gateway/writer ownership and applicable UX states; historical completion is not production acceptance.

**Findings:** A03, A05, A06, A07, A08, A09, A13, A15

### S13 — Validate every candidate and application [P0]

As a supervisor, I want central safety validation in Go, so that unsafe plans never reach the twin.

**Owner:** Backend · **Provisional days:** 3–6 · **Depends on:** S02, S04, S07

**Status:** completed — Verified and accepted; evidence in docs/epic5-status.md.

**Audit findings:** A03, A08, A09

Acceptance criteria:

- Reject conflicting greens, min/max green violations, amber/all-red/clearance breaches, excessive holds and modeled pedestrian/cross-road wait violations.
- Enforce manual locks, blocked/full receiving links, incident closures and emergency protections.
- On validation failure retain the safe current plan and audit a structured reason; test each rule.
- Serialize locks with fresh application validation and keep safe current state after refusal. Validate inbound lifecycle data before any audit/database write.
- Record rejection or explicit audit-write failure; render requires-validation versus validated/pending/applied without unconditional guarantees.

### S14 — Support observe, recommend and manual modes [P0]

As an operator, I want explicit control of recommendation authority, so that automation cannot override my decision.

**Owner:** Backend + Frontend · **Provisional days:** 6–9 · **Depends on:** S13, S08

**Status:** completed — Verified and accepted; evidence in docs/epic5-status.md.

**Audit findings:** A05, A06, A07, A08, A13

Acceptance criteria:

- Default the demo to recommendation-only mode; observe mode still shows forecasts.
- Manual mode immediately stops new recommendations and honors movement locks.
- Intelligence failure stops recommendations and exposes degradation; there is no physical actuation endpoint.
- Fix SQL parameterization and test every mode with PostgreSQL; persist distinct canonical manual/observe/recommend, hydrate GET /mode on load/reconnect and honor it on start/reset.
- Persist and restore configured movement/phase locks before acknowledging them; expose lock controls and errors, enforce authenticated command roles in shared production.

### S15 — Approve, modify and reject with audit [P0]

As an operator, I want bounded decision controls, so that I retain final authority over the simulated plan.

**Owner:** Backend + Frontend · **Provisional days:** 8–9 · **Depends on:** S13, S19, S22, S25

**Status:** completed — Verified and accepted; evidence in docs/epic5-status.md.

**Audit findings:** A05, A06, A09, A13, A15

Acceptance criteria:

- Expose SIMULATE, APPROVE IN DIGITAL TWIN, MODIFY and REJECT for every recommendation.
- Require a reason for modify/reject, validate bounded edits server-side and revalidate the plan before applying.
- Record actor, timestamp, recommendation ID, before/after, reason, safety result and scenario/run ID; test critical operator flows and invalid edits.
- Display decision success/error/unknown outcome, retain notes/edits after failure and reconcile with audit/command status. Bind drafts to recommendation/run version; require deliberate reason selection.
- Gate actions on fresh state, pending recommendation, permission, mode/replay and service availability; prove cross-tab and lost-response idempotency, including changed payload conflicts.

## E06 — AGDA & network recommendations [P0]

**Owner:** Intelligence · **Provisional days:** 6–7 · **Epic inputs:** E04, E05

Recommendations must coordinate C1/C3 and explain why they improve predicted conditions.

**Release gate:** Reaccept every story against revised gateway/writer ownership and applicable UX states; historical completion is not production acceptance.

**Findings:** A02, A03

### S16 — Implement bounded AGDA phase allocation [P0]

As a traffic engineer, I want demand and fairness aware allocation, so that green time serves need without feeding blocked links.

**Owner:** Intelligence · **Provisional days:** 6–6 · **Depends on:** S11, S13

**Status:** completed — Verified and accepted; evidence in docs/epic6-status.md.

**Audit findings:** Cross-cutting revised acceptance

Acceptance criteria:

- Normalize queue, predicted arrivals and wait age; use weights 0.8 and 0.4 with receiving factor 1 − occupancy².
- Apply fairness, emergency boost and incident penalty; allocate flexible green with clipping/redistribution inside the cycle budget.
- Test bounds, budget feasibility, waiting-age fairness and blocked receiving links; reject infeasible budgets.
- Demonstrate emergency/incident modifiers and downstream constraints with explicit regression cases; a bounded allocation alone is not proof that every requested modifier exists.
- Return infeasible/degraded results honestly through Go/gateway; never publish an actionable candidate until fresh safety and persistence requirements pass.

### S17 — Generate coordinated candidate signal plans [P0]

As an operator, I want bounded network candidates, so that C1 clearance and C3 release work together.

**Owner:** Intelligence · **Provisional days:** 6–7 · **Depends on:** S12, S16

**Status:** completed — Verified and accepted; evidence in docs/epic6-status.md.

**Audit findings:** Cross-cutting revised acceptance

Acceptance criteria:

- Use AGDA plus ±5/10-second split/offset adjustments, allowed cycle lengths and safe configured phase order.
- Coordinate green windows with platoon ETA and gate upstream release when storage is constrained.
- Discard unsafe plans before rollout; do not create arbitrary phases.
- Implement or explicitly defer each claimed ±5/10 split/offset and cycle/phase capability with evidence; current model uses bounded green candidates, not demonstrated full offset search.
- Include candidate provenance/config/run/initial state and validate receiving capacity/locks/emergency conditions before exposing and again before applying.

### S18 — Simulate and score PN-MPC candidates [P0]

As an operator, I want the safest low-cost coordinated recommendation, so that network outcomes guide decisions.

**Owner:** Intelligence · **Provisional days:** 7–7 · **Depends on:** S17, S21

**Status:** completed — Verified and accepted; evidence in docs/epic6-status.md.

**Audit findings:** Cross-cutting revised acceptance

Acceptance criteria:

- Every ~5 seconds evaluate a bounded candidate set over ~120 seconds.
- Score queue, delay, stops, spillback (weight 3), fairness, signal switching, emergency delay and manual preference; invalid candidates have infinite cost.
- Return best plan and two feasible alternatives when available, explicitly explain when fewer exist; measure generation under 2 seconds on the demo machine.
- Test deterministic scoring and scenario behavior; keep application subject to operator and safety checks.
- Preserve stable recommendation and its matching comparison/alternatives while refreshing forecasts; do not mix a retained recommendation ID with a new candidate comparison.
- Benchmark overload, timeout and reduced candidate sets; expose fewer/no feasible alternatives explicitly and keep database acknowledgment outside measured compute-only claims.

### S19 — Explain recommendations from structured facts [P0]

As an operator, I want a traceable recommendation explanation, so that I understand the proposed timing change.

**Owner:** Intelligence + Frontend · **Provisional days:** 7–7 · **Depends on:** S18

**Status:** completed — Verified and accepted; evidence in docs/epic6-status.md.

**Audit findings:** A02, A03

Acceptance criteria:

- Include recommendation ID, priority, affected junctions, trigger, timing changes, predicted impact and safety status.
- Derive explanations from upstream flow, arrival ETA, queue/storage and simulated candidate results.
- No invented operational facts, trained-ML claims or unsupported confidence bands.
- Delete operational fallback narratives and fixed performance percentages; derive every explanation and safety label from matching run/recommendation evidence.
- When no fresh explanation exists show unavailable; include units/model/horizon and accurate improvement, unchanged or deterioration with zero-baseline handling.

## E07 — Before-vs-after evidence [P0]

**Owner:** Simulation + Frontend · **Provisional days:** 6–8 · **Epic inputs:** E02, E05

The operator must test the proposed intervention on equal initial conditions.

**Release gate:** Reaccept every story against revised gateway/writer ownership and applicable UX states; historical completion is not production acceptance.

**Findings:** A02, A06

### S21 — Create isolated, equal-seed simulation branches [P0]

As an operator, I want baseline and candidate rollouts from one snapshot, so that comparisons are fair and never mutate the active run.

**Owner:** Simulation · **Provisional days:** 6–7 · **Depends on:** S05, S07, S13

**Status:** completed — Equal-seed simulation branches with 4 outcome metrics, safety envelope enforcement, zero-mutation verified. Evidence: docs/epic7-status.md

**Audit findings:** A02

Acceptance criteria:

- Clone the same initial state and random seed for baseline and candidate.
- Isolate rollout state from live scenario; validate candidate timing before execution.
- Return max queue, average delay, spillback occurrence and stops/vehicle with units and simulation provenance.
- Document aggregate conservation branches accurately: current comparison is a 120-second aggregate model, not two cloned vehicle trajectories. Provide trajectory data before promising synchronized vehicle-level playback.
- Bind baseline/candidate to one immutable snapshot, seed, command and recommendation; verify zero mutation, cancellation, timeout and persistence/recovery of required comparison results.

### S22 — Show synchronized comparison and impact [P0]

As an operator, I want a synchronized split view, so that I can compare the proposed plan before approving it.

**Owner:** Frontend · **Provisional days:** 8–8 · **Depends on:** S09, S19, S21

**Status:** completed — Split-screen dual canvas, 4 outcome metrics with SIMULATED badge, honest delta indicators, stale comparison rejection, simulation trigger. Evidence: docs/epic7-status.md

**Audit findings:** A02, A06

Acceptance criteria:

- Wire SIMULATE through Python gateway to Go decision service; present equal-state comparison, and only promise matched animated timelines when branch trajectories exist.
- Show only the four outcome metrics with clear simulated labels and honest unchanged/worse outcomes.
- Keep recommendation identity and initial-state provenance visible; handle simulation errors without silently applying the plan.
- Remove defaultComparison and hardcoded improvement labels; only render validated matching results from simulation, including no-result/error/stale and worse outcomes.
- Synchronize real branch trajectories if available or show an explicitly aggregate-only view; clear results on run/recommendation change and ignore late superseded responses.

## E08 — Audit, health & replay resilience [P0]

**Owner:** Backend + QA · **Provisional days:** 2–14 · **Epic inputs:** E01, E02

Reliability and traceability must grow with the system, not wait until the final rehearsal.

**Release gate:** accepted against the direct public Go API, in-process Go persistence, private Python gRPC intelligence boundary and applicable UI states; evidence in docs/epic8-status.md.

**Findings:** A04, A05, A08, A09, A10, A11, A12, A14

### S25 — Persist recommendation and decision audit events [P0]

As a supervisor, I want an append-only decision history, so that I can trace who changed what and why.

**Owner:** Backend · **Provisional days:** 2–4 · **Depends on:** S04

**Status:** completed — Verified and accepted; evidence in docs/epic8-status.md.

**Audit findings:** A05, A08, A09, A10

Acceptance criteria:

- Record recommendations and operator actions including timestamp, actor, recommendation ID, before/after, reason, safety result and run ID.
- Serve paginated audit from the public Go API; expose `audit.appended` through the same Go WebSocket contract.
- Test successful and rejected decisions, persistence and association with the correct scenario.
- The Go API commits command outcome/status/audit together through its in-process persistence module; retain durable intent before dispatch and reconcile unknown/final-audit-failure states after restart. No ignored write errors may appear as success.
- Use authenticated actor for shared production, validate lifecycle before saving, deduplicate per command/payload and verify append-only history through real DB failures.

### S26 — Expose health and safe degraded states [P0]

As an operator, I want visible component health, so that a failed service cannot masquerade as healthy traffic.

**Owner:** Backend + Frontend · **Provisional days:** 4–13 · **Depends on:** S06, S08

**Status:** completed — Verified and accepted; evidence in docs/epic8-status.md.

**Audit findings:** A04, A11, A12

Acceptance criteria:

- Show Go, simulation, intelligence, CV and database availability with timestamps/staleness.
- Show controller NOT CONNECTED, CCTV DEMO/SAMPLE and emergency API SIMULATED.
- Stop recommendations when intelligence fails; display missing/low-confidence state and explain absent optional CV.
- Show the public Go API, simulation, private Python intelligence service and database health with a fresh report timestamp; missing or stale health is unknown/unavailable, never Normal.
- Define offline, maintenance, rate-limit, timeout and recovery states; suppress recommendations without fresh analysis even while stream continues. Optional CV remains explicitly unavailable.

### S27 — Build golden replay through the real delivery path [P0]

As a presenter, I want a deterministic replay fallback, so that the demo survives aggregate-runtime or CV failure offline.

**Owner:** Backend + QA · **Provisional days:** 3–14 · **Depends on:** S02, S06

**Status:** completed — Verified and accepted; evidence in docs/epic8-status.md.

**Audit findings:** A11, A14

Acceptance criteria:

- Implement live/replay selection behind a presenter/admin control; replay travels through the public Go API and the same frontend WebSocket contracts.
- Replay/reset preserve event order, timing and scenario/run identity; visibly indicate replay.
- Capture a known-good eight-minute event stream once scenarios stabilize and verify failure switch-over.
- Expose replay controls in the active Workspace; label all replay-derived views and disable live mutations while replay runs.
- Test aggregate-runtime/intelligence failure, replay end/restart, checksum/config mismatch and WebSocket reconnect. Database loss must show a limitation rather than claiming database-independent replay.

### S28 — Provide audit and health inspection [P0]

As a supervisor, I want an inspectable event timeline and health panel, so that I can verify control and system limitations.

**Owner:** Frontend · **Provisional days:** 9–13 · **Depends on:** S15, S25, S26

**Status:** completed — Verified and accepted; evidence in docs/epic8-status.md.

**Audit findings:** A10

Acceptance criteria:

- Display timestamp, type, junction, recommendation, operator action, before/after, reason and result.
- Navigate from decisions to their audit evidence and display degraded states without hiding them.
- Test critical operator action → persisted audit → visible timeline flow.
- Consume next_after or implement explicit newest pagination; display recommendation ID, before/after, actor, reason, outcome and run links. Prove navigation beyond 100 events.
- Refresh on audit.appended or documented polling, reconcile cursor on reconnect and distinguish loading/empty/error; show uncertain application alongside durable intent.

## E09 — C3 incident & network recovery [P0]

**Owner:** Simulation + Intelligence · **Provisional days:** 10–10 · **Epic inputs:** E06, E07, E08

Incident behavior must protect storage and show recovery, not just extend green.

**Release gate:** accepted against the direct public Go API, private simulation/intelligence gRPC boundary, in-process Go persistence and applicable UI states; evidence in docs/epic9-status.md.

**Findings:** A03, A17

### S29 — Inject C3 capacity loss with controls [P0]

As an operator, I want a configurable C3 incident, so that I can demonstrate capacity loss and propagation.

**Owner:** Simulation + Frontend · **Provisional days:** 10–10 · **Depends on:** S05, S09, S25

**Status:** completed — Verified and accepted; evidence in docs/epic9-status.md.

**Audit findings:** A03, A17

Acceptance criteria:

- Default C3 capacity to 35% of normal; offer incident type and severity/capacity controls.
- Start/reset through the public Go API and private simulation gRPC; persist incident lifecycle through the in-process Go persistence module and display affected links and upstream queues.
- Reset reproducibly restores the original capacity and seed.
- Render actual remaining capacity from config/state (default 35%), lifecycle and affected links; remove hardcoded 50% and C6-controlled-signal copy.
- Add typed permissioned severity/type controls through the Go API with validation, pending/error/reset confirmation and Go persistence-backed incident audit.

### S30 — Gate release and estimate recovery cycles [P0]

As an operator, I want a network recovery strategy, so that the incident does not spread avoidable spillback.

**Owner:** Intelligence · **Provisional days:** 10–10 · **Depends on:** S29, S18, S22

**Status:** completed — Verified and accepted; evidence in docs/epic9-status.md.

**Audit findings:** A17

Acceptance criteria:

- Reduce upstream release, maximize safe discharge and protect receiving storage.
- Forecast C6/upstream propagation and estimate recovery cycles from simulation.
- Compare baseline/candidate; end-to-end test verifies no release into blocked/full links.
- Distinguish configured recovery-cycle countdown from measured queue-clearance estimates; display actual upstream/cross-traffic progression and provenance.
- Test blocked downstream and failover during recovery; never replace unknown recovery with guaranteed cycles or unsupported success.

## E10 — Emergency corridor & cross-traffic recovery [P0]

**Owner:** Simulation + Intelligence · **Provisional days:** 11–11 · **Epic inputs:** E06, E08, E09

Emergency priority is only credible with safe transitions and a bounded return to normal.

**Release gate:** Reaccept every story against revised gateway/writer ownership and applicable UX states; historical completion is not production acceptance.

**Findings:** A03, A13, A17

### S31 — Track the simulated emergency route and ETA [P0]

As an operator, I want a simulated emergency on C6 → C3 → C1 → C2, so that I can see corridor readiness ahead of the vehicle.

**Owner:** Simulation + Frontend · **Provisional days:** 11–11 · **Depends on:** S29, S12, S25

**Status:** backlog — Revalidation required; no implementation performed by this audit.

**Audit findings:** A03, A13, A17

Acceptance criteria:

- Create a simulated authenticated emergency event through Python gateway → Go owner; persist its typed result through gateway → Go writer.
- Display vehicle location, per-junction ETA, pre-clearance schedule, signal state and transition countdown.
- Treat boundary nodes as route points unless explicitly configured as signalized; do not invent a C2 signal.
- Match scheduled/pre_clearance/priority/recovery/complete enums in all screens; show actual ETA, stage/countdown and route position where data exists.
- Authenticate shared-production emergency commands through gateway, persist lifecycle via writer, and show denied/service-loss outcomes without inventing green guarantees.

### S32 — Pre-clear safely and compensate displaced traffic [P0]

As an operator, I want safe priority followed by recovery, so that emergency passage does not starve cross traffic.

**Owner:** Intelligence + QA · **Provisional days:** 11–11 · **Depends on:** S31, S13, S18, S30

**Status:** backlog — Revalidation required; no implementation performed by this audit.

**Audit findings:** A17

Acceptance criteria:

- Enforce normal → amber → all-red → priority → passage → recovery at controlled junctions.
- Emergency priority cannot bypass conflicts, manual/safety constraints or downstream protections; conflicts yield a visible safe outcome.
- Show displaced queues, compensating cycles and return to normal within a configured bound; end-to-end test the full sequence.
- Prove manual locks and emergency scheduling have a consistent protection contract across Go and Python; audit conflicts and preserve safe amber/all-red.
- Show bounded recovery progress and explicit unresolved/exceeded-bound state; regression-test service loss, repeated commands and owner failover during emergency.

## E11 — Presentation & release acceptance [P0]

**Owner:** QA + Product · **Provisional days:** 5–15 · **Epic inputs:** E03, E04, E05, E06, E07, E08, E09, E10

A reliable eight-minute offline demonstration is the release gate.

**Release gate:** Reaccept every story against revised gateway/writer ownership and applicable UX states; historical completion is not production acceptance.

**Findings:** A02, A03, A07, A11, A12, A16, A19, A20

### S33 — Automate the three scenario acceptance journeys [P0]

As the release team, I want repeatable acceptance tests, so that the protected demo capabilities do not regress.

**Owner:** QA · **Provisional days:** 5–14 · **Depends on:** S10, S15, S22, S30, S32

**Status:** backlog — Revalidation required; no implementation performed by this audit.

**Audit findings:** A02, A07, A19

Acceptance criteria:

- Cover Go validation/safety/audit, forecast propagation, AGDA bounds/fairness, PN-MPC scoring and frontend operator flows.
- Run an end-to-end test for peak surge, C3 incident and ambulance corridor with deterministic resets.
- Verify early congestion warning, equal-seed comparison, reasons/audit, safe emergency transitions and recovery.
- Run real browser → gateway → Go → Python compute → gateway/writer → PostgreSQL scenarios without API mocks; test every route/method and independent read-only/stream paths.
- Exercise invalid payloads, offline/slow/lost response, 401/403/409/429/503/504, concurrency, persistence failure, restart and >100 audit records; report skipped/blocked tests separately.

### S34 — Author the guided DGP presentation [P1]

As a presenter, I want an eight-minute guided story, so that executives understand the outcome without verbal rescue.

**Owner:** Product + Frontend · **Provisional days:** 13–14 · **Depends on:** S28, S30, S32

**Status:** backlog — Revalidation required; no implementation performed by this audit.

**Audit findings:** A03, A16, A20

Acceptance criteria:

- Provide START DGP DEMONSTRATION with current state → prediction → recommendation → comparison → incident → ambulance → human override/audit → shadow-pilot ask.
- Use deterministic scenarios and visibly preserve synthetic/no-live-control disclosure.
- Prepare a concise demo script and preflight checklist; presentation polish cannot block core functionality.
- Remove fixed gains, zero-risk/readiness guarantees and unsupported timing from briefing; use sourced run results or clearly labeled explanatory content.
- Tie guided steps to actual run/health state where claiming a demonstration; show unavailable steps and preserve disclosure/focus on small screens and keyboard-only use.

### S35 — Package, benchmark and rehearse offline [P0]

As a presenter, I want a tested offline package and backup, so that the demonstration survives internet and service loss.

**Owner:** QA + Platform · **Provisional days:** 14–15 · **Depends on:** S27, S33

**Status:** backlog — Revalidation required; no implementation performed by this audit.

**Audit findings:** A11, A12, A19

Acceptance criteria:

- Bundle local runtime assets/configs, golden replay and backup recording; run the full demo with internet disabled.
- Measure first load <3s, API p95 <150ms, stream latency <500ms, recommendation <2s, start/reset <5s and 1 Hz updates.
- Verify smooth animation and no browser memory growth during a 30-minute rehearsal; record machine and measurements.
- Day 15 is bug fixes and rehearsal only; do not declare done until every protected acceptance journey passes.
- Measure gateway overhead, writer commit latency, API p95, stream delay, analysis time, start/reset and resource use at declared concurrency/replica counts; no load-balancing claim from proxy presence alone.
- Complete internet-disabled cold-start/replay and local dependency-loss drills plus 30-minute soak; document packaging/machine/results and close applicable audit blockers before release.

## E12 — Optional vision & presentation polish [P2]

**Owner:** CV + Frontend · **Provisional days:** 12–14 · **Epic inputs:** E01, E02, E03

Useful supporting evidence, but explicitly cut before any protected core capability.

**Release gate:** Reaccept every story against revised gateway/writer ownership and applicable UX states; historical completion is not production acceptance.

**Findings:** A16, A17

### S36 — Convert one sample video into traffic aggregates [P2]

As a viewer, I want sample-video traffic analytics at C3, so that I understand how cameras could supply state.

**Owner:** CV · **Provisional days:** 12–12 · **Depends on:** S02, S06

**Status:** backlog — Revalidation required; no implementation performed by this audit.

**Audit findings:** A17

Acceptance criteria:

- Use OpenCV → pretrained YOLO → ByteTrack → lane/ROI mapping → typed aggregate TrafficState via private Go ownership and Python gateway.
- Count once at the directional crossing line, estimate queues/occupancy and label uncalibrated speed as a demo estimate.
- Use clearly labeled non-Odisha sample video, temporary camera-local IDs only; no ANPR, faces or cross-camera identity.
- Current CV is not implemented; keep unavailable until a real sample pipeline passes. Send typed aggregates through its Go owner and gateway; writer persists only declared durable events/aggregates.
- If future capture requires a browser device, add permission requested/denied/permanently denied and recovery states then; do not invent camera permission flows for file-only samples.

### S37 — Show optional vision overlays and upstream impact [P2]

As a viewer, I want video overlays and aggregate metrics, so that the link between observation and prediction is visible.

**Owner:** Frontend + CV · **Provisional days:** 12–13 · **Depends on:** S36, S12, S08

**Status:** backlog — Revalidation required; no implementation performed by this audit.

**Audit findings:** A17

Acceptance criteria:

- Show boxes, temporary tracks, lanes/counting line and queue ROI for the single sample video.
- Display class counts, lane flow, queue, occupancy, direction and C1 arrival/ETA/risk outputs.
- Missing CV must not block the demo or golden replay; display unavailable honestly.
- Explicitly label absent CV/sample input and provide retry or return; no camera extraction claims until a pipeline is available.
- Verify loading/empty/error/unsupported video and responsive accessible overlays; carry sample/model/provenance and keep core scenario/replay usable without CV.

### S38 — Refine optional charts and motion [P2]

As a viewer, I want restrained presentation polish, so that the explanation is easier to follow.

**Owner:** Frontend · **Provisional days:** 14–14 · **Depends on:** S10, S22

**Status:** backlog — Revalidation required; no implementation performed by this audit.

**Audit findings:** A16

Acceptance criteria:

- Add heatmaps/advanced charts only if they clarify already-tested behavior and time remains.
- Use 150–250ms transitions and smooth vehicle interpolation; critical alerts pulse once rather than continuously.
- Respect reduced motion; remove nonessential animation before compromising reliability.
- Retain reduced-motion behavior and verify no looping or inaccessible alert motion; measure contrast/text/targets and avoid status conveyed only by color.
- Optional polish cannot mask stale/unavailable data, add invented comparisons or block critical flows; scope and accept it only after mandatory gates.

## E13 — Go control plane and API reliability [P0]

**Owner:** Platform + Backend · **Provisional days:** 1–15 · **Epic inputs:** E01

Align the public Go gateway, in-process persistence, gRPC controls, and API contracts with the supplied specifications.

**Release gate:** All stories require implementation and measured acceptance; no work is claimed complete.

**Findings:** A01, A07, A08, A09, A10, A11, A12, A13, A14, A18, A19

### S39 — Establish the Go public gateway boundary [P0]

As the release team, I want one Go public gateway and private Python compute boundary, so that requests, authority, and operations are verifiable.

**Owner:** Platform · **Provisional days:** 1–15 · **Depends on:** S01, S02

**Status:** completed — Completed and verified; evidence in docs/epic13-status.md.

**Audit findings:** A01, A12, A13

Acceptance criteria:

- Expose versioned REST and WebSocket ingress from the Go API; preserve stable status, typed errors, correlation/request IDs, principal, run ID, and deadline.
- Keep Python private for simulation and intelligence gRPC only. Do not deploy a Python HTTP gateway or expose Python/database ports to browsers.
- Test wrong methods, unknown routes, readiness, bounded timeouts, and loopback-only synthetic demo operation.

### S40 — Make endpoint ownership and contracts exhaustive [P0]

As the release team, I want to make endpoint ownership and contracts exhaustive, so that the requested architecture and operator journeys are verifiable.

**Owner:** Platform + QA · **Provisional days:** 1–15 · **Depends on:** S02, S39

**Status:** completed — Completed and verified; evidence in docs/epic13-status.md.

**Audit findings:** A01, A07, A18

Acceptance criteria:

- Maintain machine-checkable method/path → Go owner → RPC → persistence-class mapping for every row in the audit inventory and every frontend request; include mode, locks, replay, stream and compatibility aliases.
- Generate/validate OpenAPI, protobuf and runtime response schemas; use canonical modes and distinct start/decision/comparison types. Unknown route/method and invalid versions fail explicitly.
- Contract tests prove each route reaches its specified owner, wrong-owner requests fail, and reads/health/stream do not accidentally create writes.

### S41 — Persist domain results through the Go persistence module [P0]

As the release team, I want Go persistence modules to commit domain results, so that durable operator workflows remain simple and auditable.

**Owner:** Backend · **Provisional days:** 1–15 · **Depends on:** S04, S39, S40

**Status:** completed — Completed and verified; evidence in docs/epic13-status.md.

**Audit findings:** A01, A08, A09, A14

Acceptance criteria:

- Go domain modules use pgx/sqlc repositories and PostgreSQL transactions to commit typed result/status/audit records atomically. No arbitrary SQL or blind payload insertion.
- Persist command ID, actor, run/config/owner version and payload hash with a uniqueness constraint; replay the stored outcome on identical retry and return conflict for same ID/different payload.
- For actuation, commit intent before dispatch, then reconcile applied/failed/unknown and finalize audit; never imply a database transaction can atomically cover an aggregate-runtime RPC. Expose a permissioned command-status read contract.
- Inject database failure, timeout after commit, lost acknowledgment and restart; prove no duplicate effects or silent successful writes. Classify frames/reads separately from durable business results.

### S42 — Preserve state ownership and live-stream continuity [P0]

As the release team, I want to preserve state ownership and stream continuity across replicas, so that the requested architecture and operator journeys are verifiable.

**Owner:** Platform · **Provisional days:** 1–15 · **Depends on:** S06, S39, S41

**Status:** completed — Completed and verified; evidence in docs/epic13-status.md.

**Audit findings:** A01, A10, A11, A12

Acceptance criteria:

- Define one authoritative owner per active run with durable lease/epoch and fencing; route stateful commands and WebSocket subscriptions to that owner. Stateless queries may balance among healthy replicas.
- Externalize or reconstruct run/mode/locks/command outcomes; distribute replay assets by verified config/hash; test reconnect, drain and failover without two simulators controlling the same run.
- Bound fanout buffers and reconnect backoff; document transient frame loss versus durable audit cursor recovery. No multi-replica readiness claim until owner-loss tests pass.

### S43 — Verify Go gateway routing and persistence [P0]

As the release team, I want to verify Go gateway routing and persistence, so that the documented operator journeys are verifiable.

**Owner:** QA + Platform · **Provisional days:** 1–15 · **Depends on:** S40, S41, S42

**Status:** completed — Completed and verified; evidence in docs/epic13-status.md.

**Audit findings:** A01, A09, A14, A19

Acceptance criteria:

- Trace every frontend endpoint and durable write through the Go gateway, private Python gRPC when required, and PostgreSQL with request/command IDs.
- Run concurrent clients, inject database and Python timeouts, and measure p95/error/recovery rates. The modular monolith is the declared MVP topology.
- Verify migrations, idempotent command retries, rollback behavior, and a recorded recovery procedure; no uncontrolled dual writes.
- Record machine, versions, dataset, replica/client counts, duration and raw output; failure/skip is not a pass. Revalidate all existing scenario and audit journeys.

## E14 — Production UX, access & acceptance [P0]

**Owner:** Frontend + QA · **Provisional days:** 1–15 · **Epic inputs:** E03, E05, E08

Mandatory revised release scope; scheduling is provisional and must be re-estimated after design and evidence review.

**Release gate:** Accepted against responsive production UX, session recovery, truth-in-loading states, and full-audit reacceptance; evidence in docs/epic14-status.md.

**Findings:** A04, A05, A06, A08, A10, A11, A12, A13, A14, A15, A16, A18, A19, A20

### S44 — Implement truthful loading, failure and recovery states [P0]

As the release team, I want to implement truthful loading, failure and recovery states, so that the requested architecture and operator journeys are verifiable.

**Owner:** Frontend · **Provisional days:** 1–15 · **Depends on:** S08, S09, S10, S26

**Status:** completed — Completed and verified; evidence in docs/epic14-status.md.

**Audit findings:** A04, A05, A06, A11, A12, A18

Acceptance criteria:

- Each mounted screen distinguishes loading, valid empty, invalid data, stale, offline, slow timeout, unavailable and maintenance; no fabricated comparison, safety, healthy or completion claims.
- Retain typed HTTP status/code/request ID; use cancellation/deadlines and accessible retry. Clear superseded run/recommendation data and provide an error boundary with a safe recovery action.
- Restore replay controls in active Workspace and test dependency loss and replay completion. Render health provenance and configured fallback topology explicitly.

### S45 — Make operator journeys recoverable and idempotent [P0]

As the release team, I want to make operator journeys recoverable and idempotent, so that the requested architecture and operator journeys are verifiable.

**Owner:** Frontend + Backend · **Provisional days:** 1–15 · **Depends on:** S14, S15, S22, S28, S41

**Status:** completed — Completed and verified; evidence in docs/epic14-status.md.

**Audit findings:** A05, A06, A08, A10, A14, A15

Acceptance criteria:

- Disable conflicting/pending/unauthorized/stale/replay actions; confirm active-run replacement and reset. Preserve reason/timing drafts after errors and warn on navigation away.
- Use payload-bound durable command identity, surface pending/applied/rejected/unknown outcomes and reconcile after timeout/reload; never retry ambiguous writes blindly.
- Hydrate server mode/locks, bind drafts/comparison to run and recommendation, support browser back/deep links, and paginate/link full audit evidence beyond 100 records.

### S46 — Enforce production roles and session recovery [P0]

As the release team, I want to enforce production roles and session recovery, so that the requested architecture and operator journeys are verifiable.

**Owner:** Backend + Frontend · **Provisional days:** 1–15 · **Depends on:** S08, S39, S40

**Status:** completed — Completed and verified; evidence in docs/epic14-status.md.

**Audit findings:** A13

Acceptance criteria:

- Define operator/supervisor/viewer capabilities and enforce them in gateway and Go domain handlers; authenticate private writer/compute calls. Client role selector remains demo presentation only.
- Record authenticated audit actor; test unauthorized reads/mutations, expired/revoked sessions and direct-service attempts. Select and document session/identity mechanism during implementation.
- Show 401 sign-in/expiry and 403 denied recovery without losing drafts or replaying actions; require a fresh permission/state check after reauthentication. No payment/device permission feature is added without scope.

### S47 — Verify accessibility and responsive critical flows [P0]

As the release team, I want to verify accessibility and responsive critical flows, so that the requested architecture and operator journeys are verifiable.

**Owner:** Frontend + QA · **Provisional days:** 1–15 · **Depends on:** S08, S10, S44

**Status:** completed — Completed and verified; evidence in docs/epic14-status.md.

**Audit findings:** A16

Acceptance criteria:

- Test all six screens, action forms, drawers, health popup and briefing at 320/375/768/1280 widths, 200% text and 400% zoom; keyboard opening/closing/back, virtual keyboard and long values must keep controls usable.
- Implement accessible tab/dialog focus and Escape/return behavior, meaningful labels/live errors, non-color status and adequate measured contrast/target sizes; record screen-reader checks and dark-theme coverage.
- Honor reduced motion; attach measured visual evidence and document any assistive-device coverage limitation rather than claiming a blanket pass.

### S48 — Reaccept every epic with auditable production evidence [P0]

As the release team, I want to reaccept every epic with auditable production evidence, so that the requested architecture and operator journeys are verifiable.

**Owner:** QA + Product · **Provisional days:** 1–15 · **Depends on:** S33, S35, S43, S44, S45, S46, S47

**Status:** completed — Completed and verified; evidence in docs/epic14-status.md.

**Audit findings:** A19, A20

Acceptance criteria:

- Close all applicable Critical/High findings and critical-journey Medium gaps in UX-PRODUCTION-AUDIT.md; record fix revision, exact test, result, owner and residual risk for each.
- Run real three-scenario production-path, offline/replay, database/compute failure, load/failover and accessibility acceptance; distinguish mocked tests, static findings, measured results and untested assumptions.
- Update PRD/backlog/delivery status together; retain historical evidence without presenting old completion as current. Personal dashboard tracking must not be treated as release approval.

## Scope decisions

- **CV has conflicting scope language:** PRD §3.1 lists a sample-video pipeline as must-build. AGENT.MD explicitly calls it optional, and PRD §27 cuts it in a 10-day build. Plan it as P2; core traffic remains synthetic.
- **Safety and replay move earlier:** The PRD places some reliability work late. This plan begins the safety envelope, audit and replay plumbing alongside integration, with final recording and rehearsal after scenarios stabilize.
- **C2 is a boundary in the first build:** The emergency route reaches C2, but PRD §2.1 controls only C1/C3. Show ETA and route progress at C2; signal offsets/pre-clearance there require explicit signal configuration.
- **Ten days requires parallel capacity:** The compressed view is a proposed sequence, not a delivery promise. Frontend, Go/backend, simulation/intelligence and QA must overlap. CV and optional polish are removed; release gates remain.
- **Planning dashboard is not the product UI:** This standalone HTML/CSS/JS artifact lives under docs. The traffic MVP retains the required Next.js/Go/Python stack and six-screen navigation. No traffic service is implemented by this dashboard.
- **Python gateway and Go writer are now required:** User requirement supersedes original Go-only browser ingress/no-extra-services rule for these boundaries. Existing Python compute remains private. See PRD §32 and exhaustive audit route inventory.
- **Durable results are not every network frame:** Persist typed business command outcomes, status and audit via Go writer; reads and high-frequency stream frames are not blindly inserted. Actuation uses durable intent plus reconciliation.
- **Completion must be reaccepted:** Prior S01–S15 acceptance records remain historical. Revised acceptance and production evidence are pending; personal dashboard status cannot approve release.

## Deferred scope

- Real Odisha CCTV or signal-controller connections and physical actuation
- ANPR, facial recognition and cross-camera identity tracking
- RL, GNN, custom trained forecasting without real evidence
- Kafka, Kubernetes, Redis, service mesh and unrelated extra microservices (required Python gateway and Go writer are in scope)
- City-wide model, citizen app, enforcement/e-challan and cloud deployment

## Release evidence

See [production audit](UX-PRODUCTION-AUDIT.md) for exact file evidence, severity, test outcomes and limitations. All applicable Critical/High blockers and critical-flow Medium gaps must close. Release approval requires real routing, persistence, safety, offline/recovery, concurrent/failover and accessibility evidence; dashboard percentages or mocked browser checks cannot replace it.
