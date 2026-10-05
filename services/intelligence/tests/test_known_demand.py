"""Known-release parity with the recorded demand provider and model rollouts."""
import json
import pytest
import twin_pb2 as pb
from services.intelligence.known_demand import boundary_offers
from services.intelligence.model import Model
from services.simulation.safety import default_plan
from services.simulation.video_demand import VideoProfileDemandProvider


@pytest.mark.parametrize('mass',[0,10,15])
def test_partial_fractional_commitment_matches_provider_without_mutation(tmp_path,mass):
    (tmp_path/'CAM-test.jsonl').write_text(json.dumps({
        'observation_status':'valid','window_start_s':0,'window_end_s':5,
        'available_at_source_s':5.5,'crossings_veh':mass})+'\n')
    provider=VideoProfileDemandProvider(observations_dir=tmp_path,camera_boundary_links={'CAM-test':'boundary'})
    for tick in range(1,7):provider.next(tick)
    state=pb.TrafficState(simulation_time_s=6)
    state.demand_commitments.extend(provider.eligible_commitments(6))
    before=state.SerializeToString()
    expected=[provider.next(tick) for tick in range(7,10)]
    assert list(boundary_offers(state,{'boundary':.4},3))==expected
    assert state.SerializeToString()==before


def test_proposal_horizon_demand_matches_rollout_mass_and_forecast_after_known_end():
    from services.intelligence.tests.test_bound_history_forecast import video_state
    model=Model();state=video_state(model,[2]);state.simulation_time_s=6;state.snapshot_source_available_s=6
    for link in model.index.boundary_inputs:
        state.demand_commitments.add(boundary_link_id=link,release_start_simulation_s=5,
            release_end_simulation_s=10,remaining_mass_veh=7,rate_vps=3)
    before=state.SerializeToString();evaluation=model._evaluation_input(state)
    mass=sum(sum(row.values()) for row in boundary_offers(evaluation['state'],evaluation['rates'],4))
    result=model.rollout(state,default_plan(model.config),4,evaluation)
    assert mass==pytest.approx((7+.4)*len(model.index.boundary_inputs))
    assert result['offered_external_veh']==pytest.approx(mass)
    assert result['mass_residual_veh']==pytest.approx(0,abs=1e-8)
    assert state.SerializeToString()==before
