import hashlib
import tempfile
import unittest
from pathlib import Path

from scripts.twin import validate_manifest_asset


class AssetVerificationTests(unittest.TestCase):
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
