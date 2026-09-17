import pytest
import twin_pb2 as pb
from services.shared.validation import validate_state

def state():
    return pb.TrafficState(schema_version='1.0', run_id='test', timestamp='2026-09-16T00:00:00Z', source='synthetic', movements=[pb.MovementState(movement_id='C6-C3-C1', current_phase_id='C3-FROM-C6', queue_veh=12, occupancy_ratio=.2)])

def test_valid_state():
    assert validate_state(state()) == []

@pytest.mark.parametrize('field,value',[('queue_veh',-1),('occupancy_ratio',1.1),('waiting_age_s',float('nan')),('avg_speed_kph',float('inf'))])
def test_invalid_values(field,value):
    message=state();setattr(message.movements[0],field,value)
    assert validate_state(message)

def test_invalid_source_and_version():
    message=state();message.source='live';message.schema_version='2'
    assert validate_state(message)
