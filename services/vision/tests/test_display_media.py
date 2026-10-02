import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('display_media', Path(__file__).resolve().parents[3] / 'scripts/prepare_video_displays.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_display_copy_is_bound_to_immutable_registered_source(tmp_path):
    clip = tmp_path / 'clip.mp4'
    clip.write_bytes(b'recorded source')
    asset = {'filename': clip.name, 'sha256': module.sha256(clip)}
    assert module.registered_source(tmp_path, asset) == clip
    assert clip.read_bytes() == b'recorded source'
    clip.write_bytes(b'changed source')
    with pytest.raises(ValueError, match='SHA-256'):
        module.registered_source(tmp_path, asset)


def test_display_copy_cannot_escape_authorized_root(tmp_path):
    outside = tmp_path / 'outside.mp4'
    outside.write_bytes(b'source')
    root = tmp_path / 'authorized'
    root.mkdir()
    with pytest.raises(ValueError, match='basename'):
        module.registered_source(root, {'filename': '../outside.mp4', 'sha256': module.sha256(outside)})
    (root / 'symlink.mp4').symlink_to(outside)
    with pytest.raises(ValueError, match='authorized'):
        module.registered_source(root, {'filename': 'symlink.mp4', 'sha256': module.sha256(outside)})
