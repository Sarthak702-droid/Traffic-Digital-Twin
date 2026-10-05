import pytest
from services.shared.privacy import reject_private_fields
@pytest.mark.parametrize('field',['track_id','bbox_history','trails','detections','clip_path','credentials','trackId','tracking-ID','accessToken'])
def test_nested_private_artifact_fields_rejected(field):
    with pytest.raises(ValueError,match='Private field'):reject_private_fields({'rows':[{'nested':{field:'private'}}]})
def test_valid_zero_aggregate_allowed():
    reject_private_fields({'rows':[{'crossings_veh':0,'queue_visible_veh_estimate':None}]})
