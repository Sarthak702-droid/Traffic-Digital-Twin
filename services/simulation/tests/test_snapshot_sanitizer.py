"""
Tests for Snapshot Sanitizer and Continuation Equivalence.
PRD §12.4, §15.5; Tasks T08, T09.
"""

import pytest
import twin_pb2 as pb
from services.simulation.aggregate_engine import AggregateEngine
from services.simulation.snapshot_sanitizer import (
    SnapshotSanitizer,
    verify_continuation_equivalence
)


def test_snapshot_sanitizer_removes_future_leakage():
    engine = AggregateEngine()
    cmd = pb.RunCommand(
        schema_version="1.0",
        run_id="snap-test-run",
        mode="observe",
        seed=42,
        scenario_type="peak_surge"
    )
    engine.reset(cmd)
    for _ in range(5):
        engine.step()

    snap = SnapshotSanitizer.capture_sanitized_snapshot(engine)
    assert snap.snapshot_id.startswith("snap-")
    assert snap.simulation_time_s == 5
    assert len(snap.cells) > 0
    assert snap.current_internal_stock >= 0.0

    # Verify no hidden future scenario schedule or random generator object in snap
    snap_dict = snap.__dict__
    assert "rng" not in snap_dict
    assert "random" not in snap_dict
    assert "future_events" not in snap_dict


def test_continuation_equivalence_invariant():
    cmd = pb.RunCommand(
        schema_version="1.0",
        run_id="equiv-test-run",
        mode="observe",
        seed=101,
        scenario_type="peak_surge"
    )
    report = verify_continuation_equivalence(AggregateEngine, cmd, total_steps=20, fork_step=10)
    assert report["status"] == "PASS"
    assert report["continuation_equivalent"] is True
    assert report["max_stock_difference"] < 1e-4
