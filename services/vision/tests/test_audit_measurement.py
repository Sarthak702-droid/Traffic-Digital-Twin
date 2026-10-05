import pytest
from services.vision.measurement import normalized_motion

@pytest.mark.parametrize('scale,fps',[(1,1),(2,2),(.5,5),(4,10)])
def test_motion_is_invariant_to_resolution_and_sampling(scale,fps):
    duration=1/fps
    result=normalized_motion((100*scale,100*scale),((100+10*duration)*scale,(100+5*duration)*scale),1000*scale,500*scale,duration)
    assert result==pytest.approx(2**.5*.01)

def test_insufficient_motion_history_is_not_zero_speed():
    with pytest.raises(ValueError):normalized_motion((0,0),(0,0),100,100,0)
