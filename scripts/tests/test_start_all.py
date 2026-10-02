import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import start_all


class LauncherRecoveryTests(unittest.TestCase):
    def test_missing_account_stops_startup_with_setup_instruction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "users.json"
            with self.assertRaisesRegex(RuntimeError, "create-gateway-user.py"):
                start_all.check_local_accounts({"GATEWAY_USERS_FILE": str(path)})

    def test_empty_or_public_account_file_cannot_start(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "users.json"
            path.write_text("{}")
            path.chmod(0o600)
            with self.assertRaises(RuntimeError):
                start_all.check_local_accounts({"GATEWAY_USERS_FILE": str(path)})
            path.write_text(json.dumps({"operator": {"role": "operator", "version": 1,
                "salt": "a" * 48, "hash": "b" * 64}}))
            path.chmod(0o644)
            with self.assertRaisesRegex(RuntimeError, "chmod 600"):
                start_all.check_local_accounts({"GATEWAY_USERS_FILE": str(path)})
            path.chmod(0o600)
            start_all.check_local_accounts({"GATEWAY_USERS_FILE": str(path)})

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

    def test_launcher_shell_mentioning_vite_is_not_a_stale_service(self):
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            shell = proc_root / "42"
            shell.mkdir()
            (shell / "cmdline").write_bytes(b"bash\0-c\0ln -s apps/web/node_modules/.bin/vite && python3 scripts/start_all.py\0")
            with patch.object(start_all, "ROOT", Path(directory)), patch.object(start_all, "_listener_pids", return_value=set()):
                self.assertNotIn(42, start_all.workspace_service_pids(proc_root))

    def test_fallback_vite_launcher_runs_from_workspace_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "apps/web").mkdir(parents=True)
            command, cwd = start_all.frontend_command(root, "npm")
            self.assertEqual(command, ["npm", "run", "dev", "-w", "apps/web"])
            self.assertEqual(cwd, str(root))


if __name__ == "__main__":
    unittest.main()
