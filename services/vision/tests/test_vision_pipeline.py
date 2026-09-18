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
    assert "demo" in result["speed_disclaimer"].lower()
    assert "estimate" in result["speed_disclaimer"].lower()
    assert "camera-local" in result["privacy_disclosure"].lower()
    assert "anpr" in result["privacy_disclosure"].lower()

    # Metrics summary
    metrics = result["summary_metrics"]
    assert metrics["total_vehicles_observed"] > 0
    assert metrics["total_crossed_line"] > 0
    assert "demo estimate" in metrics["speed_label"].lower()

    # 5 vehicle classes present in breakdown
    classes = metrics["class_breakdown"]
    for cls_name in ["bike", "car", "auto", "bus", "truck"]:
        assert cls_name in classes

    # Lane metrics
    lane_metrics = metrics["lane_metrics"]
    assert len(lane_metrics) == 3
    lane_ids = {lm["lane_id"] for lm in lane_metrics}
    assert lane_ids == {"lane_1_turn", "lane_2_thru", "lane_3_thru"}

    # Upstream C1 impact
    upstream = result["upstream_c1_impact"]
    assert "expected_30s" in upstream
    assert "expected_60s" in upstream
    assert "expected_120s" in upstream
    assert len(upstream["eta_range_s"]) == 2
    assert upstream["risk_level"] in ["low", "moderate", "high"]


def test_tracks_use_camera_local_ids_and_no_anpr(sample_video):
    pipeline = C3VisionPipeline(video_path=sample_video)
    result = pipeline.run_pipeline()

    for frame in result["frames"]:
        for trk in frame["tracks"]:
            assert trk["track_id"].startswith("CAM3-TK-")
            assert "plate" not in trk
            assert "license" not in trk
            assert "face" not in trk
            assert trk["lane"] in ["lane_1_turn", "lane_2_thru", "lane_3_thru"]
            assert isinstance(trk["speed_kph"], (int, float))
            assert isinstance(trk["is_queued"], bool)
            assert isinstance(trk["crossed"], bool)


def test_run_and_save_c3_pipeline(sample_video, tmp_path):
    out_json = tmp_path / "aggregates.json"
    result = run_and_save_c3_pipeline(video_path=str(sample_video), output_json=str(out_json))

    assert out_json.exists()
    with open(out_json) as f:
        loaded = json.load(f)
    assert loaded["junction_id"] == "C3"
    assert loaded["available"] is True
