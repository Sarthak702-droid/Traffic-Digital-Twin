"""Recursive aggregate-artifact boundary; association state is transient."""
DENIED={'track_id','track_ids','tracking_id','detections','trail','trails','trajectory','trajectories','bbox','bbox_history','centroid','raw_frame','raw_frames','raw_video','password','credentials','compute_token','clip_path','model_path','session_token','access_token','api_key','password_hash','password_salt','token'}
def _normalized(key):return ''.join(c for c in key.lower() if c.isalnum())
NORMALIZED_DENIED={_normalized(key) for key in DENIED}
def reject_private_fields(value):
    if isinstance(value,dict):
        for key,child in value.items():
            if _normalized(key) in NORMALIZED_DENIED:raise ValueError('Private field prohibited in aggregate artifact: '+key)
            reject_private_fields(child)
    elif isinstance(value,(list,tuple)):
        for child in value:reject_private_fields(child)
