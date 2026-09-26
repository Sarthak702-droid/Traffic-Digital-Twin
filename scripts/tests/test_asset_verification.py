import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.twin import cmd_assets, python_version_supported, postgres_reachable, validate_manifest_asset


class AssetVerificationTests(unittest.TestCase):
    def test_doctor_checks_supported_python_and_database_socket(self):
        self.assertTrue(python_version_supported((3, 12)))
        self.assertTrue(python_version_supported((3, 14)))
        self.assertFalse(python_version_supported((3, 11)))
        with patch("scripts.twin.socket.create_connection") as connect:
            self.assertTrue(postgres_reachable("127.0.0.1", 5433))
            connect.assert_called_once_with(("127.0.0.1", 5433), timeout=1)
        with patch("scripts.twin.socket.create_connection", side_effect=OSError):
            self.assertFalse(postgres_reachable("127.0.0.1", 5433))

    def test_command_reads_registered_clips_from_configured_media_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            media = root / "private media"
            media.mkdir()
            (media / "sample.mp4").write_bytes(b"recorded sample")
            manifest = root / "asset-manifest.json"
            manifest.write_text(json.dumps({"assets": [{"filename": "sample.mp4", "size_bytes": 15,
                "sha256": hashlib.sha256(b"recorded sample").hexdigest()}]}))
            with patch("scripts.twin.resolve_repo_path", return_value=manifest), patch.dict(os.environ, {"VIDEO_ASSET_DIR": str(media)}):
                cmd_assets(SimpleNamespace())

    def test_checks_file_identity_not_only_presence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.mp4").write_bytes(b"recorded sample")
            expected = {"filename": "sample.mp4", "size_bytes": 15,
                        "sha256": hashlib.sha256(b"recorded sample").hexdigest()}
            self.assertIsNone(validate_manifest_asset(expected, root))
            self.assertIn("SHA-256", validate_manifest_asset({**expected, "sha256": "0" * 64}, root))
            self.assertIn("size", validate_manifest_asset({**expected, "size_bytes": 16}, root))
            self.assertIn("filename", validate_manifest_asset({**expected, "filename": "../sample.mp4"}, root))


if __name__ == "__main__":
    unittest.main()
