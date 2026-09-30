import gzip
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

from services.shared.network_config import config_hash, load_config
from services.simulation.aggregate_engine import AggregateEngine
from services.simulation.metrics import METRICS_VERSION


spec = importlib.util.spec_from_file_location("record_replay", Path(__file__).parents[1] / "record-replay.py")
record_replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(record_replay)


def recordings(tmp_path, monkeypatch, corrupt_last=False):
    monkeypatch.chdir(tmp_path)
    target = tmp_path / "packages/replay"
    target.mkdir(parents=True)
    for scenario, seed in record_replay.SCENARIOS:
        state = {
            "engine_kind": AggregateEngine.engine_kind,
            "model_version": AggregateEngine.model_version,
            "metrics_version": METRICS_VERSION,
            "config_hash": config_hash(load_config()),
            "scenario_type": scenario,
            "seed": seed,
        }
        with gzip.open(target / f"{scenario}.jsonl.gz", "wt") as stream:
            for tick in range(480):
                if corrupt_last and tick == 479:
                    state["config_hash"] = "old-config-hash"
                stream.write(json.dumps({"state": state}) + "\n")
    return target


def test_manifest_uses_recorded_simulator_version(tmp_path, monkeypatch):
    target = recordings(tmp_path, monkeypatch)
    record_replay.write_manifest()
    manifest = json.loads((target / "manifest.json").read_text())
    assert manifest["config_id"] == load_config()["id"]
    assert manifest["model_version"] == AggregateEngine.model_version
    for scenario, _ in record_replay.SCENARIOS:
        item = manifest["recordings"][scenario]
        assert item["model_version"] == AggregateEngine.model_version
        assert item["frames"] == 480
        assert item["sha256"] == hashlib.sha256((target / f"{scenario}.jsonl.gz").read_bytes()).hexdigest()


def test_manifest_cannot_relabel_old_config_frames(tmp_path, monkeypatch):
    target = recordings(tmp_path, monkeypatch, corrupt_last=True)
    with pytest.raises(RuntimeError, match="configuration"):
        record_replay.write_manifest()
    assert not (target / "manifest.json").exists()
