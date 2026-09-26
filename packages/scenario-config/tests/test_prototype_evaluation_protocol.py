"""Guard the frozen E01 split and engineering evaluation criteria."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PROTOCOL = ROOT / "packages/scenario-config/prototype-evaluation-v1.json"


def test_e01_protocol_freezes_reserved_inputs_before_execution():
    protocol = json.loads(PROTOCOL.read_text())
    assert protocol["version"] == "prototype-evaluation-v1"
    assert protocol["reference_windows"]["tuning"] == ["candidate-ordinary-01", "candidate-crowded-01"]
    assert protocol["reference_windows"]["reserved"] == ["candidate-difficult-01"]
    assert set(protocol["synthetic"]["held_out_seeds"]).isdisjoint(protocol["synthetic"]["tuning_seeds"])
    assert protocol["forecast"]["horizons_s"] == [30, 60, 120, 300]
    for graph in protocol["synthetic"]["graphs"]:
        assert (ROOT / "packages/scenario-config" / graph).is_file()
    assert protocol["control"]["comparison_window_s"] == 120
    assert protocol["resource"]["state_to_recommendation_p95_s"] == 5.0
    manifest = json.loads((ROOT / protocol["reference_manifest"]).read_text())
    split = {name: {window["id"] for window in manifest["windows"] if window["evaluation_split"] == name} for name in ("tuning", "reserved")}
    assert all(set(protocol["reference_windows"][name]) == split[name] for name in split)
    scoring = json.loads((ROOT / "packages/scenario-config/comparison-scoring-v1.json").read_text())
    assert protocol["control"]["comparison_window_s"] == scoring["window_s"]
    assert protocol["resource"]["candidate_evaluation_deadline_s"] == scoring["analysis_timeout_s"]
