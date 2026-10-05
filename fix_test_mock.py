import re
with open("services/vision/tests/test_itd_pipeline.py", "r") as f:
    content = f.read()

# Instead of mocking sys.modules, we'll patch the imported YOLO in itd_pipeline
replacement = """    class YOLO:
        def __init__(self, *_): self.index = 0
        def track(self, *_args, **_kwargs):
            boxes = Boxes(self.index)
            self.index += 1
            return [SimpleNamespace(boxes=boxes)]
    monkeypatch.setattr('services.vision.itd_pipeline.YOLO', YOLO)"""

# I will replace all the old ultralytics mock logic in the test cases with this patch.
for test_name in ["test_approaching_approaching_count", "test_approaching_departing_zero", "test_departing_departing_count", "test_departing_approaching_zero"]:
    content = re.sub(
        r"    ultralytics = ModuleType\('ultralytics'\)\n    ultralytics\.YOLO = YOLO\n    mock_dependencies\.setitem\(sys\.modules, 'ultralytics', ultralytics\)",
        r"    mock_dependencies.setattr('services.vision.itd_pipeline.YOLO', YOLO)",
        content
    )

with open("services/vision/tests/test_itd_pipeline.py", "w") as f:
    f.write(content)
