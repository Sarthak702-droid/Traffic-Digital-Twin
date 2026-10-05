import hashlib
import json
from datetime import datetime, timezone

import pytest
import twin_pb2 as pb

from services.simulation.video_demand import VideoProfileDemandProvider
from services.simulation.aggregate_engine import AggregateEngine
from services.shared.network_config import config_hash, load_config


def processed_source(root, cache_key, session, counts, camera="CAM-01", boundary="C2-C1", config_digest=None):
    folder = root / camera / cache_key
    folder.mkdir(parents=True)
    clip = "a" * 64
    geometry = "b" * 64
    config = config_digest or config_hash(load_config())
    model = "d" * 64
    rows = []
    for i, count in enumerate(counts):
        rows.append({
            "schema_version": "camera-observation-v1", "observation_id": f"{session}:{i}",
            "camera_id": camera, "boundary_link_id": boundary,
            "window_start_s": i * 5, "window_end_s": (i + 1) * 5,
            "available_at_source_s": (i + 1) * 5,
            "processed_at_utc": datetime.now(timezone.utc).isoformat(),
            "crossings_veh": count, "observation_status": "valid",
            "source_identity": {
                "clip_sha256": clip, "geometry_sha256": geometry, "config_hash": config,
                "detector_version": "itd-v1.2", "tracker_version": "bytetrack-v1",
                "observation_schema_version": "camera-observation-v1",
                "source_session_id": session, "processing_mode": "online_inference",
            },
        })
    encoded = ("\n".join(json.dumps(row) for row in rows) + "\n").encode()
    (folder / "observations.jsonl").write_bytes(encoded)
    digest = hashlib.sha256(encoded).hexdigest()
    manifest = {
        "coverage": {"status":"complete","requested_frames":max(1,len(rows)*5),"decoded_frames":max(1,len(rows)*5),"source_fps":1,"decoded_until_source_s":max(1,len(rows)*5)},
        "status": "complete", "camera_id": camera, "source_session_id": session,
        "clip_sha256": clip, "geometry_sha256": geometry, "model_sha256": model,
        "config_hash": config, "observations_sha256": digest,
        "detector_version": "itd-v1.2", "tracker_version": "bytetrack-v1",
        "observation_schema_version": "camera-observation-v1", "window_count": len(rows),
    }
    (folder / "manifest.json").write_text(json.dumps(manifest))
    binding = pb.BoundSource(
        camera_id=camera, source_session_id=session, clip_sha256=clip,
        geometry_sha256=geometry, model_sha256=model, config_hash=config,
        observations_sha256=digest, detector_version="itd-v1.2",
        tracker_version="bytetrack-v1", observation_schema_version="camera-observation-v1",
    )
    return binding, folder


def test_bound_processed_source_ignores_other_session_and_releases_only_finalized_mass(tmp_path):
    selected, _ = processed_source(tmp_path, "selected", "source-one", [0, 5])
    processed_source(tmp_path, "other", "source-two", [100, 100])
    provider = VideoProfileDemandProvider(processed_dir=tmp_path, source_bindings=[selected], camera_boundary_links={"CAM-01":"C2-C1"})
    assert provider.next(4)["C2-C1"] == 0
    assert provider.next(5)["C2-C1"] == 0
    assert provider.next(9)["C2-C1"] == 0
    assert provider.next(10)["C2-C1"] == 1
    assert [row.crossings_veh for row in provider.finalized_history(5)] == [0]
    assert [row.crossings_veh for row in provider.finalized_history(10)] == [0, 5]


def test_bound_processed_source_rejects_changed_or_missing_identity(tmp_path):
    selected, folder = processed_source(tmp_path, "selected", "source-one", [1])
    selected.clip_sha256 = "f" * 64
    with pytest.raises(ValueError, match="identity"):
        VideoProfileDemandProvider(processed_dir=tmp_path, source_bindings=[selected], camera_boundary_links={"CAM-01":"C2-C1"})
    selected.clip_sha256 = "a" * 64
    (folder / "observations.jsonl").write_text("{}\n")
    with pytest.raises(ValueError, match="checksum"):
        VideoProfileDemandProvider(processed_dir=tmp_path, source_bindings=[selected], camera_boundary_links={"CAM-01":"C2-C1"})


def test_engine_state_releases_only_bound_finalized_history(tmp_path, monkeypatch):
    bindings = []
    for camera, boundary in load_config()["camera_boundary_links"].items():
        selected, _ = processed_source(tmp_path / "processed", camera, f"source-{camera}", [0, 5], camera, boundary)
        bindings.append(selected)
    monkeypatch.setenv("VIDEO_PROCESSED_DIR", str(tmp_path / "processed"))
    engine = AggregateEngine(directory=tmp_path / "engine")
    command = pb.RunCommand(schema_version="1.0", run_id="video-run", scenario_type="peak_surge", seed=11,
                            mode="recommend", demand_source="video_profile", input_session_id="epoch-1",
                            source_bindings=bindings)
    state = engine.reset(command)
    assert state.input_session_id == "epoch-1"
    assert len(state.observation_history) == 0
    for _ in range(5): state = engine.step()
    assert len(state.observation_history) == len(bindings)
    assert all(row.crossings_veh == 0 for row in state.observation_history)
    for _ in range(5): state = engine.step()
    assert len(state.observation_history) == 2 * len(bindings)
    assert state.latest_finalized_window_end_source_s == 10
    for _ in range(11): state = engine.step()
    assert state.input_quality == "stale"


def test_invalid_bound_reset_preserves_active_run(tmp_path, monkeypatch):
    bindings = []
    for camera, boundary in load_config()["camera_boundary_links"].items():
        selected, _ = processed_source(tmp_path / "processed", camera, f"source-{camera}", [1], camera, boundary)
        bindings.append(selected)
    monkeypatch.setenv("VIDEO_PROCESSED_DIR", str(tmp_path / "processed"))
    engine = AggregateEngine(directory=tmp_path / "engine")
    active = pb.RunCommand(schema_version="1.0", run_id="active", scenario_type="peak_surge", seed=11,
                           mode="recommend", demand_source="video_profile", input_session_id="epoch-one",
                           source_bindings=bindings)
    engine.reset(active)
    before = engine.step().SerializeToString()
    invalid = pb.RunCommand()
    invalid.CopyFrom(active)
    invalid.run_id = "invalid"
    invalid.source_bindings[0].clip_sha256 = "f" * 64
    with pytest.raises(ValueError, match="identity"):
        engine.reset(invalid)
    assert engine.copy_state().SerializeToString() == before
    assert engine.command.run_id == "active"


def test_engine_rejects_processed_source_from_other_network_config(tmp_path, monkeypatch):
    bindings = []
    for camera, boundary in load_config()["camera_boundary_links"].items():
        selected, _ = processed_source(tmp_path / "processed", camera, f"source-{camera}", [1], camera, boundary,
                                       config_digest="f" * 64)
        bindings.append(selected)
    monkeypatch.setenv("VIDEO_PROCESSED_DIR", str(tmp_path / "processed"))
    engine = AggregateEngine(directory=tmp_path / "engine")
    command = pb.RunCommand(schema_version="1.0", run_id="wrong-config", scenario_type="peak_surge", seed=11,
                            mode="recommend", demand_source="video_profile", input_session_id="epoch-one",
                            source_bindings=bindings)
    with pytest.raises(ValueError, match="configuration"):
        engine.reset(command)

def test_missing_decode_proof_is_not_an_authoritative_cache(tmp_path):
    binding,_=processed_source(tmp_path,'cache','source-1',[1])
    path=tmp_path/'CAM-01/cache/manifest.json'
    data=json.loads(path.read_text());data.pop('coverage');path.write_text(json.dumps(data))
    with pytest.raises(ValueError,match='decode coverage'):
        VideoProfileDemandProvider(processed_dir=tmp_path,source_bindings=[binding],camera_boundary_links={'CAM-01':'C2-C1'})
