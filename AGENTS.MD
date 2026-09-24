# Traffic Digital Twin: agent instructions

## Read this first

Current objective: deliver the **functional engineering prototype** in `docs/IMPLEMENTATION-PLAN.md`. Use `docs/WORKTREE-EXECUTION-PLAN.md` for task IDs, ownership, dependencies and merge order; `docs/contracts-plan.md` for clock and observation semantics; and `docs/API-ARCHITECTURE-SPEC-ALIGNMENT.md` for the current service boundary. Read the relevant code and tests before changing it. `docs/PRD.md` and older epic/demo material provide background, but their Python-gateway, Next.js, optional-video and scripted-demo statements are superseded by the documents above. Direct user instructions take priority.

Do not infer completion from a task card, screenshot, replay, dashboard percentage or old status file. Confirm behavior in current source and with current evidence. If documents conflict, record the conflict in the task handoff and follow the newer milestone and architecture decisions. Do not silently expand the field-pilot scope.

## Milestone and hard boundaries

Deliver an operator workflow that registers an authorized recorded clip, runs real detection/tracking, inspects finalized aggregate observations, maps selected counts to declared **virtual** boundary demand, forecasts 30/60/120/300 seconds, compares bounded coordinated signal plans and lets an authenticated operator approve, modify or reject. An approved plan must change the virtual scheduler at a safe boundary and leave a durable audit trail. The original two-controlled-junction graph and a synthetic three-controlled-junction graph must both work. Preserve the three existing scenario types: peak, incident and emergency.

Keep the finite-capacity aggregate road-cell engine; do not add SUMO, TraCI or individual-vehicle simulation to the operating path. Physical signal actuation stays disabled. Recorded footage is immutable evidence; a virtual plan cannot change it. Independent clips are not a measured physical corridor. Synthetic lengths, capacities, turning ratios and vehicle-space assumptions remain labelled synthetic until calibrated. Live RTSP, municipal/ATCS comparison, physical-controller integration, field acceptance and production deployment belong to a later phase.

## Codebase and ownership

- Web: React, TypeScript and **Vite** in `apps/web`, with the existing Tailwind/Zustand/TanStack Query stack. Verify the package manifest before following older Next.js references. Keep the command-centre UI clear and accessible; show unavailable values instead of invented precision.
- Public control plane: Go `apps/api`, REST/WebSocket, in-process persistence through pgx/sqlc and PostgreSQL. Go owns credentials/sessions, authorization, commands, idempotency, validation, safety gate, audit, replay and run-report export. Browser commands go only to Go. WebSocket is not a command channel.
- Private computation: Python `services/simulation`, `services/intelligence` and `services/vision`; use versioned gRPC contracts where services meet. Python does not authorize operator decisions or write them directly to PostgreSQL. Do not add a Python HTTP gateway or separate DB-writer service.
- Shared topology and contracts: `packages/scenario-config`, `packages/camera-config`, `packages/contracts`. Load graph, boundary mapping, incident location and emergency route from configuration; do not embed C1/C3 or camera assignments in operating logic. Preserve protobuf numbering and regenerate checked-in bindings together.
- Keep source video, tracking identities, credentials and private model assets out of run reports and git. Association state is transient; no ANPR, face recognition or cross-camera identity tracking. Do not add Kafka, Redis, Kubernetes, RL or GNN for this milestone.

## Data, time and causal rules

- Keep source time, crossing event time, finalized-window availability, virtual simulation time and wall clock distinct. A finalized window is usable only after its end and actual processing completion. Reject or mark missing, duplicate, stale, out-of-order and degraded input explicitly. Valid zero crossings are not missing input.
- Identify inputs by clip hash, geometry/config hash, detector/tracker version, observation schema, source session, finalized window and availability time. Cache only on matching identity. A run binds to one authoritative input session. A display-only seek changes no run input; a seek/restart that changes authoritative input invalidates forecasts, comparisons and recommendations in Go and UI. An old approval remains invalid after input recovers; fresh analysis is required.
- Feed bounded, non-overlapping finalized history to persistence and EWMA forecasting, isolated by run, boundary and source session. Never expose future bins or events to an earlier forecast. Preserve offered external mass in boundary backlog when admission is blocked. Test the conservation identity in `docs/contracts-plan.md`.
- Return forecast method, origin, age, quality and horizon availability. Report uncertainty only when calibrated with defensible reference data. Do not loop short clips or invent long-horizon recorded-data scores. Speed is unavailable without physical calibration; visible queue is an estimate only where region and labels support it.
- The legacy `pedestrain` class key is versioned contract data: change it only through C00/C01 migration. Detector output is not independent ground truth, and automatic `agent_reviewed` labelling in existing emitters needs correction during the relevant task.

## Decisions and operator safety

- Derive actor and role only from verified, expiring, revocable server sessions; use protected cookies and request-origin checks. Ignore browser-supplied `X-Role`/`X-Actor`. Viewer mutations fail. Preserve drafts and uncertain-command lookup across session expiry; record the authenticated actor in the audit.
- Compare the current plan with bounded alternatives from the **same complete snapshot and demand assumptions**. Make scoring weights, units, candidate count, horizon, concurrency and minimum benefit explicit. Include queue delay, exits, boundary backlog, spillback, service fairness and timing changes; treat emergency priority/recovery separately. Individual stops and journey time are unavailable until a defensible estimator exists.
- Distinguish `recommend`, `no_action` (safe current plan is best or gain too small) and `cannot_evaluate` (input/compute unsuitable). Do not force a timing change or fabricate improvement. On timeout, conflict or stale result, retain the current safe plan.
- Validate whole-corridor timing, offsets/activation, min/max green, manual locks, conflicting movements, pedestrian clearance, amber/all-red, downstream storage and emergency protection at actual safe boundaries. Approval rechecks run, source session, snapshot sequence and versions server-side. Modify/reject requires a reason; approve/modify/reject and applied outcomes are audited. A mock/virtual adapter is the only control target.
- Show queue delay (veh·s), boundary exits (veh), waiting-to-enter backlog (veh) and worst-served approach (maximum red/service debt, a model metric) for baseline and candidate over the same window. A falling central queue with growing boundary or side-road delay is not an unconditional improvement.

## UI and evidence labels

Keep source video time, latest completed observation window, simulation time and forecast origin visible together with data-quality status. Label camera measurements, video-derived scenario demand, model state, forecasts and virtual control gains separately. Distinguish fresh inference, valid cached observations, synthetic inputs and prerecorded replay. Replay starts only by explicit operator action with a visible replay label; never silently substitute it after compute fails. Show authenticated command recovery and allow one-action run-report export without raw media, tracking IDs or secrets.

## Parallel task workflow

Use the assigned `task/<id>-<slug>` branch in an isolated worktree. The task board lists task IDs and prerequisites; the corresponding branches are precreated locally. Update a task worktree with merged prerequisites before final integration. Keep one owner for each shared contract or hotspot: C01 owns protobuf/generated/public schema edits; coordinate changes to `decision.go`, `workspace.tsx` and readiness claims with the designated task owner. Do not merge parallel branches into `main` concurrently or overwrite another agent's work. Preserve unrelated dirty files. Commit focused changes with test evidence and a concise handoff stating files, interface changes, tests and remaining risks.

For each behavior change, first pin the missing behavior with a focused failing regression, implement it, run focused tests and review the diff. Then run affected Go/Python/web suites after each integration. A passing mock-backed `scripts/run-python-tests.py` result is useful for unit tests but is **not** real gRPC/OpenCV acceptance. Do not weaken safety, authentication or evidence requirements to make a test green.

## Acceptance and reporting

The six gates in `docs/IMPLEMENTATION-PLAN.md` all remain open until verified: authenticated access and accurate claims; integrated causal forecast; bounded safe plan evaluation and virtual actuation; real recorded-video input; predefined measurement/control benchmarks; reproducible package and full-stack operation. Freeze metrics, held-out clips/time periods, baselines, thresholds and resource budgets before evaluating held-out results. Keep independently reviewed reference labels separate from detector predictions. An operator who did not implement the pipeline must process reserved input through the runbook.

Run the real Go/PostgreSQL/Python/browser path with newly processed observations, all three scenarios and both graphs. Verify plan application changes later virtual signal state; test restart, dependency loss, stale approval, draft/command recovery, explicit replay and report export. Measure fresh-video inference, simulation and candidate evaluation separately on the target machine, including CPU/RAM, input age and state-to-recommendation latency against the 2–5-second target. Start with one fresh video plus cached supported boundary inputs; declare supported concurrency from measurements, not camera count. Report failed or unavailable gates plainly. Field benefit and field readiness are deferred, never implied by prototype results.
