"""
Tests for Causal Forecasting Hierarchy.
PRD §15; Tasks T08, T11.
"""

import pytest
from services.intelligence.forecast_demand import CausalForecaster, HORIZONS_S


def test_persistence_baseline_and_ewma_warmup():
    fc = CausalForecaster(alpha=0.3, warmup_bins=6)

    # 3 initial bins (warming up)
    fc.update("C2-C1", 60.0)
    fc.update("C2-C1", 90.0)
    fc.update("C2-C1", 120.0)

    out = fc.forecast_link("C2-C1")
    assert out.warmup_status == "warming_up"
    assert out.active_method == "persistence"
    # Persistence projects the latest observation (120.0) across all horizons
    for h in HORIZONS_S:
        assert out.active_forecast[h] == 120.0

    # Add 3 more bins -> reach 6 bins (warmed up)
    fc.update("C2-C1", 150.0)
    fc.update("C2-C1", 120.0)
    fc.update("C2-C1", 90.0)

    out2 = fc.forecast_link("C2-C1")
    assert out2.warmup_status == "warmed_up"
    assert out2.active_method == "ewma"
    # EWMA is smoothed value, distinct from single point
    assert out2.active_forecast[30] > 0.0


def test_damped_holt_challenger_is_bounded():
    fc = CausalForecaster(alpha=0.3, warmup_bins=3, holt_phi=0.9, holt_beta=0.1)
    for val in [50.0, 70.0, 90.0, 110.0]:
        fc.update("C4-C1", val)

    out = fc.forecast_link("C4-C1")
    assert out.challenger_damped_holt[30] > 0.0
    # Damping guarantees 300s horizon does not explode infinitely
    h300 = out.challenger_damped_holt[300]
    h120 = out.challenger_damped_holt[120]
    assert abs(h300 - h120) < 50.0, "Damped Holt forecast must converge, not explode"
