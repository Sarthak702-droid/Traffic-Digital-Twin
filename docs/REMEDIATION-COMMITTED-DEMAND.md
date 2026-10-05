# Committed-demand candidate remediation

## Practical reason and affected behavior

An eligible recorded observation creates a known release commitment: remaining vehicles must be offered over its declared release interval. Comparison rollouts already used that commitment, but the candidate generator extrapolated only the forecast rate. This meant the proposed green allocation and its comparison did not use the same demand assumptions. In particular, zero forecast flow could hide a nonzero, already-known upcoming release from proposal generation. This is a specific audit 11/control-candidate defect; it does not explain every saturated synthetic benefit failure.

Two regressions reproduce the defect on the original and three-controlled-junction graphs: adding 100 vehicles of known release left the relevant green unchanged before the fix. After the fix that phase receives more green, within existing bounds. The snapshot remains immutable.

## Implemented correction

`services/intelligence/known_demand.py` supplies one causal per-tick release sequence to both candidate generation and model rollouts. It uses only commitments already present in the authoritative snapshot, caps each release by remaining mass, suppresses duplicate forecast flow until the known horizon ends, and then resumes the existing forecast. A fractional known-horizon endpoint now resumes forecast for the uncovered portion of that same tick; the previous whole-tick suppression lost that fraction. The release-version identity also participates in the demand hash. Valid zero remains known zero. Candidate pressure uses this offered mass and configured turning ratios. Cancellation checks remain inside loops.

The candidate-policy version is now `causal-corridor-proposals-v3`; scoring identity is `comparison-scoring-v1.4`, so comparisons cannot silently retain the previous policy identity. No protobuf numbering, public API, architecture, phase bounds, regression thresholds, candidate count, concurrency, horizon or deadline changed.

## Verification and limits

The two previously failing graph regressions pass. Five additional cases verify fractional release timing against the actual video demand provider, valid zero, partial remaining mass, subsequent forecast, conservation and snapshot immutability. The complete real-dependency Python suite passes **354 tests**.

The declared development synthetic benchmark completes 72 cases with **31/144** qualifying origins. All 48 no-benefit, degraded-input and emergency lifecycle checks pass. These synthetic cases contain no recorded commitments; this fix therefore does not establish improved synthetic benefit. Development results cannot satisfy independent acceptance. Fresh frozen synthetic verification and local compute-budget evidence are recorded separately in the follow-up manifest. Genuine reviewed recorded references and non-implementing operator acceptance remain unavailable.

The fractional-horizon regression reproduced a missing 0.2 vehicle: a known one-vehicle release until 10.5 seconds plus a 0.4 veh/s forecast over 10.5–11 should offer 1.2 vehicles, while the old implementation offered only 1.0. The corrected implementation preserves the known one vehicle and adds only the uncovered forecast fraction. Historical fresh v9 belongs to the intermediate source `cee3461`; it completed 72 cases with 31/144 qualifying origins, failed the 50% gate, and was verified before the later fractional correction. Its freeze and result remain unchanged.

Final fresh v10, frozen before execution at source `7ff7c6d771f1d68eb87a72651e901251f25784c9`, completed 72 cases with **33/144 (22.9%)**, still below 50%. All original thresholds remain intact. The current local resource check measures 60 samples at 0.228-second p95 within budget; authenticated private gRPC checks pass on both graphs. These do not establish field benefit or human acceptance.
