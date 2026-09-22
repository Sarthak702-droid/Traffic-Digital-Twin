"""
ITD v1.2 Vision Analytics Pipeline with ByteTrack and 5-second Aggregations.
PRD §§8, 9, 10, 11, 12; Tasks T06, T07.
Emits schema-compliant camera-observation-v1 JSONL records.
"""

from __future__ import annotations
import hashlib
import json
import math
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Tuple

import cv2
import numpy as np
import torch
from ultralytics import YOLO

# Optimize PyTorch CPU threading
torch.set_num_threads(min(4, os.cpu_count() or 4))

ITD_CANONICAL_CLASSES = {
    0: "two_wheeler",
    1: "autorickshaw",
    2: "car",
    3: "bus",
    4: "lcv",
    5: "truck",
    6: "bicycle",
    7: "pedestrain"
}


@dataclass
class CrossingEvent:
    track_id: int
    class_name: str
    event_time_s: float
    direction: str  # "approaching" or "departing"


@dataclass
class CameraObservationRecord:
    schema_version: str = "camera-observation-v1"
    observation_id: str = ""
    camera_id: str = ""
    clip_id: str = ""
    session_id: str = ""
    direction_id: str = "approaching"
    window_start_s: float = 0.0
    window_end_s: float = 0.0
    available_at_source_s: float = 0.0
    crossings_veh: int = 0
    counts_by_class: Dict[str, int] = field(default_factory=dict)
    flow_vpm: float = 0.0
    queue_visible_veh_estimate: Optional[int] = None
    queue_status: str = "unavailable"
    speed_kph: Optional[float] = None
    speed_status: str = "uncalibrated"
    observation_status: str = "valid"
    validation_level: str = "agent_reviewed"
    media_source: str = "recorded_video"
    processing_mode: str = "online_inference"
    geometry_hash: str = ""
    model_hash: str = ""


class DirectionalLineCounter:
    """
    Directional counting line segment with cross product sign test.
    Counts a track only once across the line in the primary direction.
    """
    def __init__(self, p1: Tuple[float, float], p2: Tuple[float, float], vector: Tuple[float, float], tolerance_px: float = 25.0):
        self.p1 = p1
        self.p2 = p2
        self.vector = vector
        self.tolerance_px = tolerance_px
        self.counted_tracks: set[int] = set()

    def _cross_product(self, p1: Tuple[float, float], p2: Tuple[float, float], pt: Tuple[float, float]) -> float:
        return (p2[0] - p1[0]) * (pt[1] - p1[1]) - (p2[1] - p1[1]) * (pt[0] - p1[0])

    def check_crossing(self, track_id: int, prev_pt: Tuple[float, float], curr_pt: Tuple[float, float]) -> Optional[str]:
        if track_id in self.counted_tracks:
            return None

        cp_prev = self._cross_product(self.p1, self.p2, prev_pt)
        cp_curr = self._cross_product(self.p1, self.p2, curr_pt)

        # Check if crossed the line (signs differ)
        if (cp_prev < 0 and cp_curr >= 0) or (cp_prev >= 0 and cp_curr < 0):
            min_x = min(self.p1[0], self.p2[0]) - self.tolerance_px
            max_x = max(self.p1[0], self.p2[0]) + self.tolerance_px
            min_y = min(self.p1[1], self.p2[1]) - self.tolerance_px
            max_y = max(self.p1[1], self.p2[1]) + self.tolerance_px

            if min_x <= curr_pt[0] <= max_x and min_y <= curr_pt[1] <= max_y:
                dy = curr_pt[1] - prev_pt[1]
                dx = curr_pt[0] - prev_pt[0]
                dot = dx * self.vector[0] + dy * self.vector[1]
                direction = "approaching" if dot > 0 else "departing"
                self.counted_tracks.add(track_id)
                return direction
        return None


class ITDVideoAnalyticsSession:
    """
    Processes a single camera video stream with ITD model and ByteTrack.
    """
    def __init__(
        self,
        camera_id: str,
        video_path: str,
        model_path: str = ".runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt",
        geometry: Optional[Dict[str, Any]] = None,
        bin_duration_s: float = 5.0,
        device: str = "cpu",
        target_fps: float = 2.0,
        session_id: Optional[str] = None
    ):
        self.camera_id = camera_id
        self.video_path = Path(video_path)
        self.model_path = Path(model_path)
        self.bin_duration_s = bin_duration_s
        self.device = device
        self.target_fps = target_fps
        self.session_id = session_id or f"{camera_id}-{int(time.time())}"
        self.geometry = geometry or {}
        
        self.model_hash = self._compute_file_hash(self.model_path) if self.model_path.exists() else "unknown"
        self.geometry_hash = hashlib.sha256(json.dumps(self.geometry, sort_keys=True).encode()).hexdigest()[:16]

    @staticmethod
    def _compute_file_hash(p: Path) -> str:
        h = hashlib.sha256()
        with open(p, "rb") as f:
            while chunk := f.read(4096 * 1024):
                h.update(chunk)
        return h.hexdigest()[:16]

    def process_stream(
        self,
        max_duration_s: Optional[float] = None,
        confidence_thresh: float = 0.25
    ) -> Generator[CameraObservationRecord, None, None]:
        if not self.video_path.exists():
            raise FileNotFoundError(f"Video file not found: {self.video_path}")
        if not self.model_path.exists():
            raise FileNotFoundError(f"Model checkpoint not found: {self.model_path}")

        model = YOLO(str(self.model_path))

        cap = cv2.VideoCapture(str(self.video_path))
        if not cap.isOpened():
            raise IOError(f"Failed to open video: {self.video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        frame_step = max(1, int(round(fps / self.target_fps)))

        # Counting line in pixel coords
        counting_geom = self.geometry.get("counting_line", {"p1": [0.15, 0.55], "p2": [0.85, 0.55]})
        p1 = (counting_geom["p1"][0] * orig_w, counting_geom["p1"][1] * orig_h)
        p2 = (counting_geom["p2"][0] * orig_w, counting_geom["p2"][1] * orig_h)
        vector = tuple(self.geometry.get("direction_vector", [0, 1]))
        counter = DirectionalLineCounter(p1, p2, vector)

        queue_roi = self.geometry.get("queue_roi")
        queue_pts = None
        if queue_roi:
            queue_pts = np.array([[int(p[0] * orig_w), int(p[1] * orig_h)] for p in queue_roi], np.int32)

        track_positions: Dict[int, Tuple[float, float]] = {}
        track_motion: Dict[int, List[float]] = {}
        current_bin_start = 0.0
        current_bin_crossings = 0
        current_bin_classes: Dict[str, int] = {v: 0 for v in ITD_CANONICAL_CLASSES.values()}
        queue_samples: List[int] = []

        frame_idx = 0
        clip_id = self.video_path.stem

        # Scale down for efficient inference
        infer_w = 640 if orig_w >= orig_h else 384
        infer_h = int(round(orig_h * (infer_w / orig_w)))
        scale_x = orig_w / float(infer_w)
        scale_y = orig_h / float(infer_h)

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            source_time_s = frame_idx / fps
            if max_duration_s and source_time_s >= max_duration_s:
                break

            if frame_idx % frame_step == 0:
                small_frame = cv2.resize(frame, (infer_w, infer_h))
                results = model.track(
                    small_frame,
                    tracker="bytetrack.yaml",
                    persist=True,
                    verbose=False,
                    device=self.device,
                    conf=confidence_thresh,
                    imgsz=640
                )

                boxes = results[0].boxes
                active_queued = 0

                if boxes is not None and len(boxes) > 0 and boxes.id is not None:
                    for i, box_id_tensor in enumerate(boxes.id):
                        track_id = int(box_id_tensor.item())
                        cls_idx = int(boxes.cls[i].item())
                        cls_name = ITD_CANONICAL_CLASSES.get(cls_idx, "car")

                        xyxy = boxes.xyxy[i].cpu().numpy()
                        # Map back to original coordinate space
                        bottom_center = (
                            ((xyxy[0] + xyxy[2]) / 2.0) * scale_x,
                            xyxy[3] * scale_y
                        )

                        if track_id in track_positions:
                            prev_pt = track_positions[track_id]
                            crossing_dir = counter.check_crossing(track_id, prev_pt, bottom_center)
                            if crossing_dir == "approaching":
                                current_bin_crossings += 1
                                current_bin_classes[cls_name] = current_bin_classes.get(cls_name, 0) + 1

                            dx = bottom_center[0] - prev_pt[0]
                            dy = bottom_center[1] - prev_pt[1]
                            dist_px = math.hypot(dx, dy)
                            if track_id not in track_motion:
                                track_motion[track_id] = []
                            track_motion[track_id].append(dist_px)
                            if len(track_motion[track_id]) > 8:
                                track_motion[track_id].pop(0)

                        track_positions[track_id] = bottom_center

                        if queue_pts is not None:
                            in_roi = cv2.pointPolygonTest(queue_pts, bottom_center, False) >= 0
                            if in_roi:
                                recent = track_motion.get(track_id, [0.0])
                                avg_speed = sum(recent) / max(1, len(recent))
                                if avg_speed < 8.0:
                                    active_queued += 1

                queue_samples.append(active_queued)

            if source_time_s >= current_bin_start + self.bin_duration_s:
                window_end = current_bin_start + self.bin_duration_s
                avg_q = int(round(sum(queue_samples) / max(1, len(queue_samples)))) if queue_samples else 0
                flow_vpm = (current_bin_crossings * 60.0) / self.bin_duration_s

                obs = CameraObservationRecord(
                    observation_id=f"{self.camera_id}-win-{int(current_bin_start):04d}",
                    camera_id=self.camera_id,
                    clip_id=clip_id,
                    session_id=self.session_id,
                    direction_id=self.geometry.get("primary_direction", "approaching"),
                    window_start_s=round(current_bin_start, 2),
                    window_end_s=round(window_end, 2),
                    available_at_source_s=round(window_end, 2),
                    crossings_veh=current_bin_crossings,
                    counts_by_class=dict(current_bin_classes),
                    flow_vpm=round(flow_vpm, 2),
                    queue_visible_veh_estimate=avg_q,
                    queue_status="estimated_visible_region" if queue_pts is not None else "unavailable",
                    speed_kph=None,
                    speed_status="uncalibrated",
                    observation_status="valid",
                    validation_level="agent_reviewed",
                    media_source="recorded_video",
                    processing_mode="online_inference",
                    geometry_hash=self.geometry_hash,
                    model_hash=self.model_hash
                )
                yield obs

                current_bin_start = window_end
                current_bin_crossings = 0
                current_bin_classes = {v: 0 for v in ITD_CANONICAL_CLASSES.values()}
                queue_samples = []

            frame_idx += 1

        cap.release()

        residual = (frame_idx / fps) - current_bin_start
        if residual >= 1.0:
            window_end = current_bin_start + residual
            avg_q = int(round(sum(queue_samples) / max(1, len(queue_samples)))) if queue_samples else 0
            flow_vpm = (current_bin_crossings * 60.0) / residual
            obs = CameraObservationRecord(
                observation_id=f"{self.camera_id}-win-{int(current_bin_start):04d}",
                camera_id=self.camera_id,
                clip_id=clip_id,
                session_id=self.session_id,
                direction_id=self.geometry.get("primary_direction", "approaching"),
                window_start_s=round(current_bin_start, 2),
                window_end_s=round(window_end, 2),
                available_at_source_s=round(window_end, 2),
                crossings_veh=current_bin_crossings,
                counts_by_class=dict(current_bin_classes),
                flow_vpm=round(flow_vpm, 2),
                queue_visible_veh_estimate=avg_q,
                queue_status="estimated_visible_region" if queue_pts is not None else "unavailable",
                speed_kph=None,
                speed_status="uncalibrated",
                observation_status="valid",
                validation_level="agent_reviewed",
                media_source="recorded_video",
                processing_mode="online_inference",
                geometry_hash=self.geometry_hash,
                model_hash=self.model_hash
            )
            yield obs


def run_camera_to_jsonl(
    camera_id: str,
    video_path: str,
    output_dir: str = ".runtime/vision/observations",
    max_duration_s: Optional[float] = 30.0,
    camera_config_path: str = "packages/camera-config/cameras.json",
    target_fps: float = 2.0
) -> Tuple[str, List[CameraObservationRecord]]:
    os.makedirs(output_dir, exist_ok=True)
    geom = {}
    if os.path.exists(camera_config_path):
        with open(camera_config_path) as f:
            cfg = json.load(f)
            geom = cfg.get("cameras", {}).get(camera_id, {}).get("geometry", {})

    session = ITDVideoAnalyticsSession(
        camera_id=camera_id,
        video_path=video_path,
        geometry=geom,
        device="cpu",
        target_fps=target_fps
    )

    out_file = os.path.join(output_dir, f"{camera_id}_observations.jsonl")
    records = []
    with open(out_file, "w") as f:
        for obs in session.process_stream(max_duration_s=max_duration_s):
            records.append(obs)
            f.write(json.dumps(asdict(obs)) + "\n")

    return out_file, records
