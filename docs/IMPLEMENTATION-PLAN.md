# Functional Traffic Prototype Implementation Plan

**Goal:** Build a usable, testable traffic decision-support prototype that processes recorded traffic video, forecasts demand and congestion, evaluates coordinated signal plans and applies approved changes to the virtual network, with measured correctness and resource usage.

**Architecture:** React/Vite → Go API and PostgreSQL → private Python simulation and intelligence. Video perception produces aggregate observations; the simulator stores quantities per road cell, not individual vehicle identities.

**Baseline and scope:** `/home/soumyajeet/Downloads/Bhubaneswar_Predictive_Traffic_Control_PRD.docx`, especially sections 3, 6–8, 16 and 19; repository commit `fe8507c`; and the later decisions in `Traffic_Digital_Twin_Agent_PRD_v1.0.1.md` §2. The current milestone implements and evaluates the engineering core. A Bhubaneswar field pilot and the original city-specific exit criteria belong to a later milestone, not this plan's completion gates.

**Status:** Proposed work only. No application changes or acceptance tests have been performed as part of writing this plan.

## What this milestone must deliver

An operator can register a supported recorded clip, process it through real detection/tracking, inspect measured aggregate observations, use selected observations as declared virtual-network demand, receive forecasts and signal alternatives, compare their outcomes, and approve/modify/reject a plan. Approved timing must actually change the virtual scheduler and subsequent model state at a safe boundary, with an audit record. The recorded footage remains source evidence; its traffic cannot be changed by a virtual signal plan.

The same workflow must work on supported clips and configured scenarios beyond a fixed presentation script. Acceptance requires automated checks, recorded-data evaluation, repeatable model experiments and target-machine performance measurements. Screenshots, prerecorded recommendations and delivery-dashboard percentages are insufficient.

## Design decisions to retain

- Keep the finite-capacity aggregate engine. Do not reintroduce SUMO, TraCI, or individual-vehicle simulation into the operating path.
- Keep Go responsible for public commands, authorization, persistence and audit; keep Python responsible for computation.
- Keep human approval, signal-clearance constraints, manual takeover, command recovery and reproducible replay.
- Support fresh processing of recorded clips and reuse cached observations for repeat runs. Benchmark inference separately and label its actual capability; simultaneous real-time processing of all 12 cameras is not a completion requirement.
- Retain the current two-junction network and add a small synthetic three-controlled-junction configuration to verify that the core is not hard-coded to C1/C3. No real connected-camera corridor is required for this milestone.
- Keep physical signal actuation disabled. The virtual scheduler/mock adapter is the control target.
- Label camera observations, video-derived scenario demand, modeled network state and forecasts separately. Independent sample clips must never be presented as one measured physical corridor.

## 1. Correct access control and release claims

**Change:** Replace demonstration identity with verified credentials and server-controlled sessions. Reconcile documentation with actual capabilities.

**Main files:** `apps/api/internal/httpapi/access.go`, `session.go`, `apps/api/cmd/api/main.go`, `scripts/create-gateway-user.py`, `apps/web/lib/api.ts`, `apps/web/components/session-panel.tsx`, `README.md`, `docs/REMEDIATION-STATUS.md`, `readiness.json`.

- [ ] Wire password verification to the existing account-provisioning format; derive actor/role exclusively from the authenticated session. Add expiry, logout/revocation, protected cookies and request-origin checks.
- [ ] Remove browser-controlled `X-Role`/`X-Actor` authority and the anonymous operator default. Preserve draft and uncertain-command recovery across session expiry.
- [ ] Report functional-prototype readiness, recorded-data measurement quality, modeled forecast/control benefit and resource limits separately. Mark field validation as outside this milestone, rather than claiming it passed or letting it block prototype completion.
- [ ] Verify wrong passwords, missing/expired/revoked sessions, forged role headers and viewer mutations are rejected; verify accepted actions retain the authenticated actor in the audit.

**Done when:** Public operator actions require verified identity and reports no longer claim capabilities absent from the code.

## 2. Connect the causal forecasting implementation

**Change:** Use recent observation history deliberately, with persistence as a baseline and EWMA as the initial candidate method.

**Main files:** `services/intelligence/forecast_demand.py`, `model.py`, `service.py`, `services/simulation/video_demand.py`, `packages/contracts/proto/twin.proto`, generated contracts, forecast UI schemas, `apps/web/components/workspace.tsx`, and `apps/web/components/vision-analytics-panel.tsx`.

- [ ] Supply bounded, non-overlapping finalized observation history to the predictor. Isolate history by run, boundary and source; reset it when their identity changes.
- [ ] Connect the existing forecaster to the actual `Analyze`/rollout path. Treat valid zero counts differently from missing or stale observations and retain offered demand when admission is blocked.
- [ ] Return forecast method, data age and quality. Add empirically evaluated uncertainty bounds when references support them; otherwise return uncertainty as unavailable.
- [ ] Display video source time, the latest completed observation window, simulation time and forecast origin together with missing/stale/unreliable input status. When a seek or restart changes the authoritative input session, invalidate dependent forecasts, comparisons and recommendations in both the API and UI before permitting another approval. A display-only seek must be labelled as independent of the active run and must not alter its input silently.
- [ ] Retain 30/60/120/300-second horizons. Evaluate each horizon only where sufficient later reference data exists; do not stretch or loop short clips to fabricate a long-horizon accuracy result.
- [ ] Verify future observations cannot affect an earlier forecast, cross-run history cannot leak, and missing input cannot silently become zero demand.
- [ ] Verify source-session changes reject old approvals even if the browser retains a previous recommendation; verify restoring valid input produces a new eligible analysis rather than reactivating an old result.

**Done when:** The served forecast uses the declared method, exposes its time origin and input quality, can be scored against later observations, and cannot remain actionable after its authoritative input changes or becomes unsuitable.

## 3. Complete bounded signal-plan evaluation

**Change:** Expand useful control choices while maintaining a predictable compute budget.

**Main files:** `services/intelligence/model.py`, `services/simulation/safety.py`, `services/simulation/metrics.py`, `packages/contracts/proto/twin.proto`, `apps/api/internal/httpapi/decision.go`, and decision UI components.

- [ ] Make scoring weights and units explicit. Include delay, spillback, throughput/backlog, service fairness and timing changes; evaluate emergency priority and recovery separately. Mark individual stops/journey-time metrics unavailable until a defensible estimator exists.
- [ ] Add bounded offset/activation-time support through the plan contract, virtual scheduler and a mock controller adapter. Validate whole-corridor plans at their actual safe activation boundaries.
- [ ] Keep the current plan among candidates. Limit candidate count, evaluation horizon and concurrent analyses; discard stale results and keep the current safe plan if evaluation times out.
- [ ] Represent “no action needed” separately from “cannot evaluate.” Retain the current safe plan when it ranks best or improvement is below a declared minimum-benefit threshold. For insufficient/unreliable input, timeout or unavailable compute, explain why no recommendation can be made. Neither outcome should create a forced timing change or a fabricated improvement.
- [ ] Compare every candidate from the same complete snapshot and demand assumptions. Test no-benefit cases, full downstream storage, locked approaches, pedestrian/amber/all-red clearance, emergency conflicts and fairness.
- [ ] Show total queue delay, vehicles exiting, vehicles waiting to enter and the worst-served approach in every baseline/candidate comparison, with explicit units and the same evaluation window. Define worst-served approach using maximum red/service debt and label it as a model metric. Include a regression case where central-junction queues fall only because boundary backlog or side-road waiting rises; it must not be presented as an unconditional network improvement.

**Done when:** Plans use the supported control dimensions, meet configured safety bounds and report comparable aggregate KPIs within the measured compute budget. The system can explain when retaining the current plan is preferable and makes displaced congestion visible.

## 4. Make recorded video a functional input

**Change:** Support repeatable ingestion and measurement of available recorded videos, then connect their aggregate counts to a configurable virtual network. Data preparation can begin while steps 1–3 proceed.

**Main files:** `packages/scenario-config/`, `packages/camera-config/`, `services/vision/itd_pipeline.py`, `concurrent_orchestrator.py`, `services/simulation/video_demand.py`, `services/shared/network_config.py`, `services/intelligence/model.py`, `apps/api/internal/httpapi/observations.go`, and `apps/web/components/vision-analytics-panel.tsx`.

- [ ] Register a supported local clip, configure its counting/queue regions, process it with the real detector/tracker, save versioned observation windows and expose processing status/errors in the UI. Reuse valid cached results without making fresh processing depend on a presentation script.
- [ ] Create a small reviewed reference subset from usable existing footage, including ordinary, crowded and difficult windows. Keep reference counts separate from detector predictions; do not use the detector's own outputs as ground truth. Evaluate visible queue estimates only where reference labels support them.
- [ ] Use source timestamps and finalized windows consistently across playback, seeking, reset and processing. Test corrupt/missing clips, missing/out-of-order windows, end-of-file and overload with explicit unavailable/degraded states.
- [ ] Map chosen count streams to virtual boundary demand through configuration and preserve mass without double-counting. Keep road lengths, turning ratios, capacities and vehicle-space assumptions explicitly synthetic unless measurements justify calibration. Camera speed remains unavailable without physical calibration.
- [ ] Remove runtime assumptions tied to C3/C1 and hard-coded boundary-camera assignments. Run the original graph and the synthetic three-controlled-junction graph, including configurable incident locations and declared emergency routes.

**Done when:** A supported recorded clip can produce inspectable observations and drive an actual virtual-network run, with source provenance, measurement-error results on reviewed samples and no dependence on synchronized Bhubaneswar footage.

**Input requirement:** Usable, authorized recorded footage and a bounded reviewed reference subset. Existing sample clips can supply these. Independent reference review is needed for accuracy claims on that subset; city permissions, field measurements and a full municipal ground-truth dataset are not prerequisites.

## 5. Measure prototype accuracy and control benefit

**Change:** Evaluate recorded-data measurements and virtual-network decisions separately, with repeatable baselines. This establishes the engineering prototype's capability without claiming Bhubaneswar field effectiveness.

**Main files:** New `scripts/evaluate-prototype.py` and `docs/prototype-evaluation.md`; existing `tests/integration/`, forecasting tests and benchmark reports.

- [ ] Define tuning and held-out clips/time periods plus multiple synthetic seeds and network configurations. Freeze metrics, test cases, required improvements and tolerated regressions before evaluating held-out results. A city traffic reviewer is not required to run this engineering benchmark.
- [ ] Reserve supported clips and scenarios that were not used for tuning. Split time periods chronologically, and keep overlapping forecast target windows out of the tuning/evaluation boundary. Have an operator who did not implement the pipeline register a reserved clip, configure its counting region, process it and inspect its forecast/decision using the runbook, without developer edits or hidden setup. Record failures as acceptance issues.
- [ ] For recorded data, report count/visible-queue errors against the reviewed subset and forecast error against later available observation windows. Compare demand forecasts with persistence; identify whether the target is a reviewed reference or detector-derived count. If clips are too short for a horizon, mark its recorded-data score unavailable and test its software behavior using synthetic traces.
- [ ] For the virtual network, compare multi-junction forecasting with persistence and local-only variants. Compare control with fixed timing and a documented local adaptive baseline under identical demand and starting state. Observed ATCS operation is not a required baseline at this stage.
- [ ] Report aggregate delay, throughput, queue/spillback exposure, fairness and emergency recovery across peak, off-peak, incident and degraded-input conditions. Include held-out capacities, turning ratios, demand perturbations and analytical conservation checks so success is not limited to one scripted scenario or an identical world/predictor setup.
- [ ] Record no-benefit cases and regressions. Require the declared benchmark improvements without violating safety or fairness and without merely moving congestion outside the network; retain the current plan when alternatives do not help. Revise the implementation if these engineering gates fail.

**Done when:** The functional system passes its predefined engineering benchmarks, reports where predictions/plans help and where they do not, and distinguishes measured video results from modeled control gains. Real-world corridor benefit remains a later validation question.

## 6. Package and verify the prototype

**Change:** Deliver a reproducible local engineering package that another operator can use and evaluate on the supported machine.

**Main files:** `compose.yaml`, `scripts/start_all.py`, `scripts/run-python-tests.py`, `RUNBOOK.md`, `KNOWN_LIMITATIONS.md`, `readiness.json`, and browser/integration verification scripts. For run export, add `apps/api/internal/httpapi/run_report.go` and `apps/api/internal/store/run_report.go`; update the public contracts and `apps/web/components/workspace.tsx`.

- [ ] Package pinned application dependencies, services, model/asset manifests and local startup. Document supported input formats, asset rights, clip processing, benchmark execution and operator workflows.
- [ ] Keep services on loopback with authenticated commands, private compute credentials, restrictive file permissions and checked asset/configuration hashes. Network-accessible deployment, its TLS configuration and operational credential management belong to the later deployment phase.
- [ ] Measure perception, aggregate simulation and candidate evaluation separately on the target machine: CPU/RAM, inference throughput, input age and state-to-recommendation latency. Use v1.0's 2–5-second recommendation target; declare supported camera concurrency from measurements.
- [ ] Start the resource benchmark with one freshly processed video plus the supported cached boundary inputs. Record CPU/RAM budgets and queue/job limits before increasing concurrency; accept additional streams only while accuracy, input freshness and recommendation deadlines remain within the declared limits. Camera count alone is not a success criterion.
- [ ] Bound frame queues, tracker history, forecast history and candidate workers. Reuse inference/model state and cached observations; reduce concurrent work when overloaded and disclose stale data.
- [ ] Verify evaluating or approving a different virtual signal plan does not rerun video detection. Reuse the same valid observations for comparisons and invalidate caches only when relevant source/model/geometry settings change.
- [ ] Add a one-action, authenticated run-report export containing input identifiers/hashes, model/configuration/metric versions, forecast origin and quality, evaluated alternatives, baseline comparison, accepted/applied plan status, operator decisions, failures and resource measurements. Persist the required evidence as it occurs so export survives a restart; represent missing metrics explicitly and exclude credentials, raw video and tracking identities.
- [ ] Run the real Go/PostgreSQL/Python/browser path with newly processed video observations, all three scenarios and the additional synthetic network, including restart, dependency loss, command recovery and replay. Confirm approving a plan changes subsequent virtual signal behavior. Require real gRPC/OpenCV dependencies for acceptance; the existing test runner's fallback mocks must not count as integration evidence.
- [ ] Include a repeatable failure rehearsal: interrupt processing or make an authoritative input unavailable, observe stale/degraded status and blocked approval, verify the operator draft and command identity survive, then restore service and obtain fresh analysis. Enter prerecorded replay only through an explicit operator action with a visible replay label; never silently substitute it for computation. Include the failure and recovery in the exported run report.

**Done when:** Another operator can process reserved supported input, run the forecast/decision loop, export reproducible evidence and repeat the benchmarks and failure rehearsal within documented resource limits. Cached playback alone cannot satisfy this gate.

## Later field-validation phase

The following are explicitly deferred and do not block this milestone:

- Selecting a Bhubaneswar corridor, government coordination, site surveys and a municipal pilot proposal.
- Obtaining synchronized footage and observed signal operation from 3–5 real junctions; survey-based speed, travel-time and mixed-traffic calibration.
- Live RTSP integration, cross-camera clock management and sustained field-camera operation.
- Comparison with the deployed ATCS and measurement of actual corridor travel-time/control benefits.
- Vendor-specific controller integration, physical actuation, field safety acceptance and shared/production deployment hardening.

Preserve configuration and contract boundaries so these can be added later. Do not label the current milestone field-ready or treat deferred items as completed.

## Execution and completion

Implement in order **1 → 2 → 3 → 5 → 6**, with **4 starting early** and supplying recorded observations and reference samples to steps 2 and 5. For each code change, add a focused regression test, verify it exposes the missing behavior, implement, then run the relevant suite and review before proceeding.

Within the decision loop, prioritize visible time/data-quality handling, explicit no-action outcomes and fair network comparisons before adding more analytics or presentation polish. Run the initial hardware-budget check early, before increasing camera concurrency.

Completion requires all six engineering gates: real recorded-video processing, an integrated causal forecast, bounded safe signal-plan evaluation, working audited virtual actuation, benchmarked measurement/model results, and reproducible operation within resource limits. A full Bhubaneswar pilot is not required; a scripted presentation without this functioning loop is insufficient.
