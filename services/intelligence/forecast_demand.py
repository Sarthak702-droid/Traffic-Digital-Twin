"""
Causal Boundary-Demand Forecasting Hierarchy.
PRD §15; Tasks T08, T11.
Implements Persistence, EWMA (alpha=0.3), and Damped Holt Trend models
over causal multi-horizon windows (+30s, +1m, +2m, +5m).
Zero future bin leakage.
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


FORECAST_VERSION = "recent-flow-v1"
HORIZONS_S = [30, 60, 120, 300]


def boundary_rates(state, index):
    links = {value.link_id: value for value in state.links}
    offered = {value.link_id: value for value in state.boundary_demand}
    rates = {}
    for edge in index.boundary_inputs:
        if edge in offered:
            rates[edge] = max(0.0, offered[edge].offered_rate_vpm / 60.0)
            continue
        observed = links.get(edge)
        if observed is not None:
            rates[edge] = max(0.0, observed.inflow_vpm / 60.0)
            continue
        movements = [m for m in state.movements if index.movements[m.movement_id]['incoming_link_id'] == edge]
        rates[edge] = max(0.0, sum(m.arrival_rate_vpm for m in movements) / 60.0)
    return rates


@dataclass
class ForecastHorizonResult:
    horizon_s: int
    predicted_rate_vpm: float
    method: str
    uncertainty_scenario: str = "nominal"


@dataclass
class BoundaryForecastOutput:
    link_id: str
    baseline_persistence: Dict[int, float]
    default_ewma: Dict[int, float]
    challenger_damped_holt: Dict[int, float]
    active_forecast: Dict[int, float]
    active_method: str
    warmup_status: str  # "warming_up" or "warmed_up"


class CausalForecaster:
    """
    Maintains causal historical observation bins per boundary link.
    Evaluates persistence, EWMA, and damped Holt without future peeking.
    """
    def __init__(self, alpha: float = 0.3, warmup_bins: int = 6, holt_phi: float = 0.9, holt_beta: float = 0.1):
        self.alpha = alpha
        self.warmup_bins = warmup_bins
        self.holt_phi = holt_phi
        self.holt_beta = holt_beta

        # History per link: list of observed flow_vpm values
        self.history: Dict[str, List[float]] = {}
        # EWMA state per link: smoothed value
        self.ewma_state: Dict[str, float] = {}
        # Damped Holt state per link: (level, trend)
        self.holt_state: Dict[str, Tuple[float, float]] = {}

    def update(self, link_id: str, flow_vpm: float):
        """Record an observed, finalized historical bin value."""
        if link_id not in self.history:
            self.history[link_id] = []
            self.ewma_state[link_id] = flow_vpm
            self.holt_state[link_id] = (flow_vpm, 0.0)

        hist = self.history[link_id]
        hist.append(flow_vpm)

        # Update EWMA
        prev_ewma = self.ewma_state[link_id]
        curr_ewma = self.alpha * flow_vpm + (1.0 - self.alpha) * prev_ewma
        self.ewma_state[link_id] = curr_ewma

        # Update Damped Holt
        prev_l, prev_b = self.holt_state[link_id]
        curr_l = self.alpha * flow_vpm + (1.0 - self.alpha) * (prev_l + self.holt_phi * prev_b)
        curr_b = self.holt_beta * (curr_l - prev_l) + (1.0 - self.holt_beta) * self.holt_phi * prev_b
        self.holt_state[link_id] = (curr_l, curr_b)

    def forecast_link(self, link_id: str) -> BoundaryForecastOutput:
        hist = self.history.get(link_id, [0.0])
        current_val = hist[-1] if hist else 0.0
        n_bins = len(hist)
        is_warmed = n_bins >= self.warmup_bins

        # Persistence: y_{t+h} = y_t
        pers = {h: max(0.0, round(current_val, 2)) for h in HORIZONS_S}

        # EWMA: flat projection of current smoothed level
        ewma_val = self.ewma_state.get(link_id, current_val)
        ewma_fc = {h: max(0.0, round(ewma_val, 2)) for h in HORIZONS_S}

        # Damped Holt: l_t + sum_{i=1}^{h_steps} phi^i * b_t
        l_t, b_t = self.holt_state.get(link_id, (current_val, 0.0))
        holt_fc = {}
        for h in HORIZONS_S:
            h_steps = max(1, int(round(h / 5.0)))  # in 5-second bin units
            decay_sum = sum(self.holt_phi ** i for i in range(1, h_steps + 1))
            val = l_t + decay_sum * b_t
            holt_fc[h] = max(0.0, round(val, 2))

        # Active policy: persistence during warm-up, EWMA default after warm-up
        active_method = "ewma" if is_warmed else "persistence"
        active_fc = ewma_fc if is_warmed else pers

        return BoundaryForecastOutput(
            link_id=link_id,
            baseline_persistence=pers,
            default_ewma=ewma_fc,
            challenger_damped_holt=holt_fc,
            active_forecast=active_fc,
            active_method=active_method,
            warmup_status="warmed_up" if is_warmed else "warming_up"
        )


def evaluate_forecast_candidates(
    engine_factory,
    base_snapshot: Any,
    candidate_timings: List[Dict[str, int]],
    horizon_s: int = 120
) -> List[Dict[str, Any]]:
    """
    Simulates a 120s candidate rollout from the base snapshot.
    Evaluates outcome metrics: total vehicles, mean speed, max queue, delay.
    """
    from services.simulation.snapshot_sanitizer import SnapshotSanitizer

    results = []
    import twin_pb2 as pb
    for cand_idx, cand_plan in enumerate(candidate_timings):
        eng = engine_factory()
        cmd = pb.RunCommand(
            schema_version="1.0",
            run_id=base_snapshot.run_id or "eval-run",
            mode="observe",
            seed=101,
            scenario_type="peak_surge"
        )
        eng.reset(cmd)
        SnapshotSanitizer.restore_engine_state(eng, base_snapshot)
        if hasattr(eng.scheduler, "pending"):
            eng.scheduler.pending = dict(cand_plan)

        # Roll out for horizon_s seconds
        total_queued = 0.0
        for _ in range(horizon_s):
            eng.step()
            total_queued += sum(float(l.queued_veh_estimate) for l in eng.latest.links)

        final_st = eng.copy_state()
        avg_queue = total_queued / float(horizon_s)
        results.append({
            "candidate_index": cand_idx,
            "plan": cand_plan,
            "horizon_s": horizon_s,
            "average_queue_veh": round(avg_queue, 2),
            "final_vehicles_in_network": final_st.vehicles_in_network,
            "cumulative_boundary_exits": final_st.cumulative_boundary_exits_veh,
            "boundary_backlog": final_st.boundary_backlog_veh
        })

    return results
