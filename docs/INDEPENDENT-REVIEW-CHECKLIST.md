# Independent review: a practical checklist

Engineering checks cannot substitute for actual people reviewing the footage. Nothing in this document records a completed review or a passed acceptance gate.

## Choose the people

Ask two classmates or colleagues who can count crossings carefully to act as independent reviewers. They must be different people and must not copy each other's answers or the detector's counts. Ask a person who did not implement the pipeline to operate the prototype using RUNBOOK.md. One of the reviewers may also be that operator if they meet this condition; a third person is optional.

## Reserve a new authorized recording

Use footage you have permission to process and review. Keep the original media outside Git in a protected authorized directory. Reserve footage whose evaluation results have not already been examined. Agree on development and reserved windows, camera direction, class/lane definitions and any visible queue region before processing results. Keep reference answers separate from detector predictions.

Long-horizon forecast scoring requires later observations: a 300-second prediction needs at least 300 seconds of subsequent usable footage after its origin. Each scored horizon also needs the frozen minimum number of eligible origins. Short footage can still test processing, but cannot pass unsupported long-horizon accuracy checks.

## Each reviewer completes their own sheet

Leave these fields blank until the person performs the work. Do not put invented names, dates, counts or signatures into reference records.

| Field | Actual record |
| --- | --- |
| Reviewer identity | |
| Actual review date/time in UTC | |
| Authorized source and rights reference | |
| Reserved window start/end in source seconds | |
| Counting direction and lane/class rules | |
| Crossing count by supported class/lane | |
| Visible queue count, or why unavailable | |
| Review method/version | |

The technical reference record must also bind the immutable clip/geometry/config hashes, source session, frozen split and split-protocol version. A technical helper may copy those exact identifiers from the registered source; it must not fill the human counts or review events.

After both independent sheets exist, compare disagreements and record real adjudication, its author and actual UTC time. Use the strict validator before scoring. Missing or rejected provenance means no accuracy result.

## The operator checks the workflow

Follow RUNBOOK.md and AUDIT-INDEPENDENT-ACCEPTANCE-HANDOFF.md. Record actual actions and results: fresh processing, cached reuse, both graphs, peak/incident/emergency, stale-input handling, manual takeover and locks, safe virtual application when a genuine recommendation exists, restart/recovery, explicit replay and report export. Never approve a fabricated recommendation to complete the checklist.

Record the actual software revision and machine. The original target-machine resource gate still requires measurements on that target. All control remains virtual. Field and production acceptance remain deferred.
