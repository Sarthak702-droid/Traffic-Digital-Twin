"""Public forecast provenance must reflect the eligible input, not defaults."""

from datetime import datetime, timedelta, timezone

from services.intelligence.model import Model
from services.intelligence.tests.test_bound_history_forecast import video_state


def test_finalized_history_exposes_method_origin_age_and_unavailable_uncertainty():
    model = Model()
    state = video_state(model, [0] * 6)
    completed = datetime(2026, 9, 26, 10, 0, tzinfo=timezone.utc)
    state.timestamp = (completed + timedelta(seconds=15)).isoformat()
    for row in state.observation_history:
        row.processed_at_utc = completed.isoformat()

    analysis = model.analyze(state)

    assert {(item.horizon_s, item.status) for item in analysis.horizon_availability} == {
        (30, "available"), (60, "available"), (120, "available"), (300, "available")
    }
    assert analysis.forecast_origin_source_s == 30
    assert analysis.input_quality == "cached_valid"
    assert all(item.method == "ewma" for item in analysis.forecasts)
    assert all(item.origin_source_s == 30 for item in analysis.forecasts)
    assert all(item.input_age_s == 15 for item in analysis.forecasts)
    assert all(item.horizon_status == "available" for item in analysis.forecasts)
    assert all(item.uncertainty_status == "unavailable" for item in analysis.forecasts)
    assert all(not item.HasField("uncertainty_lower_veh") and not item.HasField("uncertainty_upper_veh")
               for item in analysis.forecasts)


def test_missing_video_history_reports_all_horizons_without_numeric_forecasts():
    model = Model()
    state = video_state(model, [1])
    state.observation_history.clear()

    analysis = model.analyze(state)

    assert not analysis.forecasts
    assert not analysis.HasField("recommendation")
    assert analysis.outcome == "cannot_evaluate"
    assert {(item.horizon_s, item.status) for item in analysis.horizon_availability} == {
        (30, "missing_input"), (60, "missing_input"),
        (120, "missing_input"), (300, "missing_input")
    }


def test_short_valid_history_uses_persistence_and_excludes_future_completion():
    model = Model()
    state = video_state(model, [0, 9])
    state.latest_finalized_window_end_source_s = 5
    state.observation_history[1].processed_at_utc = (
        datetime.fromisoformat(state.timestamp) + timedelta(hours=1)
    ).isoformat()

    analysis = model.analyze(state)

    assert all(item.method == "persistence" for item in analysis.forecasts)
    assert all(item.origin_source_s == 5 for item in analysis.forecasts)
    assert all(item.arrivals_veh == 0 for item in analysis.forecasts)
    assert all(item.uncertainty_status == "unavailable" for item in analysis.forecasts)


def test_stale_video_history_marks_every_horizon_unavailable():
    model = Model()
    state = video_state(model, [1, 2])
    state.simulation_time_s = 25

    analysis = model.analyze(state)

    assert not analysis.forecasts
    assert analysis.outcome == "cannot_evaluate"
    assert {item.status for item in analysis.horizon_availability} == {"stale_input"}
    assert analysis.forecast_origin_source_s == state.latest_finalized_window_end_source_s
