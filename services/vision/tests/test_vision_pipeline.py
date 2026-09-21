"""
Test suite for OpenCV C3 Vision Analytics Pipeline.
Backlog S36, S37; PRD §8.5, §15.2.
"""

import json
from pathlib import Path
import pytest
from services.vision.pipeline import C3VisionPipeline, run_and_save_c3_pipeline
from services.vision.sample_generator import generate_c3_sample_video


@pytest.fixture(scope="module")
def sample_video(tmp_path_factory):
    fn = tmp_path_factory.mktemp("vision") / "test_c3.mp4"
    generate_c3_sample_video(fn, num_frames=120, fps=10.0)
    return fn


def test_missing_video_returns_honest_unavailable_state(tmp_path):
    missing_path = tmp_path / "non_existent_feed.mp4"
    pipeline = C3VisionPipeline(video_path=missing_path)
    result = pipeline.run_pipeline()

    assert result["available"] is False
    assert result["status"] == "unavailable"
    assert "not found" in result["error"].lower()
    assert "independent" in result["message"]


def test_vision_pipeline_processes_sample_feed(sample_video):
    pipeline = C3VisionPipeline(video_path=sample_video)
    result = pipeline.run_pipeline()

    assert result["available"] is True
    assert result["status"] == "active"
    assert result["junction_id"] == "C3"
    assert result["target_junction_id"] == "C1"
    assert result["total_frames"] == 120
    assert result["fps"] == 10.0

    # Privacy and disclaimer guarantees
    assert result["is_calibrated"] is False
    assert "no authoritative" in result["speed_disclaimer"].lower()
    assert "aggregate" in result["privacy_disclosure"].lower()
    assert "anpr" in result["privacy_disclosure"].lower()

    # Metrics summary
    metrics = result["summary_metrics"]
    assert metrics["total_vehicles_observed"] > 0
    assert metrics["total_crossed_line"] > 0
    assert metrics["speed_status"] == "unavailable"

    # 5 vehicle classes present in breakdown
    classes = metrics["class_breakdown"]
    for cls_name in ["bike", "car", "auto", "bus", "truck"]:
        assert cls_name in classes

    # Lane metrics
    lane_metrics = metrics["lane_metrics"]
    assert len(lane_metrics) == 3
    lane_ids = {lm["lane_id"] for lm in lane_metrics}
    assert lane_ids == {"lane_1_turn", "lane_2_thru", "lane_3_thru"}

    # Sample video does not fabricate whole-corridor forecasts.
    upstream = result["upstream_c1_impact"]
    assert upstream["status"] == "unavailable"


def test_public_vision_payload_has_no_tracks_or_fabricated_metric_speed(sample_video):
    pipeline = C3VisionPipeline(video_path=sample_video)
    result = pipeline.run_pipeline()

    for frame in result["frames"]:
        assert "tracks" not in frame
        assert "average_speed_kph" not in frame
        assert frame["speed_status"] == "unavailable"


def test_run_and_save_c3_pipeline(sample_video, tmp_path):
    out_json = tmp_path / "aggregates.json"
    result = run_and_save_c3_pipeline(video_path=str(sample_video), output_json=str(out_json))

    assert out_json.exists()
    with open(out_json) as f:
        loaded = json.load(f)
    assert loaded["junction_id"] == "C3"
    assert loaded["available"] is True
