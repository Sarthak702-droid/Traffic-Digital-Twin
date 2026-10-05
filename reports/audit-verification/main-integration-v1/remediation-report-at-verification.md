# Engineering audit remediation completion

Controller source revision: `92a55e7a37c5e668670cb27d443f9cc583cdff53`; audit reviewed revision `e2afd45bb0de58c6dbec5c0a1a3b9478848e2689`. Go/PostgreSQL authority, private Python gRPC, React/Vite, aggregate simulation and virtual-only control retained. No tests, safety controls or acceptance thresholds weakened.

**18 items Fixed; 2 Partially Fixed. Acceptance remains incomplete.**

Fresh frozen v8: **35/144 qualifying benefit origins (24.3%; required 50%) — FAILED**. All 48 no-benefit, degraded-input and emergency lifecycle origins pass their respective checks. Candidate policy unchanged from v7; the fraction difference reflects fresh seeds, not an improvement attributed to the new validation.

The complete real Python suite passes **338 tests**; frontend **159 tests**, Go/database race, typecheck/build, dashboard security and contracts pass. Current and historical scopes, failed regressions, resource results and integration evidence are recorded in [verification](../reports/audit-verification/main-integration-v1/manifest.json). The [structured report](../reports/audit-remediation-completion.json) includes the numerical benchmark pointer and matching summary. Prior evidence is preserved, with previous evolving reports archived verbatim.

Independent recorded accuracy requires actual reserved authorized input, two distinct reviewers, real adjudication and a non-implementing operator. Those records remain unavailable. Current browser acceptance, original-target resources, field benefit and production readiness remain unverified. See [review checklist](INDEPENDENT-REVIEW-CHECKLIST.md), [handoff](AUDIT-INDEPENDENT-ACCEPTANCE-HANDOFF.md) and [controller diagnosis](CONTROLLER-BENEFIT-DIAGNOSIS.md).

| Audit item | Priority | Status |
| --- | --- | --- |
| 01 Control benefit | P0 | Partially Fixed |
| 02 Pending-plan authority | P0 | Fixed |
| 03 Reconciliation | P0 | Fixed |
| 04 Mandatory idempotency | P0 | Fixed |
| 06 Forecast timing | P0 | Fixed |
| 07 Evidence traversal | P0 | Fixed |
| 17 Reference claims | P0 | Partially Fixed |
| 05 Command identity | P1 | Fixed |
| 08 Direction counts | P1 | Fixed |
| 09 Decode completeness | P1 | Fixed |
| 10 Queue estimate | P1 | Fixed |
| 11 Committed demand | P1 | Fixed |
| 12 Compute admission | P1 | Fixed |
| 13 WebSocket sessions | P1 | Fixed |
| 14 Stale vision display | P1 | Fixed |
| 15 Headway/passages | P1 | Fixed |
| 16 Privacy boundary | P1 | Fixed |
| 20 Installation | P1 | Fixed |
| 18 Configuration assumptions | P2 | Fixed |
| 19 Readiness claims | P2 | Fixed |

## 01 Control benefit — Partially Fixed

**Root cause:** Uncoordinated alternatives were ranked without hard displacement constraints and failed the frozen benefit gate. Candidate de-duplication could replace the local reference slot; truncation favored early-junction changes. Five-second offered-rate samples overreacted to low-demand arrivals. Earlier emergency benchmark protocols lacked actual lifecycle measurement; some origins censored recovery.

**Exact fix:** Preserved current timing and local adaptation as explicit reference slots. Operating schema 1.1 now evaluates three bounded demand/queue/receiving-storage proposals across the entire configured corridor, including alternative cycles and configured route phase offsets; legacy schema 1.0 preserves cycle-split behavior. Actual offset/activation rollouts, authority checks and all displacement constraints apply before ranking. Offered alternatives individually exceed unchanged minimum benefit and avoid duplicate green plans. Added past-only 60-second offered-demand smoothing and an optional observed-window contract field; forecast version/window bind comparison identity. Missing local reference fails closed. Per-candidate diagnostics expose activation, metric and regression failures; projection-versus-live-engine parity covers changed plans and offsets on both graphs. Emergency route flow uses the same 120-second window, with separate declared actual recovery observation through simulation time 600. Maximum five candidates, concurrency one, horizon 120 and deadline 1.5 seconds retained. Further required complete unique operating boundary/movement/signal sets, finite physical cells within configured capacity, valid metrics and shared runtime-safety checks before evaluation; malformed input cannot produce forecasts or recommendations.

**Files changed:** `services/intelligence/model.py`, `scripts/prototype_evaluation.py`, `services/intelligence/tests/test_bounded_recommendations_s03.py`, `services/intelligence/controller.py`, `services/intelligence/forecast_demand.py`, `services/simulation/aggregate_engine.py`, `packages/contracts/proto/twin.proto`, `packages/contracts/gen/go/twin.pb.go`, `packages/contracts/gen/python/twin_pb2.py`, `packages/contracts/events.schema.json`, `packages/contracts/openapi.json`, `packages/contracts/typescript/events.ts`, `scripts/generate_contract_docs.py`, `packages/scenario-config/comparison-scoring-v1.json`, `apps/web/lib/live.ts`, `docs/contracts-plan.md`.

**Tests added/updated:** `services/intelligence/tests/test_bounded_recommendations_s03.py`, `services/intelligence/tests/test_epic6.py`, `scripts/tests/test_prototype_evaluation.py`, `services/intelligence/tests/test_controller_diagnostics.py`, `services/intelligence/tests/test_coordinated_candidates.py`, `services/simulation/tests/test_offered_rate_window.py`, `packages/contracts/tests/test_prototype_roundtrip.py`, `apps/web/lib/live.test.tsx`, `services/intelligence/tests/test_operating_input_integrity.py`.

**Verification:** Frozen v8 at source 92a55e7: 72 cases complete, 35/144 qualifying origins (24.3%); required 50% gate FAILED. All 48 no-benefit, degraded-input and emergency lifecycle checks pass. Candidate policy unchanged from v7; difference in fraction reflects fresh seeds, not a claimed controller improvement from validation. Source hashes verified after execution. Full real Python suite passes; current Go/database race, frontend 159, typecheck/build/security/contracts pass. Invalid-snapshot regressions reproduce 26 failures plus four unsafe signal failures before fixes; all reject safely afterward. Existing projection/execution parity passes. Prior failures preserved.

**Remaining risk/dependency:** Benefit gate remains failed, especially peak and incident; finite development search is not an impossibility proof. No controller/physical benefit acceptance claim. Independent reserved recording, two genuine reviewers and non-implementing operator remain unavailable. See docs/CONTROLLER-BENEFIT-DIAGNOSIS.md.

## 02 Pending-plan authority — Fixed

**Root cause:** Go authority mutations did not invalidate simulator-owned pending intent.

**Exact fix:** Added simulator epoch, mode/lock identity, idempotent UpdateAuthority and durable CancelPlan; persisted Go intent before dispatch, blocked uncertain authority, cancelled pending plans and restored offsets on mutation/degradation, rechecked authority/locks/safety at activation, preserved locks on reset. Rejected older same-time stream frames by authority epoch/snapshot sequence and assigned a new sequence to clock acknowledgements.

**Files changed:** `packages/contracts/proto/twin.proto`, `packages/contracts/gen/go/twin.pb.go`, `packages/contracts/gen/go/twin_grpc.pb.go`, `packages/contracts/gen/python/twin_pb2.py`, `packages/contracts/gen/python/twin_pb2_grpc.py`, `packages/contracts/typescript/events.ts`, `packages/contracts/events.schema.json`, `packages/contracts/openapi.json`, `apps/api/internal/httpapi/control_authority.go`, `apps/api/internal/httpapi/decision.go`, `services/simulation/aggregate_engine.py`, `services/simulation/service.py`, `apps/api/internal/httpapi/simulation.go`.

**Tests added/updated:** `services/simulation/tests/test_audit_authority.py`, `apps/api/internal/httpapi/decision_test.go`, `apps/api/internal/httpapi/reconcile_d01_test.go`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Real developer stack: cancellation proof on both graphs; three-junction peak/incident plans applied at safe tick 35; short-coverage approvals rejected when input degraded. Old approval remains rejected after recovery. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Unproven/interrupted outcomes remain blocked until simulator evidence exists; no guessed settlement or automatic replay. Independent operator/field acceptance remains deferred.

## 03 Reconciliation — Fixed

**Root cause:** Manual/aged recovery could settle without exact simulator terminal proof.

**Exact fix:** Derived exact command/recommendation/actor from durable intent; only applied/rejected proof settles transactionally with audit and receipt hash. Cancellation fences not-found late dispatch. Unknown/interrupted stays unresolved; store lookup failure blocks approval. Omitted unavailable application timestamps for rejected outcomes, preserving the strict public schema.

**Files changed:** `apps/api/internal/httpapi/reconcile.go`, `apps/api/internal/httpapi/decision.go`, `apps/api/internal/store/writer.go`, `apps/api/internal/store/run_report.go`, `packages/contracts/run-report-v2.schema.json`.

**Tests added/updated:** `apps/api/internal/httpapi/reconcile_d01_test.go`, `apps/api/internal/store/store_test.go`, `apps/api/internal/store/report_evidence_test.go`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Six current API reports pass JSON Schema, recursive privacy validation and canonical receipt-hash verification. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Receipt durability requires functioning PostgreSQL and simulator receipt storage; unresolved uncertainty correctly blocks approval.

## 04 Mandatory idempotency — Fixed

**Root cause:** Invalid keys or absent storage bypassed reservation.

**Exact fix:** Domain mutations require valid keys; 400 invalid/missing, 503 unavailable/unexpected reservation, 409 conflict. Credential/session lifecycle explicitly exempt. No reservation means no dispatch.

**Files changed:** `apps/api/internal/httpapi/idempotency.go`, `apps/api/internal/httpapi/server.go`.

**Tests added/updated:** `apps/api/internal/httpapi/idempotency_audit_test.go`, `apps/api/internal/httpapi/server_test.go`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Independent acceptance is distinct from the passing implementation regressions.

## 06 Forecast timing — Fixed

**Root cause:** Availability was compared to evidence end, conflating causal clocks.

**Exact fix:** Separated evidence and source-availability watermarks, declared source-to-simulation mapping, required actual processing completion before snapshot wall time, origin at latest eligible evidence end and separate processing age. Unsupported mappings fail closed. Strengthened operating snapshot integrity: unique complete offered boundaries/movements/signals, finite nonnegative measured values, bounded cells and valid signal state. No admitted-inflow fallback when offered demand is missing in schema 1.1; valid zero and optional legacy offered-window omission remain supported.

**Files changed:** `packages/contracts/proto/twin.proto`, `services/intelligence/forecast_demand.py`, `services/simulation/aggregate_engine.py`, `services/simulation/video_demand.py`, `services/intelligence/model.py`.

**Tests added/updated:** `services/intelligence/tests/test_bound_history_forecast.py`, `services/intelligence/tests/test_causal_forecast.py`, `services/simulation/tests/test_bound_video_demand.py`, `services/intelligence/tests/test_operating_input_integrity.py`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Operating recorded adapter supports explicit identity mapping only; other mappings require a validated adapter.

## 07 Evidence traversal — Fixed

**Root cause:** Evidence API resolved caller-selected paths against repository root.

**Exact fix:** Registered artifact identifiers/aliases only, canonical realpath containment, rejection of absolute/traversal/encoded/backslash/symlink escapes before reads.

**Files changed:** `dashboard/evidence.mjs`, `dashboard/server.mjs`.

**Tests added/updated:** `dashboard/evidence.test.mjs`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Independent acceptance is distinct from the passing implementation regressions.

## 17 Reference claims — Partially Fixed

**Root cause:** Generated detector predictions asserted unsupported reviewed/quality provenance.

**Exact fix:** Generated predictions explicitly provisional; removed invented accuracy claims. Strict scorer requires two distinct real reviewers, timestamps, method/rights, immutable identity, adjudication and matching frozen split metadata. Historical unreviewed reports reclassified without fabricated scores. Prepared practical reviewer/operator selection and blank genuine-record checklist; no human counts or reviews generated.

**Files changed:** `services/vision/auto_annotation.py`, `services/vision/measurement.py`, `scripts/prototype_evaluation.py`, `reports/annotation-provenance.json`, `reports/reference-quality-report.json`, `docs/INDEPENDENT-REVIEW-CHECKLIST.md`.

**Tests added/updated:** `services/vision/tests/test_audit_measurement.py`, `scripts/tests/test_prototype_evaluation.py`.

**Verification:** Strict provenance rejection regressions pass; genuine independently reviewed recorded accuracy remains unavailable. Prepared human handoff without signatures/results. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** No genuine independent review records or unseen reserved recorded input available. Prepared handoff; human measurement gate Blocked.

## 05 Command identity — Fixed

**Root cause:** Body-only hashes omitted operation identity and route comparison.

**Exact fix:** Versioned canonical actor/account/method/route/concrete parameters/query/JSON envelope; reserve compares identity. Preserved original HTTP acknowledgement separately from later terminal recovery evidence across re-login.

**Files changed:** `apps/api/internal/httpapi/idempotency.go`, `apps/api/internal/store/writer.go`, `db/migrate.go`, `db/migrations/010_command_envelope.sql`, `db/migrations/011_original_command_receipt.sql`.

**Tests added/updated:** `apps/api/internal/httpapi/idempotency_audit_test.go`, `apps/api/internal/store/store_test.go`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Independent acceptance is distinct from the passing implementation regressions.

## 08 Direction counts — Fixed

**Root cause:** Aggregation only admitted approaching crossings.

**Exact fix:** Computed crossing direction independently of configured label; aggregate only when it matches primary approaching/departing direction, preserve class/lane aggregation and exclude pedestrians from vehicle demand.

**Files changed:** `services/vision/itd_pipeline.py`.

**Tests added/updated:** `services/vision/tests/test_itd_finalization.py`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Independent acceptance is distinct from the passing implementation regressions.

## 09 Decode completeness — Fixed

**Root cause:** Read failure was treated as successful end-of-input and reusable complete cache.

**Exact fix:** Required actual requested-frame coverage and valid metadata, recorded decoded/sampling proof, versioned cache identity; all processors/providers/catalogs reject incomplete or unproven artifacts. Valid EOF and requested subrange preserved.

**Files changed:** `services/vision/itd_pipeline.py`, `services/vision/recorded_clip.py`, `services/simulation/video_demand.py`, `apps/api/internal/httpapi/observation_catalog.go`, `scripts/generate_vision_clips_telemetry.py`.

**Tests added/updated:** `services/vision/tests/test_itd_finalization.py`, `services/vision/tests/test_recorded_clip.py`, `services/simulation/tests/test_bound_video_demand.py`, `apps/api/internal/httpapi/observations_v03_test.go`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Independent acceptance is distinct from the passing implementation regressions.

## 10 Queue estimate — Fixed

**Root cause:** Fixed pixel displacement depended on resolution and sampling interval; insufficient history looked stationary.

**Exact fix:** Normalized displacement by dimensions and elapsed source seconds using versioned geometry thresholds; insufficient history unavailable, uncalibrated diagnostics degraded.

**Files changed:** `services/vision/itd_pipeline.py`, `services/vision/measurement.py`, `scripts/generate_vision_clips_telemetry.py`, `services/vision/concurrent_orchestrator.py`.

**Tests added/updated:** `services/vision/tests/test_audit_measurement.py`, `services/vision/tests/test_itd_finalization.py`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Visible queue remains an estimate; no calibrated speed or physical queue acceptance is implied.

## 11 Committed demand — Fixed

**Root cause:** Known eligible unreleased mass was omitted from operating snapshots and rollouts.

**Exact fix:** Snapshot eligible remaining commitments/release intervals; reproduce their release before unknown forecast demand; include commitment identity/assumptions in comparison hash and retain offered mass/backlog conservation.

**Files changed:** `services/simulation/video_demand.py`, `services/simulation/aggregate_engine.py`, `services/intelligence/model.py`, `packages/contracts/proto/twin.proto`.

**Tests added/updated:** `services/simulation/tests/test_bound_video_demand.py`, `services/intelligence/tests/test_bound_history_forecast.py`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Independent acceptance is distinct from the passing implementation regressions.

## 12 Compute admission — Fixed

**Root cause:** Compare/Predict bypassed Analyze concurrency budget and cancellation.

**Exact fix:** One fail-fast per-model admission/deadline budget for Analyze/Compare/Predict, nested acquisition avoidance, rollout cancellation/deadline checks and exception-safe release; retained five candidates and 1.5-second deadline.

**Files changed:** `services/intelligence/model.py`, `services/intelligence/service.py`.

**Tests added/updated:** `services/intelligence/tests/test_bounded_recommendations_s03.py`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Local serialized compute diagnostics do not prove original target-machine or continuous full-stack latency acceptance.

## 13 WebSocket sessions — Fixed

**Root cause:** Authentication was checked only at upgrade.

**Exact fix:** Bound verified session identity/expiry/account version; validate before delivery plus 250ms checks with bounded timeout; close expiry/revocation/identity drift or unavailable validation within one second.

**Files changed:** `apps/api/internal/httpapi/access.go`, `apps/api/internal/httpapi/session.go`, `apps/api/internal/httpapi/server.go`.

**Tests added/updated:** `apps/api/internal/httpapi/session_audit_test.go`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Independent acceptance is distinct from the passing implementation regressions.

## 14 Stale vision display — Fixed

**Root cause:** Latest observation had no display cutoff/maximum-age eligibility.

**Exact fix:** Send current display source cutoff, prevent future/coverage extrapolation and show stale/unavailable flow/queue beyond maximum age; preserve historical seeks inside coverage.

**Files changed:** `apps/web/lib/observation-query.ts`, `apps/web/lib/observations.ts`, `apps/web/lib/video-display.ts`, `apps/web/components/vision-analytics-panel.tsx`.

**Tests added/updated:** `apps/web/components/vision-observation-sync.test.tsx`, `apps/web/lib/observations-u01.test.tsx`, `apps/web/lib/video-display.test.tsx`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Independent acceptance is distinct from the passing implementation regressions. Final browser recheck after the report serialization correction is unavailable because approval review exhausted workspace credits; earlier authenticated developer UI/download observations are diagnostic, not full acceptance.

## 15 Headway/passages — Fixed

**Root cause:** Cumulative sampled aggregates were reconstructed as individual vehicle passages/headways.

**Exact fix:** Removed individual event/headway/platoon claims; show supported aggregate pulses and unavailable individual metrics/uncalibrated positions instead of fabricated precision.

**Files changed:** `apps/web/lib/video-display.ts`, `apps/web/components/vision-analytics-panel.tsx`, `apps/web/components/kpi-strip.tsx`.

**Tests added/updated:** `apps/web/lib/video-display.test.tsx`, `apps/web/lib/observations-u01.test.tsx`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Independent acceptance is distinct from the passing implementation regressions. Final browser recheck after the report serialization correction is unavailable because approval review exhausted workspace credits; earlier authenticated developer UI/download observations are diagnostic, not full acceptance.

## 16 Privacy boundary — Fixed

**Root cause:** Public telemetry persisted tracking IDs, bounding-box histories and trajectories.

**Exact fix:** Scrubbed checked-in telemetry to aggregates, invalidated old display schema, kept association state transient and applied recursive normalized-key/depth privacy denylist at artifact/export/display boundaries.

**Files changed:** `apps/web/public/vision_clips_data.json`, `scripts/generate_vision_clips_telemetry.py`, `services/shared/privacy.py`, `apps/api/internal/store/privacy.go`, `apps/api/internal/store/run_report.go`, `apps/web/lib/video-display.ts`.

**Tests added/updated:** `services/shared/test_privacy.py`, `apps/api/internal/store/privacy_test.go`, `services/vision/tests/test_display_telemetry.py`, `apps/web/lib/video-display.test.tsx`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** The historical git revision still contains old telemetry; this remediation removes it from the current tree and operating/public outputs, not repository history. Final browser recheck after the report serialization correction is unavailable because approval review exhausted workspace credits; earlier authenticated developer UI/download observations are diagnostic, not full acceptance.

## 20 Installation — Fixed

**Root cause:** Bootstrap only wrote settings; complete dependency/workflow checks were absent.

**Exact fix:** Canonical locked bootstrap provisions Python/OpenCV/gRPC, npm, Go tools/modules and PostgreSQL; non-mutating doctor checks versions/locks/generated contracts/DB/authorized roots/model hash/protected account provisioning and distinguishes rehearsal readiness from acceptance.

**Files changed:** `scripts/bootstrap-prototype.py`, `services/runtime-requirements.lock`, `README.md`, `.gitignore`.

**Tests added/updated:** `scripts/tests/test_rehearse_prototype.py`, `scripts/tests/test_bootstrap_doctor.py`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Executed bootstrap/doctor on this local machine; fresh-machine and non-implementer acceptance remain external dependencies.

## 18 Configuration assumptions — Fixed

**Root cause:** Presentation and legacy processing assumed fixed junction/camera inventories.

**Exact fix:** Inventory/controlled-node presentation from active validated configuration; non-12-camera inventory supported, legacy fixed-camera demo isolated behind explicit deprecated replay request with truthful scope.

**Files changed:** `apps/web/components/vision-analytics-panel.tsx`, `apps/web/components/kpi-strip.tsx`, `services/vision/pipeline.py`, `apps/api/internal/httpapi/server.go`.

**Tests added/updated:** `apps/web/lib/observations-u01.test.tsx`, `apps/api/internal/httpapi/server_test.go`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Legacy diagnostic replay is explicitly labelled and cannot substitute for operating recorded-input inference.

## 19 Readiness claims — Fixed

**Root cause:** Task closure/percentages were presented as deployment or acceptance readiness. Completion-report summary fields retained stale v5/v6 counts despite updated per-item evidence.

**Exact fix:** Separated implementation tracking from verification/acceptance/deployment, removed task-derived production/verified claims, all gates remain unverified until current-revision evidence establishes them. Corrected all top-level benefit/test summary fields, added explicit benchmark artifact and numerical results, and added consistency checks against the actual benchmark plus the full 20-item status totals. Historical completion reports archived verbatim before updating current pointers.

**Files changed:** `dashboard/app.js`, `dashboard/index.html`, `dashboard/readiness.test.mjs`, `reports/audit-remediation-completion.json`.

**Tests added/updated:** `dashboard/readiness.test.mjs`, `scripts/tests/test_audit_completion_consistency.py`.

**Verification:** Current full Go/PostgreSQL race suite, real-dependency Python suite (338 tests), frontend suite (159 tests), typecheck/build and dashboard security checks; exact scope/evidence in reports/audit-verification/manifest.json. Current source follow-up: real Python 338 passed, frontend 159 passed, Go/PostgreSQL race, typecheck/build, contracts and dashboard security passed; exact evidence in reports/audit-verification/main-integration-v1/manifest.json.

**Remaining risk/dependency:** Production/field readiness remains deferred; the six prototype gates are not inferred from these 20 remediation statuses.
