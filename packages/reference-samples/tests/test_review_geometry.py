"""The V02 guide geometry must remain useful for the selected road views."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_review_lines_and_queue_regions_are_lowered_and_manifest_matches():
    cameras = json.loads((ROOT / "packages/camera-config/cameras.json").read_text())["cameras"]
    windows = json.loads((ROOT / "packages/reference-samples/candidate-windows-v1.json").read_text())["windows"]
    for window in windows:
        geometry = cameras[window["camera_id"]]["geometry"]
        line = geometry["counting_line"]
        queue = geometry["queue_roi"]
        assert line["p1"][1] == line["p2"][1]
        assert line["p1"][1] >= 0.70, window["camera_id"]
        assert min(point[1] for point in queue) >= 0.40, window["camera_id"]
        assert max(point[1] for point in queue) < line["p1"][1], window["camera_id"]
        assert geometry["direction_vector"] == [0, 1]
        canonical = json.dumps(geometry, sort_keys=True, separators=(",", ":")).encode()
        assert hashlib.sha256(canonical).hexdigest() == window["geometry_sha256"]
