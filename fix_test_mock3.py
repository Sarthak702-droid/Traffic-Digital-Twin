import re
with open("services/vision/tests/test_itd_pipeline.py", "r") as f:
    content = f.read()

# I want to make sure services.vision.itd_pipeline.YOLO is correctly patched in every test.
content = re.sub(
    r"    ultralytics = ModuleType\('ultralytics'\)\n    ultralytics\.YOLO = YOLO\n    mock_dependencies\.setitem\(sys\.modules, 'ultralytics', ultralytics\)",
    r"    mock_dependencies.setattr('services.vision.itd_pipeline.YOLO', YOLO)",
    content
)

with open("services/vision/tests/test_itd_pipeline.py", "w") as f:
    f.write(content)
