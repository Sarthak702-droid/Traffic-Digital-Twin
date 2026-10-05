import pytest
import importlib
import sys
from types import ModuleType, SimpleNamespace
from services.vision.itd_pipeline import ITDVideoAnalyticsSession, DirectionalLineCounter

def test_directional_line_counter():
    # p1, p2 is horizontal line at y=55
    counter = DirectionalLineCounter(p1=(15, 55), p2=(85, 55), vector=(0, 1), tolerance_px=25.0)
    
    # approaching: crossing top to bottom (y goes from 50 to 60)
    # cross product depends on (85-15)*(50-55) = 70*-5 = -350
    # (85-15)*(60-55) = 70*5 = 350
    # vector (0, 1), dx=0, dy=10. dot = 10 > 0 -> approaching
    res = counter.check_crossing(1, (50, 50), (50, 60))
    assert res == "approaching"
    
    # already counted
    res2 = counter.check_crossing(1, (50, 60), (50, 70))
    assert res2 is None
    
    # departing: crossing bottom to top (y goes from 60 to 50)
    # vector (0, 1), dx=0, dy=-10. dot = -10 < 0 -> departing
    res3 = counter.check_crossing(2, (50, 60), (50, 50))
    assert res3 == "departing"

@pytest.fixture
def mock_dependencies(monkeypatch):
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
    cv2.pointPolygonTest = lambda pts, pt, measureDist: 1.0
    monkeypatch.setattr('services.vision.itd_pipeline.cv2', cv2)
    monkeypatch.setitem(sys.modules, 'numpy', ModuleType('numpy'))
    torch = ModuleType('torch')
    torch.set_num_threads = lambda count: None
    monkeypatch.setitem(sys.modules, 'torch', torch)
    
    # Save original to restore later
    yield monkeypatch

def test_approaching_approaching_count(tmp_path, mock_dependencies, monkeypatch):
    # Camera expects approaching, car moves approaching
    class Boxes:
        def __init__(self, index):
            self.id = [type('Scalar', (), {'item': lambda self: 1})()] if index >= 4 else None
            self.cls = [type('Scalar', (), {'item': lambda self: 2})()] if index >= 4 else []
            self.xyxy = [type('Array', (), {'cpu': lambda self: self, 'numpy': lambda self: [256, 192, 384, 320 if index == 4 else 384]})()] if index >= 4 else []
        def __len__(self): return len(self.xyxy)
    class YOLO:
        def __init__(self, *_): self.index = 0
        def track(self, *_args, **_kwargs):
            boxes = Boxes(self.index)
            self.index += 1
            return [SimpleNamespace(boxes=boxes)]
    monkeypatch.setattr('services.vision.itd_pipeline.YOLO', YOLO)
    
    video = tmp_path / 'clip.mp4'
    model = tmp_path / 'model.pt'
    video.write_bytes(b'video')
    model.write_bytes(b'model')
    
    session = ITDVideoAnalyticsSession('CAM-01', str(video), str(model),
        geometry={'counting_line': {'p1': [0.15, .55], 'p2': [.85, .55]},
                  'direction_vector': [0, 1], 'primary_direction': 'approaching'},
        target_fps=1)
    
    rows = list(session.process_stream())
    assert rows[1].crossings_veh == 1
    assert rows[1].counts_by_class['car'] == 1

def test_approaching_departing_zero(tmp_path, mock_dependencies, monkeypatch):
    # Camera expects approaching, car moves departing (y goes from 384 to 320)
    class Boxes:
        def __init__(self, index):
            self.id = [type('Scalar', (), {'item': lambda self: 1})()] if index >= 4 else None
            self.cls = [type('Scalar', (), {'item': lambda self: 2})()] if index >= 4 else []
            self.xyxy = [type('Array', (), {'cpu': lambda self: self, 'numpy': lambda self: [256, 192, 384, 384 if index == 4 else 320]})()] if index >= 4 else []
        def __len__(self): return len(self.xyxy)
    class YOLO:
        def __init__(self, *_): self.index = 0
        def track(self, *_args, **_kwargs):
            boxes = Boxes(self.index)
            self.index += 1
            return [SimpleNamespace(boxes=boxes)]
    monkeypatch.setattr('services.vision.itd_pipeline.YOLO', YOLO)
    
    video = tmp_path / 'clip.mp4'
    model = tmp_path / 'model.pt'
    video.write_bytes(b'video')
    model.write_bytes(b'model')
    
    session = ITDVideoAnalyticsSession('CAM-01', str(video), str(model),
        geometry={'counting_line': {'p1': [0.15, .55], 'p2': [.85, .55]},
                  'direction_vector': [0, 1], 'primary_direction': 'approaching'},
        target_fps=1)
    
    rows = list(session.process_stream())
    assert rows[1].crossings_veh == 0
    assert rows[1].counts_by_class['car'] == 0

def test_departing_departing_count(tmp_path, mock_dependencies, monkeypatch):
    # Camera expects departing, car moves departing
    class Boxes:
        def __init__(self, index):
            self.id = [type('Scalar', (), {'item': lambda self: 1})()] if index >= 4 else None
            self.cls = [type('Scalar', (), {'item': lambda self: 2})()] if index >= 4 else []
            self.xyxy = [type('Array', (), {'cpu': lambda self: self, 'numpy': lambda self: [256, 192, 384, 384 if index == 4 else 320]})()] if index >= 4 else []
        def __len__(self): return len(self.xyxy)
    class YOLO:
        def __init__(self, *_): self.index = 0
        def track(self, *_args, **_kwargs):
            boxes = Boxes(self.index)
            self.index += 1
            return [SimpleNamespace(boxes=boxes)]
    monkeypatch.setattr('services.vision.itd_pipeline.YOLO', YOLO)
    
    video = tmp_path / 'clip.mp4'
    model = tmp_path / 'model.pt'
    video.write_bytes(b'video')
    model.write_bytes(b'model')
    
    session = ITDVideoAnalyticsSession('CAM-01', str(video), str(model),
        geometry={'counting_line': {'p1': [0.15, .55], 'p2': [.85, .55]},
                  'direction_vector': [0, 1], 'primary_direction': 'departing'},
        target_fps=1)
    
    rows = list(session.process_stream())
    assert rows[1].crossings_veh == 1
    assert rows[1].counts_by_class['car'] == 1

def test_departing_approaching_zero(tmp_path, mock_dependencies, monkeypatch):
    # Camera expects departing, car moves approaching
    class Boxes:
        def __init__(self, index):
            self.id = [type('Scalar', (), {'item': lambda self: 1})()] if index >= 4 else None
            self.cls = [type('Scalar', (), {'item': lambda self: 2})()] if index >= 4 else []
            self.xyxy = [type('Array', (), {'cpu': lambda self: self, 'numpy': lambda self: [256, 192, 384, 320 if index == 4 else 384]})()] if index >= 4 else []
        def __len__(self): return len(self.xyxy)
    class YOLO:
        def __init__(self, *_): self.index = 0
        def track(self, *_args, **_kwargs):
            boxes = Boxes(self.index)
            self.index += 1
            return [SimpleNamespace(boxes=boxes)]
    monkeypatch.setattr('services.vision.itd_pipeline.YOLO', YOLO)
    
    video = tmp_path / 'clip.mp4'
    model = tmp_path / 'model.pt'
    video.write_bytes(b'video')
    model.write_bytes(b'model')
    
    session = ITDVideoAnalyticsSession('CAM-01', str(video), str(model),
        geometry={'counting_line': {'p1': [0.15, .55], 'p2': [.85, .55]},
                  'direction_vector': [0, 1], 'primary_direction': 'departing'},
        target_fps=1)
    
    rows = list(session.process_stream())
    assert rows[1].crossings_veh == 0
    assert rows[1].counts_by_class['car'] == 0

