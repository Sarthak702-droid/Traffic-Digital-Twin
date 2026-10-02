import importlib.util
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import pytest

spec = importlib.util.spec_from_file_location('display_telemetry', Path(__file__).resolve().parents[3] / 'scripts/generate_vision_clips_telemetry.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_portrait_resize_preserves_ratio():
    frame = np.zeros((1920, 1080, 3), dtype=np.uint8)
    resized = module.resize_for_inference(frame, 960)
    assert resized.shape[:2] == (960, 540)


def test_timestamped_full_clip_excludes_pedestrians_from_vehicles(tmp_path):
    import cv2
    clip = tmp_path / 'clip.avi'
    writer = cv2.VideoWriter(str(clip), cv2.VideoWriter_fourcc(*'MJPG'), 10, (40, 80))
    for _ in range(120):
        writer.write(np.zeros((80, 40, 3), dtype=np.uint8))
    writer.release()
    class Tensor:
        def __init__(self, values): self.values = np.array(values)
        def cpu(self): return self
        def numpy(self): return self.values
    class Model:
        names = module.ITD_CANONICAL_CLASSES
        resets = 0
        predictor = SimpleNamespace(trackers=[SimpleNamespace(reset=lambda: None)])
        def track(self, frame, **kwargs):
            assert frame.shape[0] == 80 and frame.shape[1] == 40
            boxes = SimpleNamespace(xyxy=Tensor([[10, 10, 20, 30], [20, 20, 30, 40]]),
                cls=Tensor([7, 2]), conf=Tensor([.8, .9]), id=Tensor([1, 2]))
            return [SimpleNamespace(boxes=boxes)]
    data = module.process_video(str(clip), {'camera_id': 'CAM-10', 'geometry': {'queue_roi': [[0,0],[1,0],[1,1],[0,1]]}}, Model(), sample_fps=5)
    assert data['duration_s'] == 12
    assert data['frames'][-1]['time_s'] > 10
    assert len(data['frames']) == 60
    assert data['frames'][0]['class_counts']['pedestrain'] == 1
    assert data['frames'][0]['active_count'] == data['frames'][0]['queue_count'] == 1
    assert data['summary']['total_unique_vehicles'] == data['summary']['total_unique_pedestrians'] == 1
    assert data['schema_version'] == 'display-detections-v2'
    assert len(data['source_identity']['clip_sha256']) == 64
    assert all(row['time_s'] < row['valid_until_s'] <= 12 for row in data['frames'])


def test_unknown_model_mapping_is_rejected():
    with pytest.raises(ValueError, match='class mapping'):
        module.validate_model_classes(SimpleNamespace(names={0: 'person'}))
