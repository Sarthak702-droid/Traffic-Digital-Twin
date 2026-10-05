import re
with open("services/vision/tests/test_itd_pipeline.py", "r") as f:
    content = f.read()

replacement = """    monkeypatch.setattr('services.vision.itd_pipeline.cv2', cv2)"""

content = re.sub(
    r"    monkeypatch\.setitem\(sys\.modules, 'cv2', cv2\)",
    replacement,
    content
)

with open("services/vision/tests/test_itd_pipeline.py", "w") as f:
    f.write(content)
