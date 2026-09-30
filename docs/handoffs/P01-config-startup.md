# P01 config startup repair — 2026-09-30

## Cause and integration

`git pull --ff-only origin main` reported already up to date at `a693ddf`; there were no merge conflicts. No precreated task branches were present, so the repair used isolated worktree `.worktrees/p01-config-startup` and branch `task/P01-config-startup`, then fast-forwarded into main as `3d3ca83`.

N01 commit `f70fe38` added `camera_boundary_links` and `incident_node_id` without changing `c1-c6-v4`. The workstation's PostgreSQL v4 row lacked those fields. `Store.SaveConfig` correctly rejected the changed content under its immutable ID.

## Changes and interfaces

- `packages/scenario-config/c1-c6.json`: assign `c1-c6-v5` to the revised definition. Startup registers it alongside historical configs. The immutability check and historical run bindings remain enforced.
- `apps/api/internal/store/config_upgrade_test.go`: real PostgreSQL regression reproduces the pre-N01 v4 definition and historical run, registers the current config twice, checks the old definition/run are unchanged, creates a run under the new identity, and rejects a same-ID mutation.
- `scripts/record-replay.py` and `scripts/tests/test_record_replay.py`: manifest generation checks all 480 frames per scenario against the active config hash, scenario, seed and simulator metadata. Use the simulator's `aggregate-v1` model version; the old manifest incorrectly used the predictor's `aggregate-predictor-v1` while recorded states used `aggregate-v1`. Reject old config frames instead of assigning them a new config label.
- `packages/replay/{peak_surge,incident_c3,ambulance_corridor}.jsonl.gz` and `manifest.json`: regenerated synthetic recordings for v5 with verified checksums. These are prerecorded synthetic replay assets, not recorded-video inference evidence.
- `RUNBOOK.md`: document immutable config upgrades, historical data retention, invalidated observation hashes and replay regeneration.

No database migration, protobuf numbering change or public API schema change was required. Synthetic topology and scenario parameters are unchanged.

## Verification

Before implementation, the PostgreSQL regression failed with the exact reported v4 collision. Both replay regressions also failed: wrong simulator version and accepted old configuration frames. All three passed after the repair.

After integration into main:

- `GOCACHE=/tmp/traffic-go-build-cache ./scripts/run-go.sh test ./apps/api/... ./db/... -count=1`: all Go packages passed using local PostgreSQL and isolated test schemas.
- `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m pytest services scripts/tests -q`: 143 passed. Used the real Python 3.12 venv directly, without the compatibility fallback runner. Includes both graphs and all three scenarios as unit tests.
- `npm run test:ui`: 117 tests passed across 23 files.
- `python3 scripts/verify-contracts.py` and `git diff --check`: passed.
- Regenerated all three replay recordings, then generated their manifest; every recorded state's configuration and simulator metadata was checked.
- `GOCACHE=/tmp/traffic-go-build-cache npm start`: two consecutive startups against the existing workstation database reached Go API ready with `config=c1-c6-v5`, Python gRPC listeners at 50051/50052 and Vite at 3100. Controlled shutdown completed after each check.
- `/health/live`: HTTP 200 with `live=true`; `/health/ready`: API/database normal and truthful unavailable statuses for inactive scenarios/observations; Vite `/`: HTTP 200.
- PostgreSQL retained v1–v4 and added v5 with camera mappings and incident node C3. The first startup reconciled an interrupted historical run through the existing audited recovery path.

## Remaining risks and scope

Previously processed observations have the old config hash and must be processed again before binding to v5. A genuinely different custom definition under an existing ID will still be rejected and requires its own new ID.

This verifies the reported startup failure and restart behavior. It does not complete the six prototype gates: no fresh held-out video, authenticated operator decision/application, full browser workflow, resource benchmark or independent operator acceptance was executed in this repair. Physical actuation remains disabled.
