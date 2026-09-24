import importlib
import sys
from types import ModuleType, SimpleNamespace


def test_crossing_at_window_boundary_belongs_to_later_window(tmp_path, monkeypatch):
    class Frame:
        shape = (100, 100, 3)
    class Capture:
        def __init__(self, *_): self.index = 0
        def isOpened(self): return True
        def get(self, prop): return {1: 1, 2: 100, 3: 100, 4: 6}[prop]
        def read(self):
            if self.index == 6: return False, None
            self.index += 1
            return True, Frame()
        def release(self): pass
    cv2 = ModuleType('cv2')
    cv2.VideoCapture = Capture
    cv2.CAP_PROP_FPS, cv2.CAP_PROP_FRAME_WIDTH = 1, 2
    cv2.CAP_PROP_FRAME_HEIGHT, cv2.CAP_PROP_FRAME_COUNT = 3, 4
    cv2.resize = lambda frame, size: frame
    monkeypatch.setitem(sys.modules, 'cv2', cv2)
    monkeypatch.setitem(sys.modules, 'numpy', ModuleType('numpy'))
    torch = ModuleType('torch')
    torch.set_num_threads = lambda count: None
    monkeypatch.setitem(sys.modules, 'torch', torch)
    ultralytics = ModuleType('ultralytics')
    class Scalar:
        def __init__(self, value): self.value = value
        def item(self): return self.value
    class Array:
        def __init__(self, values): self.values = values
        def cpu(self): return self
        def numpy(self): return self.values
    class Boxes:
        def __init__(self, index):
            self.id = [Scalar(1)] if index >= 4 else None
            self.cls = [Scalar(2)] if index >= 4 else []
            self.xyxy = [Array([256, 192, 384, 320 if index == 4 else 384])] if index >= 4 else []
        def __len__(self): return len(self.xyxy)
    class YOLO:
        def __init__(self, *_): self.index = 0
        def track(self, *_args, **_kwargs):
            boxes = Boxes(self.index)
            self.index += 1
            return [SimpleNamespace(boxes=boxes)]
    ultralytics.YOLO = YOLO
    monkeypatch.setitem(sys.modules, 'ultralytics', ultralytics)
    sys.modules.pop('services.vision.itd_pipeline', None)
    module = importlib.import_module('services.vision.itd_pipeline')
    video = tmp_path / 'clip.mp4'
    model = tmp_path / 'model.pt'
    video.write_bytes(b'video')
    model.write_bytes(b'model')
    session = module.ITDVideoAnalyticsSession('CAM-01', str(video), str(model),
        geometry={'counting_line': {'p1': [0.15, .55], 'p2': [.85, .55]},
                  'direction_vector': [0, 1], 'primary_direction': 'approaching'},
        target_fps=1)
    rows = list(session.process_stream())
    assert [(row.window_start_s, row.window_end_s, row.crossings_veh) for row in rows] == [(0, 5, 0), (5, 6, 1)]
    assert rows[0].available_at_source_s >= rows[0].window_end_s
    assert rows[0].validation_level == 'provisional_unreviewed'
    assert len(rows[0].geometry_hash) == len(rows[0].model_hash) == 64
    sys.modules.pop('services.vision.itd_pipeline', None)
