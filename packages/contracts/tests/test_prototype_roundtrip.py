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


def test_report_v2_rejects_private_fields_inside_chronological_observations():
    contracts = Path(__file__).resolve().parents[1]
    schema = json.loads((contracts / 'run-report-v2.schema.json').read_text())
    report = json.loads((contracts / 'fixtures/prototype-contract/run-report.json').read_text())
    report.update(schema_version='prototype-run-report-v2', scenario_type='peak_surge', seed=7,
                  demand_source='seeded', run_status='ended', analyses=[], observations=[],
                  clock_events=[], application_events=[])
    report['forecast']['origin_simulation_s'] = 15
    validate(report, schema)
    report['observations'] = [{'tracking_id': 'private-object-identity'}]
    with pytest.raises(ValidationError):
        validate(report, schema)


def test_openapi_contains_complete_scheduler_and_all_owned_routes():
    contracts = Path(__file__).resolve().parents[1]
    api = json.loads((contracts / 'openapi.json').read_text())
    scheduler = api['components']['schemas']['SchedulerSnapshot']['properties']
    assert set(scheduler) == {field.name for field in pb.SchedulerSnapshot.DESCRIPTOR.fields}
    ownership = json.loads((contracts / 'endpoint-ownership.json').read_text())
    owned = {(row['method'].lower(), row['path']) for row in ownership['endpoints']}
    described = {(method, path) for path, routes in api['paths'].items() for method in routes
                 if method in ('get', 'post', 'put', 'patch', 'delete', 'head')}
    assert owned == described


def test_openapi_report_uses_resolvable_strict_schema_components():
    contracts = Path(__file__).resolve().parents[1]
    api = json.loads((contracts / 'openapi.json').read_text())
    report = api['paths']['/api/v1/runs/{id}/report']['get']['responses']['200']['content']['application/json']['schema']
    assert report == {'$ref': '#/components/schemas/PrototypeRunReportV2'}
    observation = api['components']['schemas']['ReportV2_observation']
    assert observation['additionalProperties'] is False


def test_plan_dispatch_identity_preserves_explicit_seeded_epoch_and_zero_sequence():
    command = json_format.ParseDict({'run_id': 'r', 'command_id': 'c',
        'expected_input_session_id': '', 'expected_snapshot_sequence': '0',
        'activate_not_before_simulation_s': 45}, pb.PlanCommand())
    restored = pb.PlanCommand.FromString(command.SerializeToString())
    assert restored.HasField('expected_input_session_id')
    assert restored.HasField('expected_snapshot_sequence')
    assert restored.expected_snapshot_sequence == 0
    assert not pb.PlanCommand().HasField('expected_snapshot_sequence')


def test_offered_averaging_window_is_additive_and_bounded():
    schema=json.loads((Path(__file__).resolve().parents[1]/'events.schema.json').read_text())
    shape={'$defs':schema['$defs'],'$ref':'#/$defs/BoundaryDemandState'}
    legacy={'link_id':'boundary','backlog_veh':0,'offered_rate_vpm':1}
    validate(legacy,shape)
    message=json_format.ParseDict({**legacy,'offered_window_s':60},pb.BoundaryDemandState())
    restored=pb.BoundaryDemandState.FromString(message.SerializeToString())
    assert restored.offered_window_s==60
    assert pb.BoundaryDemandState.DESCRIPTOR.fields_by_name['offered_rate_vpm'].number==3
    assert pb.BoundaryDemandState.DESCRIPTOR.fields_by_name['offered_window_s'].number==4
    validate(json_format.MessageToDict(restored,preserving_proto_field_name=True,always_print_fields_with_no_presence=True),shape)
    with pytest.raises(ValidationError):validate({**legacy,'offered_window_s':61},shape)
