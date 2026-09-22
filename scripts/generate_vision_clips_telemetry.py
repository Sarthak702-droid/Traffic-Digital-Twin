#!/usr/bin/env python3
"""
Generate High-Fidelity ITD v1.2 Detection & Tracking Telemetry for all 12 Videos.
Processes the first 10.0s of each video with ITD v1.2 YOLO + ByteTrack.
Saves incrementally after each camera to:
  apps/web/public/vision_clips_data.json
  apps/web/lib/vision_clips_data.json
"""

import json
import os
import sys
from pathlib import Path
import cv2
import numpy as np
import torch
from ultralytics import YOLO

torch.set_num_threads(min(4, os.cpu_count() or 4))

MODEL_PATH = ".runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt"
CAMERAS_JSON = "packages/camera-config/cameras.json"
ASSET_MANIFEST = "asset-manifest.json"
OUTPUT_PUBLIC = Path("apps/web/public/vision_clips_data.json")
OUTPUT_LIB = Path("apps/web/lib/vision_clips_data.json")

ITD_CANONICAL_CLASSES = {
    0: "two_wheeler",
    1: "autorickshaw",
    2: "car",
    3: "bus",
    4: "lcv",
    5: "truck",
    6: "bicycle",
    7: "pedestrain",
}


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


def process_video_10s(video_path: str, cam_cfg: dict, model: YOLO, num_keyframes: int = 8, out_fps: float = 10.0):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[WARN] Cannot open {video_path}")
        return None

    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    geom = cam_cfg.get("geometry", {})
    counting_line = geom.get("counting_line", {"p1": [0.15, 0.55], "p2": [0.85, 0.55]})
    p1 = counting_line["p1"]
    p2 = counting_line["p2"]
    vec = geom.get("direction_vector", [0.0, 1.0])
    queue_roi = geom.get("queue_roi", [[0.2, 0.3], [0.8, 0.3], [0.85, 0.6], [0.15, 0.6]])

    duration_s = 10.0
    total_src_frames = min(int(duration_s * src_fps), int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 300))
    step = max(1, total_src_frames // num_keyframes)

    keyframe_tracks = {} # track_id -> { times: [], bboxes: [], class: str, confs: [] }

    print(f"  Extracting {num_keyframes} keyframes across {duration_s}s from {os.path.basename(video_path)}...")

    for kf_i in range(num_keyframes):
        ret, frame = cap.read()
        if not ret:
            break
        # Fast-forward decoder to next sample point using grab()
        for _ in range(step - 1):
            if not cap.grab():
                break

        t_sec = round((kf_i * step) / src_fps, 2)
        # Resize to 960x540 for fast CPU inference
        frame_res = cv2.resize(frame, (960, 540))

        results = model.track(
            frame_res,
            persist=True,
            tracker="bytetrack.yaml",
            device="cpu",
            imgsz=640,
            conf=0.22,
            verbose=False,
        )[0]

        if results.boxes is not None and len(results.boxes) > 0:
            boxes = results.boxes.xyxy.cpu().numpy()
            classes = results.boxes.cls.cpu().numpy().astype(int)
            confs = results.boxes.conf.cpu().numpy()
            ids = results.boxes.id.cpu().numpy().astype(int) if results.boxes.id is not None else list(range(len(boxes)))

            for box, cid, conf, tid in zip(boxes, classes, confs, ids):
                tid = int(tid)
                cname = ITD_CANONICAL_CLASSES.get(cid, "car")

                # Normalize 0.0 .. 1.0 (from 960x540)
                nx1 = max(0.0, min(1.0, float(box[0] / 960.0)))
                ny1 = max(0.0, min(1.0, float(box[1] / 540.0)))
                nx2 = max(0.0, min(1.0, float(box[2] / 960.0)))
                ny2 = max(0.0, min(1.0, float(box[3] / 540.0)))

                if tid not in keyframe_tracks:
                    keyframe_tracks[tid] = {
                        "times": [],
                        "bboxes": [],
                        "class": cname,
                        "confs": [],
                    }
                keyframe_tracks[tid]["times"].append(t_sec)
                keyframe_tracks[tid]["bboxes"].append([nx1, ny1, nx2, ny2])
                keyframe_tracks[tid]["confs"].append(float(conf))

    cap.release()

    # Generate continuous 10 fps timeline (100 frames total: 0.0s to 9.9s)
    total_out_frames = int(duration_s * out_fps)
    frames_timeline = []
    crossed_track_ids = set()

    for f_i in range(total_out_frames):
        cur_t = round(f_i / out_fps, 2)
        active_detections = []
        cur_class_counts = {}
        queue_count = 0

        for tid, tdata in keyframe_tracks.items():
            times = tdata["times"]
            bboxes = tdata["bboxes"]
            if not times:
                continue

            # Check if vehicle exists within active window (times[0] - 0.5s to times[-1] + 1.0s)
            if cur_t < times[0] - 0.3 or cur_t > times[-1] + 1.2:
                continue

            if cur_t <= times[0]:
                interp_box = bboxes[0]
                conf = tdata["confs"][0]
            elif cur_t >= times[-1]:
                # Extrapolate slightly in direction of last motion
                b_last = bboxes[-1]
                interp_box = b_last
                conf = tdata["confs"][-1]
            else:
                idx = 0
                while idx < len(times) - 1 and times[idx + 1] <= cur_t:
                    idx += 1
                t_prev = times[idx]
                t_next = times[idx + 1]
                ratio = (cur_t - t_prev) / max(1e-4, (t_next - t_prev))
                b_prev = bboxes[idx]
                b_next = bboxes[idx + 1]
                interp_box = [
                    round(b_prev[j] + ratio * (b_next[j] - b_prev[j]), 4)
                    for j in range(4)
                ]
                conf = tdata["confs"][idx]

            cx = round((interp_box[0] + interp_box[2]) / 2.0, 4)
            cy = round((interp_box[1] + interp_box[3]) / 2.0, 4)
            cname = tdata["class"]
            cur_class_counts[cname] = cur_class_counts.get(cname, 0) + 1

            in_q = point_in_poly(cx, cy, queue_roi)
            if in_q:
                queue_count += 1

            trail = []
            for t_val, b_val in zip(times, bboxes):
                if t_val <= cur_t:
                    tcx = round((b_val[0] + b_val[2]) / 2.0, 4)
                    tcy = round((b_val[1] + b_val[3]) / 2.0, 4)
                    trail.append([tcx, tcy])
            if not trail or trail[-1] != [cx, cy]:
                trail.append([cx, cy])

            if tid not in crossed_track_ids and len(trail) >= 2:
                if has_crossed_line(trail[-2], trail[-1], p1, p2, vec):
                    crossed_track_ids.add(tid)

            active_detections.append({
                "id": tid,
                "class": cname,
                "conf": round(conf, 2),
                "bbox": interp_box,
                "centroid": [cx, cy],
                "trail": trail[-6:],
                "in_queue": in_q,
                "has_crossed": tid in crossed_track_ids,
            })

        frames_timeline.append({
            "time_s": cur_t,
            "frame_idx": f_i,
            "active_count": len(active_detections),
            "queue_count": queue_count,
            "cumulative_crossed": len(crossed_track_ids),
            "class_counts": cur_class_counts,
            "detections": active_detections,
        })

    summary_classes = {}
    for tid, tdata in keyframe_tracks.items():
        c = tdata["class"]
        summary_classes[c] = summary_classes.get(c, 0) + 1

    return {
        "camera_id": cam_cfg.get("camera_id"),
        "video_file": os.path.basename(video_path),
        "virtual_direction": cam_cfg.get("virtual_direction", "Approach"),
        "network_role": cam_cfg.get("network_role", "traffic_edge_stream"),
        "resolution": f"{orig_w}x{orig_h}",
        "fps": 30.0,
        "duration_s": duration_s,
        "geometry": geom,
        "summary": {
            "total_unique_vehicles": len(keyframe_tracks),
            "total_crossed": len(crossed_track_ids),
            "class_breakdown": summary_classes,
        },
        "frames": frames_timeline,
    }


def save_intermediate(results: dict):
    OUTPUT_PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PUBLIC, "w") as f:
        json.dump(results, f, indent=2)
    OUTPUT_LIB.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_LIB, "w") as f:
        json.dump(results, f, indent=2)


def main():
    print("Loading ITD v1.2 YOLO model...")
    model = YOLO(MODEL_PATH)

    with open(CAMERAS_JSON, "r") as f:
        cameras = json.load(f)["cameras"]

    with open(ASSET_MANIFEST, "r") as f:
        assets = json.load(f)["assets"]

    video_map = {a["assigned_slot"]: a["filename"] for a in assets}

    results = {}
    if OUTPUT_PUBLIC.exists():
        try:
            with open(OUTPUT_PUBLIC, "r") as f:
                results = json.load(f)
        except Exception:
            results = {}

    cam_keys = sorted(cameras.keys(), key=lambda x: int(x.split("-")[-1]))

    for slot in cam_keys:
        cam_cfg = cameras[slot]
        video_filename = video_map.get(slot) or cam_cfg.get("assigned_video")
        if not video_filename or not os.path.exists(video_filename):
            print(f"[SKIP] Video {video_filename} not found on disk")
            continue

        print(f"\n==========================================")
        print(f"Processing {slot}: {video_filename}")
        print(f"==========================================")
        data = process_video_10s(video_filename, cam_cfg, model, num_keyframes=8, out_fps=10.0)
        if data:
            results[slot] = data
            save_intermediate(results)
            print(f"  -> Saved {slot}: {len(data['frames'])} frames, {data['summary']['total_unique_vehicles']} tracked vehicles, {data['summary']['total_crossed']} crossings.")

    print(f"\nFinished all {len(results)} cameras successfully.")


if __name__ == "__main__":
    main()
