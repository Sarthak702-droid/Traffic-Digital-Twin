#!/usr/bin/env python3
"""Create local, detector-free review clips from the frozen V02 candidates."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path

import cv2


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "packages/reference-samples/candidate-windows-v1.json"
CAMERAS = ROOT / "packages/camera-config/cameras.json"
EVENT_COLUMNS = ["source_time_s", "class_key", "crossing_or_ambiguous", "ambiguity_reason"]
SUMMARY_COLUMNS = [
    "window_id", "reviewer", "reviewed_at_utc", "total_crossings", "two_wheeler",
    "autorickshaw", "car", "bus", "lcv", "truck", "bicycle", "pedestrain",
    "queue_observation_source_s", "visible_queue_count", "queue_status_or_reason",
    "notes",
]


def point(xy: list[float], width: int, height: int) -> tuple[int, int]:
    return round(xy[0] * width), round(xy[1] * height)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def overlay(frame, geometry: dict, label: str, source_s: float):
    height, width = frame.shape[:2]
    line = geometry["counting_line"]
    p1, p2 = point(line["p1"], width, height), point(line["p2"], width, height)
    queue = geometry.get("queue_roi")
    if queue:
        import numpy as np

        region = np.array([point(p, width, height) for p in queue], dtype=np.int32)
        cv2.polylines(frame, [region], True, (255, 180, 0), 2)
    cv2.line(frame, p1, p2, (0, 255, 80), 3)
    middle = ((p1[0] + p2[0]) // 2, (p1[1] + p2[1]) // 2)
    vector = geometry["direction_vector"]
    end = (middle[0] + round(vector[0] * 65), middle[1] + round(vector[1] * 65))
    cv2.arrowedLine(frame, middle, end, (0, 255, 80), 3, tipLength=0.25)
    cv2.rectangle(frame, (0, 0), (width, 58), (0, 0, 0), -1)
    cv2.putText(frame, f"{label}  source {source_s:.3f}s", (12, 24), cv2.FONT_HERSHEY_SIMPLEX, .65, (255, 255, 255), 2)
    cv2.putText(frame, "Green: count line + direction   Blue: queue region   No AI predictions", (12, 49), cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 255, 255), 1)
    return frame


def make_clip(window: dict, geometry: dict, source_root: Path, output_root: Path) -> dict:
    source = source_root / window["clip_filename"]
    if file_sha256(source) != window["clip_sha256"]:
        raise RuntimeError(f"Clip hash changed for {window['id']}")
    geometry_hash = hashlib.sha256(json.dumps(geometry, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if geometry_hash != window["geometry_sha256"]:
        raise RuntimeError(f"Geometry hash changed for {window['id']}")
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open {source}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        raise RuntimeError(f"Missing FPS for {source}")
    start_frame = round(window["window_start_source_s"] * fps)
    end_frame = round(window["window_end_source_s"] * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    native_width = round(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    native_height = round(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    width = min(native_width, 960)
    height = round(native_height * width / native_width)
    clip_path = output_root / f"{window['id']}-guide.mp4"
    still_path = output_root / f"{window['id']}-guide.png"
    writer = cv2.VideoWriter(str(clip_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    if not writer.isOpened():
        raise RuntimeError(f"Cannot write {clip_path}")
    frames = 0
    try:
        for frame_number in range(start_frame, end_frame):
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError(f"Clip ended early at frame {frame_number}: {source}")
            frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
            frame = overlay(frame, geometry, window["id"], frame_number / fps)
            if frames == 0 and not cv2.imwrite(str(still_path), frame):
                raise RuntimeError(f"Cannot write {still_path}")
            writer.write(frame)
            frames += 1
    finally:
        writer.release()
        cap.release()
    return {"window_id": window["id"], "guide_video": clip_path.name, "guide_still": still_path.name,
            "source_time_method": "frame_index_divided_by_fps", "source_fps": fps, "frames": frames,
            "first_frame": start_frame, "end_frame_exclusive": end_frame}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    output_root = args.output_root.resolve()
    if ".runtime" not in output_root.parts:
        parser.error("output must be in an ignored .runtime directory")
    output_root.mkdir(parents=True, exist_ok=True)
    windows = json.loads(MANIFEST.read_text())["windows"]
    cameras = json.loads(CAMERAS.read_text())["cameras"]
    rendered = []
    for window in windows:
        geometry = cameras[window["camera_id"]]["geometry"]
        rendered.append(make_clip(window, geometry, args.source_root, output_root))
    (output_root / "guide-manifest.json").write_text(json.dumps(rendered, indent=2) + "\n")
    for window in windows:
        for reviewer in ("reviewer-1", "reviewer-2"):
            events = output_root / f"{window['id']}-{reviewer}-events.csv"
            summary = output_root / f"{window['id']}-{reviewer}-summary.csv"
            if not events.exists():
                with events.open("x", newline="") as f:
                    csv.writer(f).writerow(EVENT_COLUMNS)
            if not summary.exists():
                with summary.open("x", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerow(SUMMARY_COLUMNS)
                    writer.writerow([window["id"]] + [""] * (len(SUMMARY_COLUMNS) - 1))
    print(f"Prepared {len(rendered)} review windows in {output_root}")


if __name__ == "__main__":
    main()
