# Q01 acceptance repair — 2026-10-02

The functional engineering prototype remains **not accepted**. This supplements the historical D01/E02/P02/Q01 handoffs; source and real execution were checked. Field benefit, physical actuation and production deployment remain deferred.

## Operating fixes

- All scenario starters already sent explicit `source_sessions`; that audit item was stale. A remaining bug sent independently viewed cameras as extra boundary inputs. The browser now binds only the graph's declared boundary cameras, preserving explicit source selection.
- Go forwards the recommendation's earliest activation time and exact reviewed source epoch/snapshot. Additive private protobuf tags 5/6 use optional presence, so an explicitly empty seeded epoch and zero snapshot remain distinguishable from a missing identity. The simulator checks them under its engine lock before receipt or scheduler mutation. Unbound/stale new dispatches fail closed; an accepted idempotent retry remains a receipt.
- Go persists the exact dispatch payload in existing intent JSON. Reconciliation queries its original hash-bound receipt, including activation and compare-and-set fields. Old intent queries retain their legacy payload. No database-column migration or existing protobuf renumbering is required; generated Go/Python/TypeScript and JSON contracts were regenerated together. Deploy the gateway and private simulator together.
- A real intelligence suspension exposed an additional approval gap before periodic health detection. Approve and modify now perform a fresh private comparison before the final simulator state check and atomic dispatch. Compute loss cannot authorize a cached recommendation during that detection interval.
- Fresh inference receives Linux CPU affinity before detector/decoder imports. The CLI default is four logical CPUs; invalid limits fail before inference. A separately frozen i7 resource protocol avoids reusing the original Ultra 9 workstation budget on this machine.
- The final monitoring check found a separate display-copy race: observations could load successfully, then be erased when the lightweight media URL arrived. Observation state now resets only when its query identity/offline mode changes. Media rendition switching and loop playback retain the same bound observations; a focused delayed-response regression verifies the status, actual finalized window and absence of repeat requests.

## Focused regressions and verification

RED/GREEN covered extra-camera binding, activation forwarding, source/snapshot dispatch races, missing identity presence, exact receipt recovery, immediate compute-loss approval, causal bounded synthetic forecasting, emergency recovery censoring, workstation-budget mismatch and inference CPU limits.

Final validation: all Go packages including real PostgreSQL/gRPC decision tests; 200 Python/service/script/contract tests; 156 web tests across 35 files after the display-observation regression; TypeScript check; Vite build; static contract verification (33 endpoints). The existing large-bundle build warning remains. An initial concurrent Go/web/Python test load produced three intelligence deadline-sensitive failures; a serial full rerun passed without changing deadlines or assertions. This is retained as a resource limitation, not erased from the evidence.

## Real recorded-input and actuation evidence

Real OpenCV, the digest-verified existing ITD checkpoint and ByteTrack newly processed CAM-01/02/03/06 for each graph. These were explicitly authorized 20-second integration segments, not full-clip or reserved-input acceptance. All eight jobs completed with four finalized five-second windows each. Source timestamps and processing completion were preserved; no clip looping or fabricated review status entered authoritative demand.

Real Go/PostgreSQL/private gRPC ran all three scenarios on both graphs. Each held run persisted 12 causal finalized observations and exposed all 30/60/120/300-second horizons: 56 forecasts on the two-controlled-junction graph, 64 on the three-controlled-junction graph. Peak/incident returned `recommend`; emergency returned `no_action` in these samples. Exact held-state review wall times were 4.675/3.601/4.114 seconds and 0.775/3.795/3.787 seconds respectively. These six samples are not continuous-run p95.

On both graphs, real authenticated approval/resume changed every approved active phase timing at virtual second 35; strict v2 reports recorded `applied`. Direct private dispatch probes rejected changed source epochs and snapshot sequences without creating receipts. Real intelligence suspension blocked approval with 503; simulator suspension blocked with 409. After each recovery, a new gateway decision ID was issued and the old ID continued returning 409. Earlier approval during the compute detection interval failed before the new guard and is not acceptance evidence.

The browser explicitly selected the four boundary sessions and started a real recorded-input run. One-action authenticated export downloaded the applied-run report, which validated against the strict v2 schema and excluded media/model paths, tracking IDs and credentials. Report history retained earlier runs across isolated stack restart. Exact-command durability is also covered by the PostgreSQL/gRPC regression.

## Resource and tuning diagnostics

Machine: Intel Core i7-1065G7, eight logical CPUs. The new machine budget was recorded before its resource probes; original protocols remain unchanged.

- Serialized aggregate simulation: 3,600 steps, p95 4.441 ms, peak sampled CPU 98.79%, peak process RSS 27,648,000 bytes.
- Serialized bounded candidate analysis: 60 samples across both graphs/all scenarios, p95 767.557 ms, peak CPU 100.07%, peak RSS 27,627,520 bytes. Both isolated processes met the declared budgets.
- A four-core fresh 25-second segment: 50 actual inference frames, 87.015 wall seconds, 0.575 inference frames/s, peak CPU 375.63%, RSS 1,408,057,344 bytes. Earlier unconstrained preparation exceeded the new four-core ceiling and is not budget acceptance.
- Concurrent four-core fresh job: 60 frames over 107.569 seconds, 0.558 frames/s, peak CPU 380.62%, RSS 1,444,663,296 bytes. Five sampled analysis-origin responses had p95 1.432 seconds. Their public `cannot_evaluate` responses cannot establish actionable recommendation capacity: durable records contained recommendations, but the moving clock had invalidated exact-snapshot actions. After inference completed, its CAM-01 session plus three cached sources supported an exact held-state review in 2.429 seconds.
- A two-core diagnostic preserved the same identity checks: 30 frames over 72.883 seconds, 0.412 frames/s, peak sampled CPU approximately 200%, RSS 1,381,163,008 bytes; five sampled responses p95 1.412 seconds; fresh-source plus cached held review 1.170 seconds. No deadline was weakened. These 24-second workload probes use partial clips, do not sample every possible analysis origin, and do not declare general supported-stream capacity.

The unchanged frozen v1 mechanics were rerun: **72 cases completed, zero harness failures, 0/144 eligible normal origins met the improvement criteria; gate false**. This repeats already viewed cases on a different workstation and is not a new untouched evaluation. The original failed result and thresholds remain intact. No controller redesign or held-out success is claimed.

New tuning-only synthetic forecast diagnostics use declared traces/seeds, bounded past-only history, complete future target bins and no filling/looping. Forty-five of 48 horizon/case entries met the diagnostic improvement threshold against persistence. The operating forecaster is already boundary-local, so the local-only comparator is identical and supplies no independent advantage. These results do not pass the frozen recorded-data forecast gate.

Emergency tuning now measures configured aggregate route departures/green service and the real synthetic request/scheduler recovery lifecycle. Twelve cases/48 origins completed without harness failures: 96 plan metrics observed completed recovery, 24 were censored at the scoring-window end and 24 could not evaluate the protected candidate. Route traffic is not ambulance travel time. The tuning-only gate remains false; original v1 emergency scores remain unavailable.

## Reproduction and private evidence

Use `RUNBOOK.md`, `scripts/rehearse_prototype.py`, the regenerated contracts and the checked-in tuning/resource protocols. The local real-inference environment used the locked Torch/Ultralytics/OpenCV versions; LAP was staged under an ignored temporary dependency directory. This is not a clean-machine installation certification.

Developer artifacts remain under ignored `.runtime/q01-repair/`: graph-specific processed bundles and rehearsals; applied reports/proofs; frozen-v1 mechanics rerun; emergency/synthetic tuning diagnostics; serialized resource probes; both concurrency plans/results; browser export proof. Original source/model files, credentials, temporary runtime helpers and association identities were not committed. The verified private model was staged at the configured local model path by a symlink to the existing authorized checkpoint.

## Acceptance still required

1. Two distinct human reviews and adjudication for the three reference windows. Detector-free guides and blank independent review forms were prepared locally; no human labels were invented. Counts/queue accuracy remain unavailable.
2. Controller diagnosis/redesign using tuning data, followed by a newly frozen untouched evaluation. Previously viewed seeds/windows cannot become new held-out evidence. The 0/144 control failure remains open.
3. Resolve the documented immutable-cache processing-age versus frozen ten-second age conflict through a future explicit protocol decision. Cached replay never refreshes processing timestamps.
4. Full-clip continuous latency/usable-analysis and capacity acceptance across the declared workload, plus clean package installation and complete failure/expiry/uncertain-command matrix. The bounded partial-clip probes above do not close these requirements.
5. A non-implementing operator's reserved-clip runbook rehearsal and review of the complete six-gate evidence. Developer automation cannot substitute for that person.

Readiness claims must continue to say all six gates are open or failed. Source selection, authenticated export and much Q01 work were already merged at this checkout; those historical “unmerged/unfinished” descriptions must not be used as current status.
