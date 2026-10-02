# U01 video display and pedestrian counting

User-authorized follow-up: continuous display-only looping, remove video scrubber/timer, preserve full portrait proportions, replace distorted sparse-keyframe display detections, and separate pedestrians from vehicle metrics.

Files: VisionAnalyticsPanel and CSS; video-display helper/tests; display telemetry generator/tests; vision aggregate pipeline, detector cache version and regression tests. No protobuf, Go API, decision/workspace or readiness changes.

Interface: local ignored `apps/web/public/vision-display-data.json`, schema `display-detections-v2`. Timestamped samples contain source time, bounded validity interval, normalized boxes, per-class counts and transient local tracks. Cache keys include full clip/model/geometry/config hashes, library version, preprocessing version, sampling FPS, image size and confidence. Existing aggregate observation artifacts are not rewritten by the display generator. Registered clip/geometry checks prevent mismatched display cache use. Private media/model/association artifacts remain uncommitted.

Aggregate detector version changes to `itd-v1.2-yolo-vehicle-counts-v2`, invalidating old vehicle-count caches. Legacy `pedestrain` class spelling remains unchanged; its class crossing counts are retained while vehicle crossings and vehicle queue estimates exclude pedestrians.

Conflict resolved: old display regression forbade looping; direct user request now authorizes clearly labelled display-only looping. Source playback time remains visible in operator clocks, independent of virtual time and finalized observations. No loop or seek calls an authoritative run command.

Verification before integration: focused failing playback/portrait regressions and pedestrian vehicle-count regression observed; subsequent focused web tests passed (7); complete web suite passed (152 before final identity/helper refinements); TypeScript and build passed; real OpenCV-backed vision suite passed (19, detector mocked only in unit regressions). Real model class map and pinned SHA-256 verified. Full-clip real YOLO/ByteTrack cache processing and browser acceptance are being completed separately; this handoff does not claim accuracy or prototype gates passed.

Regeneration: `python3 scripts/generate_vision_clips_telemetry.py --model /path/to/verified/best_xl_ITD_v1.2.pt --video-root /path/to/authorized/clips`. Requires the pinned vision runtime including lap. Processes full clips sequentially; matching identity reuses caches; partial/corrupt decode fails without publishing a misleading completed cache. Model inference is offline, CPU-bound; playback reuses cached samples. Queue ROI occupancy is a visible-region estimate, not calibrated queue length.

Remaining accuracy limits: existing detector retained, no retraining or independent reference review; small/occluded pedestrians and sampling gaps can still be missed. UI labels sampled cached detections and shows unavailable outside coverage. Runtime cache must be regenerated on other machines; raw clips and model checkpoint are not part of Git delivery.
