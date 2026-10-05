from datetime import datetime, timezone
import math

import pytest
import twin_pb2 as pb

from services.intelligence.forecast_demand import boundary_forecast_rates
from services.intelligence.model import Model
from services.shared.network_config import config_hash
from services.simulation.safety import default_plan


def video_state(model, counts, session="source-one", run="run-one"):
    state = pb.TrafficState(schema_version="1.1", run_id=run, source="synthetic",
                            timestamp=datetime.now(timezone.utc).isoformat(), simulation_time_s=len(counts)*5,
                            scenario_type="peak_surge", seed=11, demand_source="video_profile",
                            input_session_id="epoch-one", input_quality="cached_valid", config_hash=config_hash(model.config))
    for node, phases in model.index.phases_by_node.items():
        state.signals.add(node_id=node,phase_id=phases[0]['id'],indication='green',remaining_s=30)
    cell_length=model.config['flow_model']['cell_length_m']
    for link in model.links:
        state.cells.add(link_id=link,stock_veh=[0.0]*max(1,math.ceil(model.links[link]['length_m']/cell_length)))
    for mid in model.moves:
        state.movements.add(movement_id=mid, current_phase_id=model.serving[mid])
    for link in model.index.boundary_inputs:
        state.boundary_demand.add(link_id=link, offered_rate_vpm=600)
        for i, count in enumerate(counts):
            state.observation_history.add(observation_id=f"{session}:{link}:{i}", camera_id=f"camera-{link}",
                boundary_link_id=link, window_start_s=i*5, window_end_s=(i+1)*5,
                available_at_source_s=(i+1)*5, processed_at_utc=state.timestamp,
                crossings_veh=count, observation_status="valid",
                source_identity=pb.SourceIdentity(clip_sha256="a"*64, geometry_sha256="b"*64,
                    detector_version="itd-v1.2", tracker_version="bytetrack-v1",
                    observation_schema_version="camera-observation-v1", source_session_id=session,
                    config_hash=state.config_hash, processing_mode="online_inference"))
    state.latest_finalized_window_end_source_s=len(counts)*5
    return state


def test_zero_finalized_windows_override_current_offered_rate_in_rollout():
    model = Model()
    state = video_state(model, [0]*6)
    rates, methods = boundary_forecast_rates(state, model.index)
    assert set(rates) == set(model.index.boundary_inputs)
    assert all(rate == 0 for rate in rates.values())
    assert all(method == "ewma" for method in methods.values())
    outcome = model.rollout(state, default_plan(model.config), horizon=30)
    assert outcome["throughput"] == 0
    assert outcome["backlog"] == 0


def test_analysis_forecast_uses_selected_finalized_history():
    model = Model()
    zero = model.analyze(video_state(model, [0] * 6))
    flowing = model.analyze(video_state(model, [5] * 6))
    arrivals = lambda result: sum(item.arrivals_veh for item in result.forecasts if item.horizon_s == 30)
    assert arrivals(zero) == 0
    assert arrivals(flowing) > 0


def test_missing_or_future_history_never_becomes_zero_demand():
    model = Model()
    state = video_state(model, [1])
    state.observation_history.pop()
    with pytest.raises(ValueError, match="missing"):
        boundary_forecast_rates(state, model.index)
    state = video_state(model, [1, 100])
    state.latest_finalized_window_end_source_s = 5
    rates, methods = boundary_forecast_rates(state, model.index)
    assert all(rate == 1/5 for rate in rates.values())
    assert all(method == "persistence" for method in methods.values())


def test_source_session_and_window_order_are_isolated():
    model = Model()
    state = video_state(model, [1, 2])
    state.observation_history[1].source_identity.source_session_id = "other-session"
    with pytest.raises(ValueError, match="source session"):
        boundary_forecast_rates(state, model.index)
    state = video_state(model, [1, 2])
    first = state.observation_history[0]
    first.window_start_s, first.window_end_s = 5, 10
    with pytest.raises(ValueError, match="order"):
        boundary_forecast_rates(state, model.index)
    new_run = video_state(model, [0]*6, run="run-two")
    rates, _ = boundary_forecast_rates(new_run, model.index)
    assert all(rate == 0 for rate in rates.values())


def test_finished_clip_history_becomes_stale_at_later_simulation_time():
    model = Model()
    state = video_state(model, [1, 2])
    state.simulation_time_s = 25
    with pytest.raises(ValueError, match="stale"):
        boundary_forecast_rates(state, model.index)
