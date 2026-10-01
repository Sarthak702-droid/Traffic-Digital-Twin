# Q01 prototype acceptance work

Branch: `task/Q01-prototype-gates`, based on the operator-workflow repair and integrated E02/P02 prerequisites. Gate status is provisional until the complete acceptance evidence is reviewed. This work does not claim field readiness.

| Gate | Current evidence | Remaining acceptance |
|---|---|---|
| 1. Authenticated access and accurate claims | Server-session role/origin/idempotency regressions; authenticated report and clock endpoints | Complete expiry/uncertain-command failure rehearsal and remaining product-claim audit |
| 2. Integrated causal forecast | Both graphs × three scenarios; real gRPC, finalized history; 56/64 forecasts | Frozen processing-age requirement unresolved; continuous latency acceptance |
| 3. Bounded safe plans and virtual actuation | Real authenticated pause/review/approve/resume; approved phase plan active later; durable application at simulation second 105 | All scenario/failure combinations; old approvals must fail after recovery |
| 4. Real recorded video | New CAM-01 OpenCV/ITD processing, source identity and finalized aggregate windows; other boundaries cached | Independently reviewed measurement reference |
| 5. Predefined benchmarks | Frozen v1 failed result retained; tuning-only exploration of node-specific transfers and cycle scales | Control policy must pass a newly frozen untouched evaluation; synthetic forecast/local-only and emergency recovery metrics; human reference labels |
| 6. Reproducible package/full stack | Real Docker PostgreSQL, Go and private Python services; durable report survives full restart; browser download verified | Non-implementer reserved-input runbook check; complete package/failure matrix |

## Verified resource sample

One fresh CAM-01 job, six-CPU affinity, three cached boundary inputs available. Full recorded clip, no looping. 118 actual inference frames / 50.189 wall seconds = 2.351 inference frames/s. Peak process RSS 1,530,839,040 bytes (1.43 GiB); peak sampled process CPU 560.19% (5.60 cores). Provisional frozen limits: one fresh job, 2 GiB RSS, six cores. CPU was sampled every 100 ms; RSS is the process lifetime high-water mark. This sample does not establish additional-stream concurrency.

## Operator review clock

Use **Pause virtual clock for review**, wait for fresh analysis, inspect the matched baseline/candidate metrics, then approve/modify/reject. **Resume virtual clock** to allow an accepted plan to reach its safe activation boundary. Pause affects the virtual model clock only. Source-video display seeking does not change the run input. A visible pause flag and periodic live heartbeats distinguish deliberate review from dependency loss. All clock commands pass through authenticated Go, require command identity, and produce durable audit entries.

After compute/simulation loss, actionable analysis is invalidated. A fresh computation receives new gateway decision IDs, so a deterministic private-compute ID cannot revive an old approval. A confirmed empty simulator after a full restart ends the interrupted durable run; a transient unavailable service alone does not end it.

## Durable report

Run history exposes **Export report**. The authenticated Go endpoint is `GET /api/v1/runs/{id}/report`. Version `prototype-run-report-v2` preserves the frozen v1 schema separately, adds chronological aggregate evidence and clock/application events, and admits null identity/origin for seeded or unevaluated runs. Evidence is read in one repeatable PostgreSQL snapshot. Free-form private computation explanations, media paths, individual tracking identities and credentials are excluded. Decisions derive actors from durable authenticated audit, rather than browser fields.

Unavailable resource measurements are explicit. Fresh-source measurements bind to camera/source session; analysis wall latency is measured independently. A measured inference result is not an independently reviewed accuracy result.

## Human evidence still required

Two distinct reviewers must complete the reserved measurement reference, with disagreements adjudicated under `docs/reference-labeling-protocol.md`. An operator who did not implement the pipeline must execute the reserved-input workflow under `RUNBOOK.md`. Neither requirement is replaced by developer automation or detector predictions.

## Latest full-stack evidence (2026-10-01)

All three recorded-input scenarios ran on both graphs using real Go/PostgreSQL/private gRPC and newly processed immutable observations. At virtual second 16 the original graph returned 56 forecasts and the additional graph 64, each covering 30/60/120/300 seconds. Twelve finalized aggregate windows were persisted per run. The peak and three-graph incident samples produced recommendations; the two-graph incident sample returned `cannot_evaluate`, and emergency samples returned `no_action`. Those outcomes are preserved, not converted into benefit claims. The six reports and the dependency-loss report validate against the strict v2 schema.

A real intelligence-service suspension blocked approval with HTTP 409, preserved the authoritative input session, and produced `compute_unavailable` in the durable report. After recovery, Go issued a different decision ID and the old approval still returned 409. No replay was substituted. Real access probes returned 401 for anonymous forged-role commands and revoked sessions, 403 for an untrusted origin and viewer mutation, and 200 for authenticated viewer report reads.

The current Go startup now uses `VIDEO_PROCESSED_DIR`; previously it silently searched the default directory. Retained older cache entries no longer make suitable recorded-input availability falsely disappear; explicit source selection remains required. Comparison now validates and simulates offsets, and complete scheduler snapshots preserve delayed releases and pending offset-only plans. Accepted scheduler intent is published even when the virtual clock is paused.

Use `scripts/rehearse_prototype.py` against an isolated stack for a repeatable three-scenario integration probe. It prompts for an operator password, selects only uniquely matched graph/source identities, pauses for exact-snapshot analysis, and writes public run reports. This is developer automation and does not replace independent operator acceptance. Private evidence lives under `.runtime`; media, model files and credentials are excluded from commits.

The longer 300-second comparison-window tuning diagnostic passed 0 of 24 origins across peak/off-peak/incident and both graphs. It is not a new held-out protocol and does not alter v1 or its thresholds. Control-policy redesign and untouched evaluation remain required.

## Serialized compute and review latency

Resource protocol `packages/scenario-config/prototype-resource-budget-v1.json` was saved before the separate compute probes. On the declared workstation, real aggregate simulation across both graphs and all three scenarios sampled 3,600 steps: nearest-rank p95 0.243 ms, peak sampled CPU 99.79%, process peak RSS 28,270,592 bytes. The real bounded `Analyze` path (forecast plus candidate evaluation) sampled 60 analyses across the same graph/scenario set: p95 90.417 ms, peak CPU 99.81%, peak RSS 28,344,320 bytes. Each was below its frozen two-core/512-MiB process budget and respective 1-s/1.5-s p95 budget. Runs were serialized in separate processes, with snapshot preparation included in process-resource scope. This is tuning-only performance evidence, not held-out benefit.

The checked-in HTTP rehearsal measured clock request to exact paused-snapshot analysis, including polling, Go/database and analysis cadence: two-graph peak/incident/emergency 0.827/3.620/4.754 s; three-graph 1.047/4.201/4.122 s. These six samples stayed within the 5-s target for explicit operator review. They do not establish continuous-run p95, workload under concurrent fresh inference, or additional-stream capacity.

Validation after integration: 181 real Python/service/script/contract tests, 137 web tests, web typecheck/build, and affected Go/PostgreSQL suites passed. Later public OpenAPI regression additions also passed; final counts are recorded in the handoff. Historical production-ready and 17/17-complete claims were moved to an explicitly unverified legacy readiness record. Current readiness preserves all six open/failed gates.

## Input-age specification conflict and unresolved acceptance

`docs/contracts-plan.md` defines `Forecast.input_age_s` as wall-clock time since actual eligible processing completion. The frozen v1 evaluation requires actionable input age no greater than 10 seconds, while the milestone permits immutable cached observations for supported boundaries. Replaying a causal cached history does not make its processing timestamp fresh. The recorded-input rehearsals therefore do **not** pass the frozen wall-clock input-age gate, even when the finalized source window is causally suitable and the gateway state is fresh. Preserve these distinct clocks and the frozen failure; a future protocol must distinguish recorded-source staleness from processing wall-clock age explicitly before new held-out evaluation. No age threshold or timestamp was changed in Q01.

Training-only offset/cycle/phase-transfer feasibility exploration also passed 0 of four peak origins across the two graphs. This copied-future-trace oracle diagnostic cannot become a causal policy or a held-out benefit claim. The controller redesign, synthetic forecast comparison against persistence/local-only, and predefined aggregate emergency-priority/recovery evaluation remain open.

Browser sign-out and reauthentication restored an unsent modification category and justification without submitting it. The native replay confirmation stalled browser control, so replacement confirmation now uses an accessible in-page dialog. Explicitly confirmed replay is visibly labeled and disables signal decisions. Gateway recovery never substitutes replay automatically. The old timed-out native action eventually produced a replay run; its initial unchanged state was not conclusive command-outcome proof. Current tests cover confirmation cancellation and availability/authorization changes before submission.

The input disclosure now separates video-derived boundary demand from virtual model state and labels replay explicitly. Coordinated cards enumerate every proposed junction (including the additional graph) and omit invented platoon transit time and hardcoded clearance/metering benefit claims.

Static contract verification now compares actual ownership routes with OpenAPI and resolves every local schema reference. It no longer requires historical stories to be marked complete or describes configured nodes as active runtime evidence. Two focused verifier regressions passed after failing against the prior checker.

A new post-integration recorded-input approval published pending scheduler intent during review, resumed, and applied at virtual second 35. Actual active greens matched every approved phase; the run report records its applied command outcome. This is virtual actuation proof, not control-benefit acceptance.
