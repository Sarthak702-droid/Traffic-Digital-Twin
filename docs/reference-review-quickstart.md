# Review three short traffic windows

This guide is for human reviewers. You do not need to know how the vision model works. The three local guide videos contain the camera's configured line and queue region, but no model boxes, tracks, or answers. Reviewers should work separately and must not see each other's entries until both are finished.

## Open the local packet

Run once from the V02 worktree (adjust the source root if the authorized clips move):

```bash
python scripts/prepare-reference-review.py \
  --source-root '/home/soumyajeet/Projects/Traffic-Digital-Twin/traffic video' \
  --output-root '/home/soumyajeet/Projects/Traffic-Digital-Twin/.runtime/reference-review'
```

The ignored `.runtime/reference-review/` directory then has a five-second guide video, a still, and separate blank event and summary CSV files for each reviewer and window. Source media and derived frames remain local and outside git/reports. The source time shown on each frame is frame index divided by the clip's FPS. The exact source intervals are in `packages/reference-samples/candidate-windows-v1.json`.

## What to count

1. Play a guide video slowly, pausing as needed. **Green** is the counting segment. Its arrow is the accepted travel direction. **Blue** is the optional visible queue region.
2. For each physical object whose **bottom centre** crosses the green segment in the arrow direction during the displayed five seconds, add one row to your `events.csv`: source time, class key, and `crossing`. Count an object once even if it remains near the line. Objects crossing the opposite way or outside the segment are excluded.
3. If an object may have crossed but an obstruction, cut, or unclear class prevents a reliable decision, add an `ambiguous` row and write why. Do not silently convert ambiguity to zero. A genuinely empty crossing list is a valid zero only after watching the entire window.
4. Use these class keys: `two_wheeler`, `autorickshaw`, `car`, `bus`, `lcv`, `truck`, `bicycle`, `pedestrain`. The unusual spelling `pedestrain` is the current versioned data key. Do not label a class by guessing through an obstruction.
5. For visible queue, select a source time and count only vehicles clearly stopped within the blue region. Enter the time and count in `summary.csv`. If stopping cannot be distinguished or the region is unsuitable, leave the count blank and write `unavailable` plus the reason. Do not infer speed, an unseen queue, or a corridor total.
6. Enter your name and review time in `summary.csv`, then sum your crossing rows by class and total. Send your files to the coordinator without seeing the other reviewer's work.

The coordinator compares the two sets of events and resolves differences against the original clip. Keep the resolved aggregate label, both reviewer names and dates, ambiguity decisions, clip and geometry hashes, and tuning/reserved split in a separate reviewed record. Do not commit per-object event files, tracking IDs, frames, or clips. No reference is considered independently reviewed, and no accuracy claim is allowed, until the second review and adjudication are recorded.

The current green line and blue region come from `packages/camera-config/cameras.json`. If a reviewer finds the line or region invalid for the scene, record that in the notes and stop that window's label review; select and freeze a corrected geometry or another window before counting. Do not quietly move the line on the review video.

The CAM-12 guide's blue region visibly includes a large non-road area. Treat its queue label as unavailable unless the reviewer can justify a visible stopped-vehicle count within the road portion. This does not prevent reviewing its line crossings.
