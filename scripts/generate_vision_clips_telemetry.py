#!/usr/bin/env python3
"""Generate local, timestamped full-clip display detections; never run demand.

Tracking associations stay transient. Private raster previews contain class/confidence annotations only. Existing finalized
aggregate observation artifacts are not rewritten by display processing.
"""
import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path
from datetime import datetime, timezone
import cv2
import torch
from ultralytics import YOLO
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.vision.annotation_preview import AnnotationEncoder, raster_annotations
from services.shared.privacy import reject_private_fields
from scripts.prepare_video_displays import registered_source

VERSION = "display-aggregates-v3"
ITD_CANONICAL_CLASSES = {0: "two_wheeler", 1: "autorickshaw", 2: "car", 3: "bus", 4: "lcv", 5: "truck", 6: "bicycle", 7: "pedestrain"}
ROOT = Path(__file__).resolve().parents[1]


def hash_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_model_classes(model):
    names = dict(enumerate(model.names)) if isinstance(model.names, list) else model.names
    # Checkpoint spelling is normalized only for verifying the versioned mapping.
    normalized = {int(key): str(value).lower().replace(" ", "_").replace("pedestrian", "pedestrain") for key, value in names.items()}
    if normalized != ITD_CANONICAL_CLASSES:
        raise ValueError(f"Unsupported detector class mapping: {names}")


def resize_for_inference(frame, longest_side=960):
    height, width = frame.shape[:2]
    scale = min(1, longest_side / max(width, height))
    return cv2.resize(frame, (max(1, round(width * scale)), max(1, round(height * scale))))


def point_in_poly(x: float, y: float, poly: list) -> bool:
    n = len(poly)
    inside = False
    p1x, p1y = poly[0]
    for i in range(n + 1):
        p2x, p2y = poly[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside


def has_crossed_line(prev_pt, curr_pt, p1, p2, vec) -> bool:
    if prev_pt is None or curr_pt is None:
        return False
    def cp(pt):
        return (p2[0] - p1[0]) * (pt[1] - p1[1]) - (p2[1] - p1[1]) * (pt[0] - p1[0])
    cp1 = cp(prev_pt)
    cp2 = cp(curr_pt)
    if (cp1 < 0 and cp2 >= 0) or (cp1 >= 0 and cp2 < 0):
        min_x = min(p1[0], p2[0]) - 0.15
        max_x = max(p1[0], p2[0]) + 0.15
        if min_x <= curr_pt[0] <= max_x:
            dy = curr_pt[1] - prev_pt[1]
            dx = curr_pt[0] - prev_pt[0]
            dot = dx * vec[0] + dy * vec[1]
            return dot >= 0
    return False


def process_video(video_path, cam_cfg, model, sample_fps=2.0, device="cpu", identity=None, annotation_path=None):
    validate_model_classes(model)
    if not math.isfinite(sample_fps) or sample_fps <= 0:
        raise ValueError("Sampling FPS must be finite and positive")
    # Association state must never cross camera/source boundaries.
    for tracker in getattr(getattr(model, "predictor", None), "trackers", []):
        tracker.reset()
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        cap.release()
        raise ValueError(f"Cannot open registered clip: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if not math.isfinite(fps) or fps <= 0 or min(width, height, count) <= 0:
        cap.release()
        raise ValueError("Invalid recorded media metadata")
    duration = count / fps
    step = max(1, round(fps / sample_fps))
    geometry = cam_cfg.get("geometry", {})
    line = geometry.get("counting_line", {"p1": [.15, .55], "p2": [.85, .55]})
    vector = geometry.get("direction_vector", [0, 1])
    queue_roi = geometry.get("queue_roi", [])
    tracks, unique, crossed, rows = {}, {}, set(), []
    frame_index = 0
    encoder = None
    try:
        while True:
            ok, frame = cap.read() if frame_index % step == 0 else (cap.grab(), None)
            if not ok:
                break
            if frame is not None:
                time_s = frame_index / fps
                resized = resize_for_inference(frame)
                ih, iw = resized.shape[:2]
                result = model.track(resized, persist=True, tracker="bytetrack.yaml", device=device,
                                     imgsz=640, conf=.22, verbose=False)[0]
                detections, class_counts, queued = [], {}, 0
                queue_unknown = not bool(queue_roi)
                boxes = result.boxes
                if boxes is not None:
                    coordinates = boxes.xyxy.cpu().numpy()
                    classes = boxes.cls.cpu().numpy().astype(int)
                    confidences = boxes.conf.cpu().numpy()
                    ids = boxes.id.cpu().numpy().astype(int) if boxes.id is not None else [None] * len(classes)
                    for box, cid, confidence, track_id in zip(coordinates, classes, confidences, ids):
                        if int(cid) not in ITD_CANONICAL_CLASSES:
                            raise ValueError("Unknown detector class")
                        name = ITD_CANONICAL_CLASSES[int(cid)]
                        bbox = [max(0, min(1, float(value) / size)) for value, size in zip(box, [iw, ih, iw, ih])]
                        center = [(bbox[0] + bbox[2]) / 2, bbox[3]]
                        tid = int(track_id) if track_id is not None else None
                        trail = []
                        previous = None
                        if tid is not None:
                            previous = tracks.get(tid)
                            unique[tid] = name
                            if previous and time_s - previous[0] <= 2 * step / fps:
                                trail = previous[2]
                                if name != "pedestrain" and tid not in crossed and has_crossed_line(previous[1], center, line["p1"], line["p2"], vector):
                                    crossed.add(tid)
                            trail = (trail + [center])[-6:]
                            tracks[tid] = (time_s, center, trail)
                        in_queue = name != "pedestrain" and bool(queue_roi) and point_in_poly(*center, queue_roi)
                        if in_queue:
                            if previous is None or time_s <= previous[0]: queue_unknown = True
                            else:
                                speed = math.hypot(center[0]-previous[1][0],center[1]-previous[1][1])/(time_s-previous[0])
                                queued += int(speed < float(geometry.get("queue_motion_threshold_normalized_per_s",0.005)))
                        class_counts[name] = class_counts.get(name, 0) + 1
                        detections.append({"id": tid, "class": name, "conf": float(confidence), "bbox": bbox,
                                           "centroid": center, "trail": trail, "in_queue": in_queue, "has_crossed": tid in crossed})
                if annotation_path is not None:
                    rendered = raster_annotations(resized, detections)
                    if encoder is None:encoder = AnnotationEncoder(annotation_path, rendered, fps/step, duration)
                    encoder.write(rendered)
                rows.append({"time_s": time_s, "valid_until_s": min(duration, (frame_index + step) / fps),
                             "frame_idx": frame_index, "active_count": sum(v for k, v in class_counts.items() if k != "pedestrain"),
                             "pedestrian_count": class_counts.get("pedestrain", 0), "queue_count": None if queue_unknown else queued,
                             "queue_status": "unavailable" if queue_unknown else "estimated_visible_region",
                             "cumulative_crossed": len(crossed), "class_counts": class_counts})
                # Bound association history when a track disappears.
                tracks = {tid: value for tid, value in tracks.items() if time_s - value[0] <= 2}
                if len(rows) % 50 == 0:
                    print(f"  {cam_cfg['camera_id']}: {time_s:.1f}/{duration:.1f}s processed", flush=True)
            frame_index += 1
    except BaseException:
        if encoder is not None:encoder.abort()
        raise
    finally:
        cap.release()
    if frame_index < count:
        if encoder is not None:encoder.abort()
        raise ValueError(f"Incomplete decode: {frame_index}/{count} frames; telemetry not published")
    if encoder is not None:encoder.finish()
    summary_classes = {name: sum(value == name for value in unique.values()) for name in ITD_CANONICAL_CLASSES.values()}
    return {"schema_version": VERSION, "camera_id": cam_cfg['camera_id'], "video_file": Path(video_path).name,
            "resolution": f"{width}x{height}", "fps": fps, "duration_s": duration,
            "sample_interval_s": step / fps, "geometry": geometry,
            "source_identity": identity or {"clip_sha256": hash_file(video_path), "geometry_sha256": hash_json(geometry)},
            "processed_at_utc": datetime.now(timezone.utc).isoformat(), "processing_mode": "cached_observations",
            "validation_level": "provisional_unreviewed", "frames": rows,
            "summary": {"total_unique_vehicles": sum(v for k,v in summary_classes.items() if k != "pedestrain"),
                        "total_unique_pedestrians": summary_classes.get("pedestrain", 0),
                        "total_crossed": len(crossed), "class_breakdown": summary_classes}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=ROOT / ".runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt")
    parser.add_argument("--video-root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=ROOT / "apps/web/public/vision-display-data.json")
    parser.add_argument("--annotation-root", type=Path, default=ROOT / ".runtime/vision/display-annotations")
    parser.add_argument("--sample-fps", type=float, default=2)
    parser.add_argument("--cameras", nargs="*")
    args = parser.parse_args()
    torch.set_num_threads(min(4, os.cpu_count() or 4))
    import fcntl
    args.annotation_root.mkdir(parents=True,exist_ok=True)
    lock = (args.annotation_root / '.fresh-preview.lock').open('a+b')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise RuntimeError('A serialized annotation job is already running')
    model_hash = hash_file(args.model)
    if model_hash != "06006ecb5fe52a348ceed805bf0aa6b32af7e24e689d09a6582f6d53159d6b00":
        raise ValueError("Detector checkpoint SHA-256 does not match verified ITD v1.2")
    model = YOLO(str(args.model))
    validate_model_classes(model)
    config = json.loads((ROOT / "packages/camera-config/cameras.json").read_text())["cameras"]
    results = json.loads(args.output.read_text()) if args.output.exists() else {}
    assets={a['assigned_slot']:a for a in json.loads((ROOT/'reports/asset-manifest.json').read_text())['assets']}
    manifest_path=args.annotation_root/'manifest.json'
    manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'schema_version':'display-annotation-v1','cameras':{}}
    for camera in args.cameras or sorted(config):
        settings = config[camera]
        if settings['assigned_video']!=assets[camera]['filename']:raise ValueError('Camera source differs from authorized registry')
        path = registered_source(args.video_root,assets[camera])
        preview=args.annotation_root/f"{camera}-{assets[camera]['sha256']}-annotated-v1.mp4"
        identity = {"clip_sha256": hash_file(path), "geometry_sha256": hash_json(settings["geometry"]),
                    "model_sha256": model_hash, "detector_version": "itd-v1.2", "tracker_version": "bytetrack",
                    "ultralytics_version": __import__("ultralytics").__version__,
                    "config_sha256": hash_json(settings), "preprocessing_version": VERSION,
                    "sample_fps": args.sample_fps, "imgsz": 640, "confidence": .22}
        cached=manifest.get('cameras',{}).get(camera,{})
        if results.get(camera, {}).get("schema_version") == VERSION and results[camera].get("source_identity") == identity and cached.get('identity')==identity and cached.get('coverage_complete') and preview.is_file() and hash_file(preview)==cached.get('rendition_sha256'):
            print(f"{camera}: matching cache", flush=True)
            continue
        print(f"Processing {camera}: {path.name}", flush=True)
        results[camera] = process_video(path, settings, model, args.sample_fps, identity=identity,annotation_path=preview)
        reject_private_fields(results[camera])
        manifest['cameras'][camera]={'source_clip_sha256':assets[camera]['sha256'],'model_sha256':model_hash,
            'filename':preview.name,'rendition_sha256':hash_file(preview),'geometry':settings['geometry'],
            'sample_fps':1/results[camera]['sample_interval_s'],'duration_s':results[camera]['duration_s'],
            'coverage_complete':True,'identity':identity,'aggregates':results[camera]}
        atomic=manifest_path.with_suffix('.json.tmp');atomic.write_text(json.dumps(manifest,separators=(',',':')));atomic.replace(manifest_path)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(results, separators=(",", ":")))
        temporary.replace(args.output)
    print(f"Completed {len(results)} camera caches", flush=True)


if __name__ == "__main__":
    main()
