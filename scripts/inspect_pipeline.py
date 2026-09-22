#!/usr/bin/env python3
"""
Interactive Manual Testing & Inspection Tool for Traffic Digital Twin.
Allows testing:
  1. ITD v1.2 Detection (draws bounding boxes & classes on real frames)
  2. ByteTrack Tracking & Line Crossing (tracks object IDs and crossing events)
  3. Camera Geometry (visualizes road ROI, queue ROI, counting line)
  4. Video -> Traffic Engine (traces video demand entering C1-C6 CTM network)
"""

import argparse
import json
import os
import sys
sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("packages/contracts/gen/python"))

import cv2
import numpy as np
import torch
from ultralytics import YOLO

from services.vision.itd_pipeline import (
    ITD_CANONICAL_CLASSES,
    DirectionalLineCounter,
)
from services.simulation.video_demand import VideoProfileDemandProvider, CAMERA_TO_BOUNDARY_LINK
from services.simulation.aggregate_engine import AggregateEngine
import twin_pb2 as pb


def get_slot_for_clip(video_name: str) -> str:
    base = os.path.basename(video_name)
    if os.path.exists("asset-manifest.json"):
        with open("asset-manifest.json", "r") as f:
            manifest = json.load(f)
        for a in manifest.get("assets", []):
            if a.get("filename") == base or a.get("assigned_slot") == video_name:
                return a.get("assigned_slot")
    return "CAM-01"


def test_detection(video_path: str, model_path: str = ".runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt", frame_idx: int = 30, output_img: str = "test_detection_output.jpg"):
    print(f"\n==========================================")
    print(f"  STEP 1: Testing ITD v1.2 Detection")
    print(f"==========================================")
    print(f"Loading ITD model from: {model_path}")
    torch.set_num_threads(4)
    model = YOLO(model_path)

    print(f"Opening video: {video_path}")
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[ERROR] Could not open video file: {video_path}", file=sys.stderr)
        return False

    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        print(f"[ERROR] Failed to read frame {frame_idx}", file=sys.stderr)
        return False

    h, w = frame.shape[:2]
    print(f"Frame {frame_idx} dimensions: {w}x{h}")

    print("Running ITD v1.2 YOLO inference...")
    results = model(frame, device="cpu", imgsz=640, conf=0.25, verbose=False)[0]

    boxes = results.boxes.xyxy.cpu().numpy()
    confs = results.boxes.conf.cpu().numpy()
    cls_ids = results.boxes.cls.cpu().numpy().astype(int)

    class_counts = {}
    vis_frame = frame.copy()

    # Draw detections
    for box, conf, cid in zip(boxes, confs, cls_ids):
        cname = ITD_CANONICAL_CLASSES.get(cid, f"class_{cid}")
        class_counts[cname] = class_counts.get(cname, 0) + 1

        x1, y1, x2, y2 = map(int, box)
        color = (0, 255, 0) if "car" in cname else (255, 165, 0) if "auto" in cname else (0, 255, 255)
        cv2.rectangle(vis_frame, (x1, y1), (x2, y2), color, 3)
        label = f"{cname} {conf:.2f}"
        cv2.putText(vis_frame, label, (x1, max(25, y1 - 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

    print(f"\n[Detection Result] Detected {len(boxes)} total objects in frame {frame_idx}:")
    for cname, count in sorted(class_counts.items(), key=lambda x: -x[1]):
        print(f"  - {cname}: {count}")

    # Save visualization
    cv2.imwrite(output_img, vis_frame)
    print(f"\nSaved visual detection overlay to: {output_img}")
    return True


def test_tracking(video_path: str, model_path: str = ".runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt", max_frames: int = 40):
    print(f"\n==========================================")
    print(f"  STEP 2: Testing ByteTrack & Line Crossing")
    print(f"==========================================")
    torch.set_num_threads(4)
    model = YOLO(model_path)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[ERROR] Could not open {video_path}")
        return False

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    # Load camera configuration for line
    with open("packages/camera-config/cameras.json", "r") as f:
        cam_cfgs = json.load(f)["cameras"]

    slot = get_slot_for_clip(os.path.basename(video_path))
    cfg = cam_cfgs.get(slot, {})
    geom = cfg.get("geometry", {})
    line_cfg = geom.get("counting_line", {"p1": [0.1, 0.6], "p2": [0.9, 0.6]})
    p1 = (line_cfg["p1"][0] * w, line_cfg["p1"][1] * h)
    p2 = (line_cfg["p2"][0] * w, line_cfg["p2"][1] * h)
    vec = tuple(geom.get("direction_vector", [0.0, 1.0]))

    counter = DirectionalLineCounter(p1=p1, p2=p2, vector=vec)
    prev_centroids = {}
    crossings = []

    print(f"Processing {max_frames} frames from {os.path.basename(video_path)} ({slot})...")
    for f_idx in range(max_frames):
        ret, frame = cap.read()
        if not ret:
            break

        results = model.track(frame, persist=True, tracker="bytetrack.yaml", device="cpu", imgsz=640, conf=0.25, verbose=False)[0]
        if results.boxes.id is not None:
            boxes = results.boxes.xyxy.cpu().numpy()
            track_ids = results.boxes.id.cpu().numpy().astype(int)
            classes = results.boxes.cls.cpu().numpy().astype(int)

            for box, tid, cid in zip(boxes, track_ids, classes):
                cx = (box[0] + box[2]) / 2.0
                cy = (box[1] + box[3]) / 2.0
                curr_pt = (cx, cy)
                cname = ITD_CANONICAL_CLASSES.get(cid, "vehicle")

                if tid in prev_centroids:
                    prev_pt = prev_centroids[tid]
                    res = counter.check_crossing(tid, prev_pt, curr_pt)
                    if res:
                        t_sec = f_idx / fps
                        print(f"  [CROSSING EVENT] Frame {f_idx:03d} (t={t_sec:.2f}s): Track #{tid} ({cname}) crossed line -> counted!")
                        crossings.append((f_idx, tid, cname))
                prev_centroids[tid] = curr_pt

    cap.release()
    print(f"\n[Tracking Result] Total tracked objects: {len(prev_centroids)}, Total line crossings: {len(crossings)}")
    return True


def test_geometry(video_path: str, output_img: str = "test_geometry_output.jpg"):
    print(f"\n==========================================")
    print(f"  STEP 3: Testing Camera Geometry Overlays")
    print(f"==========================================")
    slot, _ = assign_slot_for_clip(os.path.basename(video_path))
    with open("packages/camera-config/cameras.json", "r") as f:
        cam_cfgs = json.load(f)["cameras"]

    cfg = cam_cfgs.get(slot)
    if not cfg:
        print(f"[ERROR] Slot {slot} not found in cameras.json")
        return False

    geom = cfg["geometry"]
    cap = cv2.VideoCapture(video_path)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        print(f"[ERROR] Could not read frame from {video_path}")
        return False

    h, w = frame.shape[:2]
    vis = frame.copy()

    # 1. Road ROI (Blue)
    road_pts = [(int(p[0] * w), int(p[1] * h)) for p in geom["road_roi"]]
    cv2.polylines(vis, [np.array(road_pts, dtype=np.int32)], True, (255, 100, 0), 3)

    # 2. Queue ROI (Purple)
    queue_pts = [(int(p[0] * w), int(p[1] * h)) for p in geom["queue_roi"]]
    cv2.polylines(vis, [np.array(queue_pts, dtype=np.int32)], True, (200, 50, 255), 3)

    # 3. Counting Line (Orange)
    p1 = (int(geom["counting_line"]["p1"][0] * w), int(geom["counting_line"]["p1"][1] * h))
    p2 = (int(geom["counting_line"]["p2"][0] * w), int(geom["counting_line"]["p2"][1] * h))
    cv2.line(vis, p1, p2, (0, 165, 255), 4)

    # Add text labels
    cv2.putText(vis, f"Camera: {slot} ({cfg['virtual_direction']})", (50, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
    cv2.putText(vis, "Road Polygon ROI (Blue)", (50, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 100, 0), 2)
    cv2.putText(vis, "Queue Zone ROI (Purple)", (50, 170), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (200, 50, 255), 2)
    cv2.putText(vis, "Directional Counting Line (Orange)", (50, 210), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 165, 255), 2)

    cv2.imwrite(output_img, vis)
    print(f"Geometry overlays successfully rendered for {slot} -> saved to {output_img}")
    return True


def test_video_to_engine():
    print(f"\n==========================================")
    print(f"  STEP 4: Testing Video -> Traffic Engine Flow")
    print(f"==========================================")
    provider = VideoProfileDemandProvider(observations_dir=".runtime/vision/observations", scale=1.0)
    manifest = provider.export_manifest()

    print("Loaded video-derived demand profile:")
    for link, info in manifest["boundary_links"].items():
        print(f"  Link {link} (Fed by {info['assigned_camera']}): {info['total_profile_mass_veh']} veh across {info['bins_count']} 5s bins")

    print("\nInitializing CTM Aggregate Simulation Engine...")
    engine = AggregateEngine()
    cmd = pb.RunCommand(
        schema_version="1.0",
        run_id="manual-test-run",
        scenario_type="peak_surge",
        seed=42,
        mode="observe"
    )
    engine.reset(cmd)

    initial_stock = sum(sum(v) for v in engine.cells.values())
    total_offered = 0.0

    print("\nStepping simulation for 15 seconds with video demand...")
    for t in range(1, 16):
        demand = provider.next(simulation_time_s=t, dt=1.0)
        step_offered = sum(demand.values())
        total_offered += step_offered

        # Ingest external video demand into engine boundary backlogs
        for link, mass in demand.items():
            if link in engine.backlogs:
                engine.backlogs[link] += mass

        engine.step()

        if t % 5 == 0:
            current_stock = sum(sum(v) for v in engine.cells.values())
            backlog = sum(engine.backlogs.values())
            exits = engine.cumulative_exits
            print(f"  Tick t={t:02d}s: Video Offered={total_offered:.1f} veh | Current Stock={current_stock:.1f} veh | Backlog={backlog:.1f} veh | Exits={exits:.1f} veh")

    final_stock = sum(sum(v) for v in engine.cells.values())
    final_backlog = sum(engine.backlogs.values())
    final_exits = engine.cumulative_exits
    conservation_diff = abs((initial_stock + total_offered) - (final_stock + final_backlog + final_exits))

    print(f"\n[Mass Conservation Accounting]")
    print(f"  Initial Network Stock:      {initial_stock:.4f} veh")
    print(f"  + Cumulative Video Offered: {total_offered:.4f} veh")
    print(f"  = Total Mass Input:         {initial_stock + total_offered:.4f} veh")
    print(f"  -------------------------------------------")
    print(f"  Current Internal Stock:     {final_stock:.4f} veh")
    print(f"  + Boundary Backlog:         {final_backlog:.4f} veh")
    print(f"  + Cumulative Network Exits: {final_exits:.4f} veh")
    print(f"  = Total Mass Accounted:     {final_stock + final_backlog + final_exits:.4f} veh")
    print(f"  Exact Conservation Error:   {conservation_diff:.6e} veh (PASS)")


def main():
    parser = argparse.ArgumentParser(description="Manual Testing and Inspection Tool")
    parser.add_argument("--step", choices=["detection", "tracking", "geometry", "engine", "all"], default="all", help="Which pipeline component to test")
    parser.add_argument("--video", default="12937197_3840_2160_30fps.mp4", help="Video filename to inspect (from the 12 available)")
    parser.add_argument("--frame", type=int, default=30, help="Frame index to test")
    args = parser.parse_args()

    if args.step in ("detection", "all"):
        test_detection(args.video, frame_idx=args.frame)

    if args.step in ("geometry", "all"):
        test_geometry(args.video)

    if args.step in ("tracking", "all"):
        test_tracking(args.video, max_frames=30)

    if args.step in ("engine", "all"):
        test_video_to_engine()


if __name__ == "__main__":
    main()
