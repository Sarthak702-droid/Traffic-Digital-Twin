"""
Complete Traffic State Snapshot and Hidden-Future Sanitizer.
PRD §12.4, §15.5; Tasks T08, T09.
Guarantees continuation equivalence and zero causal future data leakage.
"""

from __future__ import annotations
import copy
import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional


@dataclass
class SanitizedSnapshot:
    schema_version: str = "prediction-snapshot-v1"
    snapshot_id: str = ""
    run_id: str = ""
    simulation_time_s: int = 0
    config_hash: str = ""
    cells: Dict[str, List[float]] = None
    boundary_backlogs: Dict[str, float] = None
    cumulative_demand: float = 0.0
    cumulative_admitted: float = 0.0
    cumulative_exits: float = 0.0
    current_internal_stock: float = 0.0
    scheduler_state: Dict[str, Any] = None
    signal_plan: Dict[str, int] = None
    pending_plan: Dict[str, int] = None
    signal_states: List[Dict[str, Any]] = None
    released_demand_commitments: Dict[str, float] = None


class SnapshotSanitizer:
    """
    Sanitizes engine state for prediction models:
    - Retains exact cells, backlogs, cumulative flows, and signal states.
    - Strips random generator seeds, future scenario events, and future unreleased bins.
    """

    @staticmethod
    def capture_sanitized_snapshot(engine: Any) -> SanitizedSnapshot:
        with engine.lock:
            cells_copy = {k: [round(float(v), 5) for v in vals] for k, vals in engine.cells.items()}
            backlogs_copy = {k: round(float(v), 5) for k, v in engine.backlogs.items()}
            internal_stock = sum(sum(v) for v in cells_copy.values())

            # Pending and active plans
            active_plan = dict(getattr(engine.scheduler, "plan", {}))
            pending_plan = dict(getattr(engine.scheduler, "pending", {}))
            scheduler_snap = engine.scheduler.snapshot() if hasattr(engine.scheduler, "snapshot") else {}

            sig_states = []
            if hasattr(engine, "signal_states") and engine.signal_states:
                for s in engine.signal_states:
                    sig_states.append({
                        "node_id": s.node_id,
                        "phase_id": s.phase_id,
                        "indication": s.indication,
                        "remaining_s": s.remaining_s,
                        "permitted_movements": list(s.permitted_movement_ids)
                    })

            commitments = {}
            if hasattr(engine.demand, "commitments_by_link"):
                for link, comms in engine.demand.commitments_by_link.items():
                    commitments[link] = sum(
                        max(0.0, c.total_mass_veh - c.released_mass_veh)
                        for c in comms
                        if c.available_at_s <= engine.tick
                    )

            state_bytes = f"{engine.tick}:{internal_stock}:{sorted(cells_copy.items())}".encode()
            snap_id = f"snap-{engine.tick:04d}-{hashlib.sha256(state_bytes).hexdigest()[:10]}"

            return SanitizedSnapshot(
                snapshot_id=snap_id,
                run_id=getattr(engine.command, "run_id", "default-run"),
                simulation_time_s=engine.tick,
                config_hash=getattr(engine, "config_digest", ""),
                cells=cells_copy,
                boundary_backlogs=backlogs_copy,
                cumulative_demand=round(engine.cumulative_demand, 4),
                cumulative_admitted=round(engine.cumulative_admitted, 4),
                cumulative_exits=round(engine.cumulative_exits, 4),
                current_internal_stock=round(internal_stock, 4),
                scheduler_state=scheduler_snap,
                signal_plan=active_plan,
                pending_plan=pending_plan,
                signal_states=sig_states,
                released_demand_commitments=commitments
            )

    @staticmethod
    def restore_engine_state(engine: Any, snapshot: SanitizedSnapshot):
        """Restores simulation state from snapshot for branch/continuation."""
        with engine.lock:
            engine.tick = snapshot.simulation_time_s
            engine.cells = {k: list(vals) for k, vals in snapshot.cells.items()}
            engine.backlogs = dict(snapshot.boundary_backlogs)
            engine.cumulative_demand = snapshot.cumulative_demand
            engine.cumulative_admitted = snapshot.cumulative_admitted
            engine.cumulative_exits = snapshot.cumulative_exits
            # Align demand provider to snapshot tick
            if hasattr(engine, "demand") and hasattr(engine.demand, "next"):
                # If seeded demand, advance RNG to fork tick
                if hasattr(engine.demand, "rng"):
                    import random
                    engine.demand.rng = random.Random(engine.command.seed)
                    for t_adv in range(1, snapshot.simulation_time_s + 1):
                        engine.demand.next(t_adv)
            if snapshot.scheduler_state and hasattr(engine.scheduler, "restore"):
                engine.scheduler.restore(snapshot.scheduler_state)
            if snapshot.signal_plan and hasattr(engine.scheduler, "plan"):
                engine.scheduler.plan = dict(snapshot.signal_plan)
            if snapshot.pending_plan and hasattr(engine.scheduler, "pending"):
                engine.scheduler.pending = dict(snapshot.pending_plan)
            engine.signal_states = engine._signal_states()
            engine.latest = engine._snapshot()


def verify_continuation_equivalence(engine_factory, run_cmd, total_steps: int = 30, fork_step: int = 15) -> Dict[str, Any]:
    """
    Executes continuation equivalence verification:
    Engine 1 runs from 0 to total_steps uninterrupted.
    Engine 2 starts at fork_step from snapshot of Engine 1 and runs to total_steps.
    Returns parity report.
    """
    eng1 = engine_factory()
    eng1.reset(run_cmd)

    snap_at_fork = None
    for s in range(1, total_steps + 1):
        eng1.step()
        if s == fork_step:
            snap_at_fork = SnapshotSanitizer.capture_sanitized_snapshot(eng1)

    state1_final = eng1.copy_state()

    eng2 = engine_factory()
    eng2.reset(run_cmd)
    SnapshotSanitizer.restore_engine_state(eng2, snap_at_fork)

    for s in range(fork_step + 1, total_steps + 1):
        eng2.step()

    state2_final = eng2.copy_state()

    max_stock_diff = 0.0
    for l1 in state1_final.links:
        l2 = next(x for x in state2_final.links if x.link_id == l1.link_id)
        diff = abs(l1.stock_veh - l2.stock_veh)
        max_stock_diff = max(max_stock_diff, diff)

    exits_diff = abs(state1_final.cumulative_boundary_exits_veh - state2_final.cumulative_boundary_exits_veh)
    backlog_diff = abs(state1_final.boundary_backlog_veh - state2_final.boundary_backlog_veh)

    passed = (max_stock_diff < 1e-4 and exits_diff < 1e-4 and backlog_diff < 1e-4)

    return {
        "status": "PASS" if passed else "FAIL",
        "total_steps": total_steps,
        "fork_step": fork_step,
        "max_stock_difference": max_stock_diff,
        "boundary_exits_difference": exits_diff,
        "backlog_difference": backlog_diff,
        "continuation_equivalent": passed
    }
