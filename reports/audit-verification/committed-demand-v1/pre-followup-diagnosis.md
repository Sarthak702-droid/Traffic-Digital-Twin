# Controller benefit diagnosis and follow-up

The engineering fixes improve bounded candidate evaluation, but passing unit, safety and resource checks does not establish control benefit. Acceptance still requires at least 5% queue-delay reduction against both fixed timing and local adaptation in at least 50% of eligible normal origins, with the original exit, external-wait, backlog, spillback and service constraints intact.

## Changes grounded in development evidence

The previous candidates mainly interpolated existing cycle splits. The current operating policy keeps current timing and local adaptation as explicit reference slots, then evaluates three analytical whole-corridor proposals. They route current eligible demand through configured turns, combine that demand with measured queues and remaining external backlog, account for available receiving storage, and explore bounded cycles. One proposal also aligns configured route phases using declared free-flow travel and at most ten seconds of offset. All proposals undergo actual activation, authority, clearance, storage and regression checks. The maximum remains five candidates, concurrency one, a 120-second comparison and a 1.5-second deadline.

Synthetic offered-demand estimates previously used only five observed seconds. In a low-demand case, one arrival could therefore be extrapolated into 24 arrivals over the next 120 seconds. A bounded 60-second past-only average and an explicit observed-window field remove that particular overreaction. Warm-up uses only observed samples; recorded finalized-window forecasting remains separate. The averaging field is additive and optional for older clients, and the forecast version participates in comparison identity.

Projection-versus-execution regressions compare changed plans and offsets against the actual aggregate engine on both graphs. Cells, external backlog, exits, queue delay, waiting, spillback, scheduler state and activation time agree in those tests. This validates those exercised transitions; it is not a proof for every possible configuration.

An unavailable local reference now prevents a normal recommendation. Candidate diagnostics distinguish invalid proposals, rejected activation, displaced congestion, inadequate gain and compute failure. The controller describes a safe retained plan as best among the evaluated admissible candidates, without claiming a global optimum.

## Benchmark corrections, without changing benefit thresholds

Older protocols did not enable emergency measurement, so their emergency evidence remained unavailable. The new protocol measures aggregate route service in the same 120-second window for every policy. Actual request recovery is observed separately through declared simulation time 600. Those later observations do not lengthen the traffic comparison window or enter the operating controller. The protected local baseline retains the authorized plan during emergency priority/recovery. Earlier missing or censored results remain preserved.

The final development run (`audit-controller-development-v5.json`) completed 72 cases and qualified 31 of 144 eligible benefit origins. All 48 no-benefit origins retained the current plan, all 48 degraded origins refused evaluation, and all 48 emergency lifecycle checks passed. Peak and incident origins did not meet the benefit criterion. Development results cannot count as held-out acceptance.

## Why remaining cases fail

Per-origin evidence names the exact failed metrics. Many saturated cases cannot reduce central queue enough while preserving external waiting and downstream service. Some whole-corridor activations encounter full receiving storage and are correctly rejected. A smaller central queue alone does not establish an improvement when vehicles have merely been moved into external backlog.

An offline development-only diagnostic sampled 800 valid phase allocations at each of four declared development origins, without changing operating candidate limits. It found no allocation meeting all guards plus the required 5% gain at those sampled peak states. This is a finite diagnostic search, not an impossibility proof or held-out acceptance result. Its raw log is preserved with that limitation.

A genuinely better controller must produce benefit within the existing safety and displacement constraints; reducing the threshold, dropping difficult cases, using future demand, enlarging the operating budget or calling a no-action outcome an improvement would invalidate the audit. Current failed results remain explicit. Independent recorded accuracy, the non-implementing operator workflow, target-machine resources and field/production readiness require their own genuine evidence.

The fresh v7 freeze binds new seeds and hashes to source revision `8ad7ac78f96c151f8cc588e2236ec42d2b5d07f7`. Its exact result is recorded in `reports/audit-heldout-results-v7.json` and the follow-up verification manifest after execution. Previously inspected holdouts remain diagnostics and are not reused for acceptance.

## Main integration follow-up

Operating schema 1.1 now rejects incomplete or duplicate boundary/movement/signal sets, invalid cell dimensions or nonfinite/out-of-capacity stocks, invalid measured values and unsafe signal states before computing a forecast or comparison. The new regressions reproduce 26 integrity failures and four runtime-safety failures before these checks. Valid zero, optional averaging-window absence and schema 1.0 compatibility are retained. Top-level completion-summary evidence pointers and numerical totals now agree with actual benchmark artifacts; consistency regressions protect them.

The fresh v8 freeze binds unchanged candidate policy and new seeds to controller revision `92a55e7a37c5e668670cb27d443f9cc583cdff53`. All 72 cases completed; 35 of 144 eligible origins qualify (24.3%), below 50%. Peak and incident still fail benefit; all 48 no-benefit, degraded and emergency lifecycle origins pass their respective criteria. This different seed-set result is not a claimed controller improvement caused by input validation. Engineering test completion does not close the failed benefit or unavailable independent-review gates.

## Additional development-only feasibility probes

The follow-up probes use declared development seed 1101, the high-capacity perturbation, and origins at simulation seconds 240/480. They use realized future demand strictly inside offline diagnostic rollouts; operating analysis still receives past-only input. Previously viewed v8 data was only rescored, never used to tune candidates. No controller policy change was justified or deployed by these probes.

| Probe | Exercised scope | Result |
| --- | --- | --- |
| Random valid allocations/offsets | 400 proposals at each of four selected two/three-junction peak/incident states | Zero admissible beneficial proposals |
| Longer cycles | 40 proposals over those four states | Zero qualifying proposals |
| Coupled green/offset grid | 320 proposals at each of two two-junction peak states | Zero qualifying proposals |
| Hypothetical initial green selection | Current/local/analytic timings with configured initial phases at four states | Zero qualifying proposals; diagnostic monkeypatch only |
| Coordinate constraint search | 918 and 627 visited proposals at two two-junction peak states | Neither meets all requirements |

These are finite, partially overlapping searches. They are not a global optimality proof or acceptance evidence, and their offline compute does not expand the operating five-candidate/1.5-second budget. Raw scripts and results are retained in `reports/audit-verification/benefit-feasibility-v1`.

At the two-junction peak origin 240, fixed timing has queue delay 21,372 veh·s and boundary waiting 10,749 veh·s; local adaptation has queue delay 24,520 veh·s and boundary waiting 9,480 veh·s. A candidate must improve the smaller internal queue while retaining the smaller external wait. The search did not find that joint improvement. Its best constraint-search result still misses the target queue limit by 7.56%. At origin 480, the selected search result still violates queue, waiting and spillback requirements. These findings explain the exercised failures without claiming universal infeasibility.

Classifier `control-benefit-v2` additionally rejects no_action, zero reference delay, missing/nonfinite mass residuals and invalid metric evidence. All original thresholds remain intact. The archived v8 result has no invalid qualifying origins: strict historical rescoring remains 35/144 (24.3%), below the 72/144 required. Nine added regressions pass within the 347-test real Python suite; 55 script tests pass. Fresh acceptance remains unavailable until a materially better past-only operating policy is verified on newly frozen unseen cases.
