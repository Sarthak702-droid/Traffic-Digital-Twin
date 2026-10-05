"""Causal offered-demand averages must not amplify isolated arrivals."""
import pytest
import twin_pb2 as pb
from services.simulation.aggregate_engine import AggregateEngine
from services.intelligence.model import Model

class OneArrival:
    def __init__(self,link):self.link=link
    def next(self,tick):return {self.link:1.0 if tick==59 else 0.0}

def test_sparse_arrival_is_averaged_over_declared_past_only_window(tmp_path):
    engine=AggregateEngine(directory=tmp_path)
    try:
        engine.reset(pb.RunCommand(schema_version='1.0',run_id='sparse',scenario_type='peak_surge',seed=1101,mode='recommend'))
        link=engine.index.boundary_inputs[0];engine.demand=OneArrival(link)
        for _ in range(60):engine.step()
        row=next(x for x in engine.copy_state().boundary_demand if x.link_id==link)
        assert row.offered_rate_vpm==pytest.approx(1.0)
        assert row.offered_window_s==60
        assert engine.cumulative_demand==1
        assert Model(engine.config).analyze(engine.copy_state()).outcome=='no_action'
    finally:engine.close()

def test_warmup_window_does_not_include_unobserved_future_ticks(tmp_path):
    engine=AggregateEngine(directory=tmp_path)
    try:
        engine.reset(pb.RunCommand(schema_version='1.0',run_id='warmup',scenario_type='peak_surge',seed=1101,mode='recommend'))
        link=engine.index.boundary_inputs[0]
        class Demand:
            def next(self,tick):return {link:1.0 if tick==1 else 0.0}
        engine.demand=Demand()
        for _ in range(3):engine.step()
        row=next(x for x in engine.copy_state().boundary_demand if x.link_id==link)
        assert row.offered_window_s==3
        assert row.offered_rate_vpm==20
    finally:engine.close()
