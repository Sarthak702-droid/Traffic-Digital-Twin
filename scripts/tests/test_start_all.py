import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import start_all


class LauncherRecoveryTests(unittest.TestCase):
    def test_reads_process_start_time_even_when_command_has_spaces(self):
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            process = proc_root / "42"
            process.mkdir()
            fields = ["S"] + [str(value) for value in range(4, 22)] + ["98765"]
            (process / "stat").write_text("42 (service with spaces) " + " ".join(fields))

            self.assertEqual(start_all._process_start_time(42, proc_root), "98765")

    def test_only_matching_registered_process_instance_is_recovered(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proc_root = root / "proc"
            proc_root.mkdir()
            for pid, start_time in ((10, "111"), (20, "222")):
                process = proc_root / str(pid)
                process.mkdir()
                fields = ["S"] + ["0"] * 18 + [start_time]
                (process / "stat").write_text(f"{pid} (service) " + " ".join(fields))
            state_file = root / "services.json"
            state_file.write_text(json.dumps({"services": [
                {"pid": 10, "start_time": "111"},
                {"pid": 20, "start_time": "old-instance"},
            ]}))

            with patch.object(start_all, "SERVICE_STATE_FILE", state_file):
                self.assertEqual(start_all._registered_service_pids(proc_root), {10})

    def test_finds_only_listeners_on_stack_ports(self):
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            net = proc_root / "net"
            net.mkdir()
            header = "sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode"
            rows = [
                "0: 0100007F:C383 00000000:0000 0A 0:0 0:0 0 0 0 50051",
                "1: 0100007F:1F91 00000000:0000 0A 0:0 0:0 0 0 0 8081",
                "2: 0100007F:C384 00000000:0000 01 0:0 0:0 0 0 0 50052",
            ]
            (net / "tcp").write_text("\n".join([header, *rows]))
            (net / "tcp6").write_text(header + "\n")

            self.assertEqual(
                start_all._listening_socket_inodes({8081, 50051, 50052}, proc_root),
                {"50051", "8081"},
            )


if __name__ == "__main__":
    unittest.main()
