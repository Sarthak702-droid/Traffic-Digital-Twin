from scripts.evaluate_synthetic_forecasts import score_trace


def test_synthetic_forecasts_use_bounded_past_and_do_not_loop_missing_targets():
    counts=[20,18,22,19,20,21,23,20,21,19,20,22]
    original=score_trace(counts,5,30,[30,60],6)
    changed=score_trace(counts[:6]+[100]*6,5,30,[30,60],6)
    assert original[30]['first_origin_prediction_veh']==changed[30]['first_origin_prediction_veh']
    assert original[30]['active_mae_veh']!=changed[30]['active_mae_veh']
    assert original[30]['eligible_origins']==1
    assert original[60]['eligible_origins']==0
    assert original[60]['status']=='unavailable'
    assert original[30]['local_only_mae_veh']==original[30]['active_mae_veh']
