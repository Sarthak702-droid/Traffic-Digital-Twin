# Functional Prototype: Parallel Worktree Task Board

**Source of requirements:** [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). This board divides its six gates into independently reviewable work. It does not change the scope or mark any gate complete.

**Baseline:** Create every worktree from the same reviewed base commit. Assign one agent to each active task, one branch per task. A task is complete only after its tests, review, and integration checks pass. Do not let agents independently edit generated contracts, shared schemas, `workspace.tsx`, `decision.go`, or status claims.

## Shared rules and integration contracts

1. **Contract owner:** C01 owns `packages/contracts/proto/twin.proto` and regeneration of Go/Python bindings, plus matching public schema changes. Other agents propose additions to C01; they do not commit competing contract edits. Before C01 merges, dependent agents may use local adapters or fixtures but cannot claim API integration.
2. **Source identity:** A processed input must identify clip hash, geometry/config hash, detector/tracker version, observation schema version, source session, finalized window, and availability time. A run binds to one authoritative source session. Seek/restart that changes it invalidates prior forecasts, comparisons, and approvals. Display-only seek is separate.
3. **Decision identity:** Recommendations and comparisons bind to run ID, snapshot sequence, source session/version, model/config/metric versions, and forecast origin. Go rechecks these at approval; the browser is never the authority.
4. **Plan semantics:** Timing changes, offset or activation time, safe-boundary validation, mock application, and observed post-application state use one contract. An analysis has distinct `recommend`, `no_action`, and `cannot_evaluate` outcomes. Unavailable metrics are explicit.
5. **Comparison semantics:** Every candidate starts from the same full state and demand assumptions. Report an identical window and units for queue delay, boundary exits, boundary backlog, and worst-served approach (maximum red/service debt). Keep emergency priority/recovery separate from normal scoring.
6. **Evidence:** Fresh video inference, cached observations, synthetic inputs, prerecorded replay, modeled outcomes, and field measurements are separate labels. No test using fallback gRPC/OpenCV mocks qualifies as end-to-end acceptance.
7. **Merge owner:** One integrator merges in dependency order, regenerates checked-in artifacts once, runs the combined suites, and resolves shared-file changes. Agents do not merge their own branches into `main` concurrently.

## Task cards

`P` means a prerequisite that must be merged before the task's final integration. Tasks in the same row without mutual prerequisites can run in parallel. File areas are ownership boundaries, not exhaustive implementation prescriptions.

| ID | Agent-sized deliverable and acceptance check | Primary file area | P |
| --- | --- | --- | --- |
| C00 | Inventory current API/proto/observation shapes and freeze the versioned source, forecast, analysis, comparison, plan, and report fields; record schema examples and rejection rules. Review the contract with API, Python, and UI owners. | `docs/contracts-plan.md`, new contract fixtures | — |
| C01 | Add agreed fields and enums without reusing protobuf numbers; regenerate Go/Python bindings and public schemas. Contract tests prove old-field compatibility and new-field round trips. Sole contract owner. | `packages/contracts/`, generation scripts | C00 |
| A01 | Replace demonstration login with password verification against the provisioned account format, server sessions, expiry/revocation, protected cookies, origin checks, and actor/role from the session. Reject forged headers, bad credentials, and viewer mutation; audit the verified actor. | Go API access/session, store/migrations, provisioning script | C00 |
| A02 | Make the browser use authenticated session/cookie flows and retain draft plus idempotency/command lookup through expiry and re-login. Exercise expiry during an uncertain command in a browser test. | `apps/web/lib/api.ts`, session panel, focused tests | A01 |
| V01 | Register one authorized local clip and its counting/queue geometry; process with real detector/tracker into versioned finalized windows, expose status/errors, and reuse cache only on matching input/model/geometry hashes. Test corrupt/missing video, restart, and end-of-file. | vision service and its tests; input/geometry manifests | C00 |
| V02 | Select usable ordinary, crowded, and difficult windows; store independently reviewed counts and supported visible-queue labels separately from predictions. Document provenance, rights, label method, and tuning versus reserved split. A second reviewer must validate reference labels before accuracy claims. | new reference fixtures and documentation | — |
| N01 | Replace fixed camera-to-boundary/C1/C3 assumptions with validated mapping and a synthetic three-controlled-junction graph. Test both graphs, incident location, emergency route, and mass conservation without double-counting. | scenario/camera config, network config, `video_demand.py` | C00 |
| V03 | Serve registered clip status, source timing, finalized observation windows, provenance and explicit missing/stale/degraded states through the Go API. Preserve source-session identity on run binding. | `observations.go`, store/API tests | C01, V01 |
| F01 | Supply bounded, finalized, non-overlapping history keyed by run/boundary/source session; connect persistence and EWMA to actual `Analyze`/rollout demand. Distinguish valid zero from absent/stale input and preserve offered demand when admission is blocked. Test look-ahead and cross-run isolation. | `forecast_demand.py`, intelligence model/service, focused tests | C01, N01, V01 |
| F02 | Expose forecast method, origin, data age, quality and per-horizon availability for 30/60/120/300 s. Compute uncertainty only from defensible references; otherwise mark it unavailable. Score only horizons with later observations. | intelligence forecast output, tests | F01, V02 |
| S01 | Extend virtual plan/scheduler/mock adapter for bounded offsets or activation time at actual safe boundaries. Validate corridor-wide clearance, locks, pedestrian, amber/all-red and emergency conflicts. Prove approved timing alters later virtual signal state. | simulation safety/scheduler/service, tests | C01, N01 |
| S02 | Define weights and units; compare bounded candidate set, including current plan, from identical complete snapshots and demand. Add delay, exits/backlog, spillback and service debt; keep stops/journey time unavailable. Test downstream-full and congestion-displacement cases. | intelligence model, simulation metrics, tests | F01, S01 |
| S03 | Enforce candidate/horizon/concurrency budgets, timeout fallback, minimum benefit and separate `no_action` versus `cannot_evaluate` reasons. Stale or unsuitable input cannot yield an actionable recommendation. Test fairness, emergency recovery and no-benefit cases. | intelligence service/model, tests | F02, S02 |
| D01 | Bind recommendation approval to current run/source/snapshot/version, reject stale results in Go, and audit approve/modify/reject and applied outcome. Verify old browser-held IDs stay rejected after source change and restored input yields a fresh analysis. | `decision.go`, store, decision integration tests | A01, V03, S01, S03 |
| U01 | Show video source time, completed observation window, simulation time, forecast origin/quality, and independent display seek. Clear dependent UI state on authoritative source change; show explicit no-action/cannot-evaluate and matched-window KPI comparisons. | vision panel, decision panel, `workspace.tsx`, schemas/tests | A02, V03, F02, S03, D01 |
| E01 | Freeze benchmark protocol before held-out execution: reference/tuning split, chronological forecast target isolation, synthetic seeds/graphs/perturbations, baselines, improvement thresholds, tolerated regressions, and resource budget. Include fixed/local adaptive and persistence/local-only variants. | `docs/prototype-evaluation.md`, benchmark config | V02, N01 |
| E02 | Run recorded measurement and forecast evaluation against independent labels or later detector windows as labeled; mark unsupported horizons unavailable. Run matched virtual control comparisons, analytical conservation, peak/off-peak/incident/degraded cases and no-benefit/regression reporting. Revise failed algorithms, then rerun held-out protocol without retuning on held-out data. | `scripts/evaluate-prototype.py`, reports/tests | E01, V01, F02, S03, D01 |
| P01 | Pin assets/dependencies and document local setup, rights, formats, hashes, loopback/private credentials and operator procedure. Bound frame/tracker/forecast/candidate queues; measure fresh-video inference, simulation, recommendation latency, CPU/RAM, input age and supported concurrency on the target machine. | startup/compose, manifests, `RUNBOOK.md`, `KNOWN_LIMITATIONS.md` | V01, F01, S03 |
| P02 | Persist run evidence as events occur and provide one-action authenticated export with IDs/hashes, versions, quality, alternatives, comparisons, decisions/applied state, failures and resource measurements. Exclude credentials, raw video, and track identities; survive restart. | Go report/store, report UI, tests | A01, C01, D01, P01 |
| Q01 | Real Go/PostgreSQL/Python/browser end-to-end path: new video processing, cached reuse, three scenarios, both graphs, approval changes virtual behavior, restart/replay, dependency loss and recovery, command draft/identity, stale approval blocking, export. Use real gRPC/OpenCV and record commands/results/artifacts. Independent operator runs reserved clip through runbook. | integration/browser scripts and acceptance evidence | A02, U01, E02, P01, P02 |
| R01 | Reconcile README/status/readiness with actual verified capability: functional prototype, measured recorded-data quality, modeled control results, resource limits, and deferred field validation. No status claim precedes corresponding evidence. | `README.md`, remediation/status/readiness docs | Q01 |

## Parallel execution waves

This is a dependency schedule, not a request to assign every task to a separate agent. With four agents, keep one slot available for contract/integration work when merges begin.

| Wave | Work that can proceed concurrently | Merge/checkpoint before next dependent work |
| --- | --- | --- |
| 0 | C00, V02, initial target-machine resource probe from P01 | Approve contract shapes and benchmark/reference inputs. Do not use detector output as reference labels. |
| 1 | C01, A01, V01, N01 | Merge C01 first; rebuild bindings in all worktrees. A01/V01/N01 can keep working during C01 but integrate against its final schema. |
| 2 | A02, V03, F01, S01 | Merge N01 and V01 before final F01 integration; merge A01 before A02. Check that input identity and activation semantics agree. |
| 3 | F02, S02, E01, P01 | Freeze benchmark protocol before held-out runs. S02 needs F01/S01; P01 can begin earlier and finish after resource measurements. |
| 4 | S03, then D01; E02 can begin on immutable benchmark inputs once S03 integrates | Merge S03 before Go approval logic. Re-run causal, comparison and safety tests together. |
| 5 | U01 and P02 after their prerequisites; E02 continues | Merge Go API/report before final UI wiring. Inspect audit, report, and UI values against one real run. |
| 6 | Q01, then R01 | Full-stack evidence and independent-operator run gate readiness claims. |

**Critical path:** C00 → C01 → N01/V01 → F01 → F02/S02 → S03 → D01 → U01/P02 → Q01 → R01. V02 → E01 → E02 → Q01 is a second critical path if reviewed labels or benchmark freeze are delayed. A01 → A02/D01 → Q01 is the security path. S01 → S02/D01 is the control path.

## Worktree and review procedure

- Create `task/<ID>-<slug>` from a pinned base. Give each agent its task card, the source plan, C00 contract decisions, and the latest merged dependency commits. Keep local runtime outputs and clip media out of git unless rights and fixture size are reviewed.
- Before code, each agent lists exact files, expected tests, and its proposed contract changes. If a file is owned by another active card, send a patch proposal to its owner instead of editing it in both worktrees.
- For each behavior change: write a focused failing regression, confirm failure, implement, run focused tests, then review and commit. Preserve existing unrelated changes.
- Merge one reviewed branch at a time in prerequisite order. After each merge, run affected Go, Python and web tests; after C01 regenerate/check contract outputs. After D01 and U01, run the real API/browser path. A green mock-backed Python run is insufficient for Q01.
- If work uncovers an incompatible interface or failed benchmark, update C00 or E01 and dependent task cards before agents continue. Keep held-out data sealed; use a new held-out set if tuning examined it.
- R01 is the only task that marks readiness. It may say a gate failed or remains unavailable; it may not infer success from a screenshot or delivery dashboard percentage.

## Completion map to the source plan

| Source gate | Task cards carrying its acceptance |
| --- | --- |
| 1. Access and claims | A01, A02, R01, Q01 |
| 2. Causal forecast | C00, C01, F01, F02, V03, U01, Q01 |
| 3. Bounded safe plans | C00, C01, S01, S02, S03, D01, U01, Q01 |
| 4. Recorded-video input | V01, V02, N01, V03, Q01 |
| 5. Accuracy and benefit | V02, E01, E02, Q01 |
| 6. Package and verify | P01, P02, Q01, R01 |

The later Bhubaneswar field-validation phase remains outside these cards.
