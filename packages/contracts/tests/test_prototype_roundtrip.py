"""Cross-language JSON and binary compatibility for the proposed prototype fields."""

import sys
import json
from pathlib import Path

import pytest
from google.protobuf import json_format
from jsonschema import ValidationError, validate

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "gen" / "python"))
import twin_pb2 as pb  # noqa: E402


def test_analysis_keeps_epoch_outcome_and_horizon_statuses():
    source = {
        "run_id": "run-7",
        "input_session_id": "epoch-7",
        "snapshot_sequence": "24",
        "outcome": "cannot_evaluate",
        "outcome_reason": "stale_input",
        "horizon_availability": [
            {"horizon_s": 30, "status": "stale_input", "reason": "source aged out"},
            {"horizon_s": 300, "status": "stale_input", "reason": "source aged out"},
        ],
    }
    message = json_format.ParseDict(source, pb.Analysis())
    restored = pb.Analysis.FromString(message.SerializeToString())
    result = json_format.MessageToDict(restored, preserving_proto_field_name=True)
    assert result["input_session_id"] == "epoch-7"
    assert result["outcome"] == "cannot_evaluate"
    assert result["horizon_availability"][1]["horizon_s"] == 300


def test_old_timing_change_fields_remain_compatible():
    message = json_format.ParseDict(
        {"node_id": "C1", "phase_id": "p1", "green_s": 25}, pb.TimingChange()
    )
    assert pb.TimingChange.FromString(message.SerializeToString()).green_s == 25


def test_run_command_selected_source_bindings_round_trip():
    source = {
        "schema_version": "1.0", "run_id": "run-7", "scenario_type": "peak_surge",
        "seed": 7, "mode": "recommend", "demand_source": "video_profile",
        "input_session_id": "epoch-7", "source_bindings": [{
            "camera_id": "CAM-01", "source_session_id": "camera-attempt-1",
            "clip_sha256": "a" * 64, "geometry_sha256": "b" * 64,
            "model_sha256": "d" * 64, "config_hash": "c" * 64,
            "observations_sha256": "e" * 64, "detector_version": "itd-v1.2",
            "tracker_version": "bytetrack-v1", "observation_schema_version": "camera-observation-v1",
        }],
    }
    command = json_format.ParseDict(source, pb.RunCommand())
    restored = pb.RunCommand.FromString(command.SerializeToString())
    assert restored.input_session_id == "epoch-7"
    assert restored.source_bindings[0].observations_sha256 == "e" * 64


def test_public_schema_accepts_old_network_and_new_analysis_examples():
    contracts = Path(__file__).resolve().parents[1]
    schema = json.loads((contracts / "events.schema.json").read_text())
    old_network = json.loads((contracts / "fixtures" / "network-state.json").read_text())
    analysis = json.loads(
        (contracts / "fixtures" / "prototype-contract" / "analysis.json").read_text()
    )
    validate(old_network, schema)
    validate(analysis, {"$defs": schema["$defs"], "$ref": "#/$defs/Analysis"})


def test_openapi_describes_new_analysis_fields():
    contracts = Path(__file__).resolve().parents[1]
    openapi = json.loads((contracts / "openapi.json").read_text())
    analysis = json.loads(
        (contracts / "fixtures" / "prototype-contract" / "analysis.json").read_text()
    )
    validate(analysis, {**openapi, "$ref": "#/components/schemas/Analysis"})


def test_public_schema_rejects_unknown_analysis_status():
    contracts = Path(__file__).resolve().parents[1]
    schema = json.loads((contracts / "events.schema.json").read_text())
    analysis = json.loads(
        (contracts / "fixtures" / "prototype-contract" / "analysis.json").read_text()
    )
    analysis["outcome"] = "made_up_success"
    with pytest.raises(ValidationError):
        validate(analysis, {"$defs": schema["$defs"], "$ref": "#/$defs/Analysis"})


def test_report_schema_accepts_missing_metrics_but_rejects_raw_media():
    contracts = Path(__file__).resolve().parents[1]
    schema = json.loads((contracts / "run-report.schema.json").read_text())
    report = json.loads(
        (contracts / "fixtures" / "prototype-contract" / "run-report.json").read_text()
    )
    validate(report, schema)
    exposed = {**report, "raw_video": "clip-bytes"}
    with pytest.raises(ValidationError):
        validate(exposed, schema)
    missing_reason = json.loads(json.dumps(report))
    missing_reason["resources"]["peak_ram_bytes"] = {"value": None}
    with pytest.raises(ValidationError):
        validate(missing_reason, schema)
