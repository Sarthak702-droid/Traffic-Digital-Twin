"""Export finalized five-second bins from existing ITD frame telemetry.

This only fills cameras without a dedicated vision-worker JSONL. It never
invents detections or class-specific crossing counts.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TELEMETRY = ROOT / "apps/web/public/vision_clips_data.json"
OUTPUT = ROOT / ".runtime/vision/observations"


def build_windows(camera_id: str, clip: dict) -> list[dict]:
    frames = sorted(clip.get("frames", []), key=lambda frame: float(frame["time_s"]))
    if not frames:
        return []
    duration = float(clip.get("duration_s", 0))
    if duration <= 0:
        return []
    windows = []
    prior_crossed = 0
    start = 0.0
    while start + 5 <= duration + 1e-6:
        end = start + 5
        within = [frame for frame in frames if start <= float(frame["time_s"]) < end]
        if not within:
            break
        crossed = int(within[-1].get("cumulative_crossed", 0))
        if crossed < prior_crossed:
            raise ValueError(f"{camera_id}: crossing counter decreased")
        count = crossed - prior_crossed
        prior_crossed = crossed
        windows.append({
            "schema_version": "camera-observation-v1",
            "observation_id": f"{camera_id}-telemetry-{int(start):04d}",
            "camera_id": camera_id,
            "clip_id": Path(clip["video_file"]).stem,
            "direction_id": clip.get("geometry", {}).get("primary_direction", "unknown"),
            "window_start_s": start,
            "window_end_s": end,
            "available_at_source_s": end,
            "crossings_veh": count,
            "counts_by_class": None,
            "class_count_status": "unavailable_from_frame_telemetry",
            "flow_vpm": count * 12.0,
            "queue_visible_veh_estimate": max(int(frame.get("queue_count", 0)) for frame in within),
            "queue_status": "estimated_visible_region",
            "speed_kph": None,
            "speed_status": "uncalibrated",
            "observation_status": "valid",
            "validation_level": "agent_reviewed",
            "media_source": "recorded_video",
            "processing_mode": "cached_observations",
            "derivation": "itd_v1.2_cached_frame_telemetry",
        })
        start = end
    return windows


def main() -> None:
    telemetry = json.loads(TELEMETRY.read_text())
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for camera_id, clip in sorted(telemetry.items()):
        destination = OUTPUT / f"{camera_id}_observations.jsonl"
        if destination.exists():
            continue
        windows = build_windows(camera_id, clip)
        if not windows:
            raise ValueError(f"{camera_id}: no complete telemetry windows")
        destination.write_text("".join(json.dumps(row) + "\n" for row in windows))
        print(f"{camera_id}: {len(windows)} finalized windows from cached ITD telemetry")


if __name__ == "__main__":
    main()
