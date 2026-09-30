# Operator workflow repair — 2026-10-01

Branch: `codex/operator-workflow-repair`, initially isolated from local `main` at `a693ddf`, then rebased onto remote `main` at `e235e09` to include the v5 configuration/startup repair.
The existing E02 evaluation and P02 report worktrees remain untouched and unmerged.

## Observed failures and changes

- No application processes or database container were running at inspection. Started the existing PostgreSQL 16 Compose service without removing volumes. The repaired Go/Python/Vite stack is running from this worktree.
- The initial UI selected recorded input but omitted the required `source_sessions`. Added an explicit per-boundary finalized-session selector, compatible-session validation, and the same input body for peak, incident and emergency starts. Initial selection is visibly seeded; no automatic fallback occurs. Incomplete next-run input disables launch, while reset of the existing run remains available.
- WebSocket validation stripped link aggregates and road-cell stocks. Preserve and validate those fields, show actual modeled stocks in the network, and restore directional flow values. Animated bands represent aggregate flow, not tracked individual vehicles.
- The command header overflowed the viewport. Header groups wrap and workspace children can shrink; browser proof showed page width 1239 px within a 1254 px viewport.
- Native start/reset confirmation stalled browser interaction. Those controls now use an accessible in-app confirmation dialog. Browser start, replacement confirmation and subsequent live state were verified.
- Incident UI assumed C3, even when the configured bottleneck was C7. Resolve the junction and affected movements from configuration/current state; route headings use configuration.
- Comparison display accepted results from another source epoch and substituted zero for absent metrics. Require the existing full identity check and use the matched aggregate comparison table with explicit unavailable values. Preserve offset fields in timing responses.
- Analytics queries did not identify the active recorded run. Boundary observation queries now use the authoritative run binding; independent display has its own explicit finalized-session selector. Compatible old batches are rejected when their hash differs from the active configuration; source choices show configuration hash prefixes.
- Go discarded all computation when the simulation advanced during analysis. Retain input-bound forecasts only within the existing 10-second freshness bound, reject future/foreign/stale-input results, and strip all older-snapshot recommendations, alternatives and comparisons. Exact-snapshot decision authorization is unchanged. Publication is rechecked after persistence.

## Regression and suite evidence

Each behavioral repair was preceded by a focused failing regression, followed by implementation and focused GREEN verification. Tests cover stripped cell/link state, invalid stock, recorded source binding, incomplete-launch/reset separation, synthetic C7 incidents, stale comparison epochs, preserved offsets, accessible replacement, authoritative observation queries, and bounded forecast publication with action invalidation and stale-input rejection.

Final verification:

- Web: 131 tests in 26 files; TypeScript check; Vite production build.
- Go: `TEST_DATABASE_URL=.../traffic_repair_tests ./scripts/run-go.sh test -p 1 ./apps/api/...` against separate real PostgreSQL database. The running application's database was not used for destructive test setup.
- Python: real installed gRPC/OpenCV environment, `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m pytest -q services scripts/tests`: 143 passed after integration.
- Bugbot review found one reset-readiness issue; corrected with regression coverage. Subsequent integration changes received manual diff review and focused/full affected tests.
- Browser: authenticated start, finalized-session selections, accessible run replacement, seeded live state, recorded playback/analytics, no horizontal overflow, ten road-cell groups, and available forecast values in the full network view. Screenshot: local `/tmp/traffic-operator-repair.png` (not a readiness gate).

## Real runtime evidence and limits

Processed all four configured boundary clips again under the integrated v5 configuration identity through the real vision pipeline using project-authorized local media and model assets. CAM-01/02/06 produced 12 finalized windows each; CAM-03 produced 13. These are detector predictions, not independently reviewed reference labels. Media, tracking data, credentials and private model assets remain outside Git.

Two-junction graph: newly processed recorded-input peak, incident and emergency runs returned ten links/road-cell groups and two signals, with durable per-run input bindings and valid run-scoped observations. The pre-rebase peak probe returned 56 forecasts across 30/60/120/300 seconds after the publication repair. After reprocessing for v5, all three starts and run-scoped observations passed; emergency returned 56 forecasts and `no_action` (current plan best), while peak/incident samples at seven seconds had unavailable intelligence. Those failures are retained in local evidence rather than counted as acceptance.

Three-junction graph: a separate Go/Python stack and PostgreSQL database ran all three seeded scenarios with twelve links/road-cell groups and three signals. The incident was at C7; emergency route was C6 → C3 → C7 → C1 → C2. All three returned 64 forecasts across all four horizons. Results carried `cannot_evaluate` for decisions when their exact snapshot advanced; no stale decision was enabled.

The six implementation acceptance gates remain open. This repair does not establish bounded operator review/actuation acceptance, held-out measurement/control benchmark success, supported concurrency, field benefit, or field readiness. Recommendations still expire on snapshot advance; virtual application and durable report export are not newly accepted here. The existing unmerged E02/P02 work must be coordinated separately. Exhausted recorded clips become stale and are not looped or silently replaced.

## Operating the repaired checkout

Worktree: `.worktrees/operator-workflow-repair` under the main repository. UI: `http://127.0.0.1:3100`; Go: `http://127.0.0.1:8081`; PostgreSQL: loopback 5433. A detached launcher is left running; its PID and log are in this worktree's ignored `.runtime/operator-repair-launcher.pid` and `.runtime/operator-repair-stack.log`.

Restart from the repaired worktree with `VIDEO_ASSET_DIR` pointing to the main repository's `traffic video` directory and `python3 scripts/start-all.py`. Local authentication files and the repair operator login are private in this worktree's `.runtime`; the browser is already signed in. Dependencies are local symlinks to the main checkout, deliberately excluded from the commit. Source session selections apply only to the next run. Selecting a camera or seeking playback changes no run input.
