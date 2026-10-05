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
    assert data['frames'][0]['active_count'] == 1
    assert data['frames'][0]['queue_count'] is None
    assert data['frames'][0]['queue_status'] == 'unavailable'
    assert data['frames'][1]['queue_count'] == 1
    assert all('detections' not in row for row in data['frames'])
    assert data['summary']['total_unique_vehicles'] == data['summary']['total_unique_pedestrians'] == 1
    assert data['schema_version'] == 'display-aggregates-v3'
    assert len(data['source_identity']['clip_sha256']) == 64
    assert all(row['time_s'] < row['valid_until_s'] <= 12 for row in data['frames'])


def test_unknown_model_mapping_is_rejected():
    with pytest.raises(ValueError, match='class mapping'):
        module.validate_model_classes(SimpleNamespace(names={0: 'person'}))

def test_annotation_pixels_restore_boxes_without_exporting_identity_history(tmp_path):
    import cv2
    clip=tmp_path/'source.avi';writer=cv2.VideoWriter(str(clip),cv2.VideoWriter_fourcc(*'MJPG'),10,(80,80))
    for _ in range(10):writer.write(np.zeros((80,80,3),dtype=np.uint8))
    writer.release()
    class Tensor:
        def __init__(self,v):self.v=np.array(v)
        def cpu(self):return self
        def numpy(self):return self.v
    class Detector:
        names=module.ITD_CANONICAL_CLASSES
        def track(self,*args,**kwargs):return [SimpleNamespace(boxes=SimpleNamespace(xyxy=Tensor([[10,20,40,60]]),cls=Tensor([2]),conf=Tensor([.9]),id=Tensor([12345])))]
    output=tmp_path/'annotation.mp4'
    data=module.process_video(clip,{'camera_id':'CAM-01','geometry':{}},Detector(),sample_fps=2,annotation_path=output)
    assert output.is_file()
    cap=cv2.VideoCapture(str(output));ok,frame=cap.read();cap.release()
    assert ok and np.max(frame[19:23,10:41])>50
    assert all('detections' not in row for row in data['frames'])
    from services.shared.privacy import reject_private_fields
    reject_private_fields(data)


def test_truncated_decode_aborts_preview_and_preserves_existing_file(tmp_path, monkeypatch):
    import cv2
    output=tmp_path/'annotation.mp4';output.write_bytes(b'previous complete preview')
    class Capture:
        reads=0
        def isOpened(self):return True
        def grab(self):
            self.reads+=1
            return self.reads<=2
        def get(self,key):return {cv2.CAP_PROP_FPS:10,cv2.CAP_PROP_FRAME_COUNT:10,cv2.CAP_PROP_FRAME_WIDTH:80,cv2.CAP_PROP_FRAME_HEIGHT:80}.get(key,0)
        def read(self):
            self.reads+=1
            return (True,np.zeros((80,80,3),dtype=np.uint8)) if self.reads<=2 else (False,None)
        def release(self):pass
    class Encoder:
        aborted=False
        def __init__(self,*args):pass
        def write(self,*args):pass
        def abort(self):Encoder.aborted=True
        def finish(self):pytest.fail('incomplete preview published')
    monkeypatch.setattr(module.cv2,'VideoCapture',lambda *args:Capture())
    monkeypatch.setattr(module,'AnnotationEncoder',Encoder)
    model=SimpleNamespace(names=module.ITD_CANONICAL_CLASSES,track=lambda *args,**kwargs:[SimpleNamespace(boxes=None)])
    with pytest.raises(ValueError,match='Incomplete decode'):
        module.process_video(tmp_path/'source.mp4',{'camera_id':'CAM-01','geometry':{}},model,annotation_path=output)
    assert Encoder.aborted
    assert output.read_bytes()==b'previous complete preview'
