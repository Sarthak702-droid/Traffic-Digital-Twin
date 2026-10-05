# Private ITD annotation preview repair

The vehicle detector was present. Privacy remediation removed per-frame tracking details from public telemetry, but the display still tried to draw boxes from `frames[].detections`. Aggregate telemetry cannot supply those boxes. This repair restores class/confidence annotations as private raster video, rather than restoring persisted identities or trajectories.

## Implementation

- The existing real ITD/ByteTrack processor renders sampled boxes and class/confidence labels into ignored private H.264 previews. Track association remains transient. No IDs or trails are drawn. These pixels are private recorded-source media, not run-report evidence.
- Before loading a checkpoint, verify the approved SHA-256. Each camera must match the authorized source registry and canonical media root. Cache identity includes source, model, geometry/config, detector/tracker, preprocessing and sampling parameters.
- Serialize generation. Require complete source decode. Failed processing aborts the temporary encoder and preserves an earlier complete preview. Publish preview and manifest atomically; a checksum mismatch between them is rejected.
- Go serves authenticated metadata and GET/HEAD/range media under `/api/v1/clips/{id}/annotation[/media]`. Confined filesystem access, regular-file checks, registered filename, source/model/config identities, complete coverage and checksum are required. Invalid previews return unavailable. No tracking histories enter the public aggregate payload.
- The UI selects only matching private media, clears stale camera metadata, labels output provisional and sampled, and loops at the actual source end. Queue estimates without motion history remain unavailable.
- Public report/telemetry privacy denylist includes the entire `detections` field.

## Local generation

Use the canonical locked `.venv` and the approved local checkpoint/media root:

```sh
PYTHONPATH="$PWD:$PWD/packages/contracts/gen/python" .venv/bin/python scripts/generate_vision_clips_telemetry.py \
  --model /absolute/private/model/best_xl_ITD_v1.2.pt \
  --video-root /absolute/authorized/media-root \
  --output .runtime/vision/display-aggregates.json
```

Private assets remain outside git. The default preview directory is `.runtime/vision/display-annotations`; Go accepts `VISION_ANNOTATION_DIR` for a different private directory. Restart the canonical stack after updating Go code; Vite loads frontend changes automatically.

## Benefit gate root cause and limits

This display repair does not change the controller or benchmark. The last frozen v10 result remains 33/144 (22.9%), required 72/144 (50%), **failed**. Synthetic cases do not contain the recorded-demand commitments repaired earlier.

For `c1-c6-84911-peak-high_capacity`, origin 240, fixed/current has queue delay 22467.938972 veh·s, external waiting 10338.022602 veh·s and backlog 80.916855 veh. Local timing has queue delay 25799.453760, external waiting 9069.022602 and backlog 56.916855. Passing requires queue delay at most 21344.54 while also keeping external waiting at most 9250.403 and backlog at most 58.05519, plus the other unchanged constraints. Current bounded candidates do not achieve these jointly. Reducing internal queues by pushing delay into boundary waiting or side roads cannot pass. Finite development searches are not a proof that no better safe controller exists.

Independent accuracy review and a non-implementing operator acceptance run still require genuine human records. Detector predictions cannot supply those records. The existing 20-item remediation report is preserved; this handoff adds the display repair and its verification, without marking either outstanding gate passed.

## Verification

See `reports/audit-verification/annotation-preview-v1/manifest.json` for commands, revisions, results and artifact hashes. The initial failing regressions are retained there. CPU-contended verification runs are retained separately from isolated results; no test deadlines, benefit thresholds or safety checks were weakened.
