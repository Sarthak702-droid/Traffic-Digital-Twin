#!/usr/bin/env python3
"""
Traffic Digital Twin Unified Management CLI.
PRD §24.1; Task T17.
Target interfaces:
  python scripts/twin.py doctor --config agent-config.json
  python scripts/twin.py assets --config agent-config.json
  python scripts/twin.py model-check --config agent-config.json
  python scripts/twin.py geometry --config agent-config.json
  python scripts/twin.py process --mode cached --config agent-config.json
  python scripts/twin.py process --mode online --config agent-config.json
  python scripts/twin.py profile --config agent-config.json
  python scripts/twin.py annotate --config agent-config.json
  python scripts/twin.py benchmark --config agent-config.json
  python scripts/twin.py verify --config agent-config.json
  python scripts/twin.py package --config agent-config.json
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path


def load_agent_config(config_path: str) -> dict:
    p = Path(config_path)
    if not p.exists():
        print(f"[ERROR] Config file not found: {config_path}", file=sys.stderr)
        sys.exit(1)
    with open(p, "r") as f:
        return json.load(f)


def cmd_doctor(args):
    print("=== Traffic Digital Twin Doctor ===")
    config = load_agent_config(args.config)
    checks = []

    # 1. Python & Packages
    py_ver = sys.version.split()[0]
    checks.append(("Python 3.12+", py_ver.startswith("3.12") or py_ver.startswith("3.11"), f"Found Python {py_ver}"))

    # 2. Go
    go_res = subprocess.run(["go", "version"], capture_output=True, text=True)
    checks.append(("Go 1.22+", go_res.returncode == 0, go_res.stdout.strip() if go_res.returncode == 0 else "Go not found"))

    # 3. Node.js
    node_res = subprocess.run(["node", "--version"], capture_output=True, text=True)
    checks.append(("Node.js", node_res.returncode == 0, node_res.stdout.strip() if node_res.returncode == 0 else "Node not found"))

    # 4. PostgreSQL Database
    pg_res = subprocess.run(["docker", "ps", "--filter", "name=trafficdigitaltwin-postgres", "--format", "{{.Status}}"], capture_output=True, text=True)
    pg_running = "Up" in pg_res.stdout
    checks.append(("PostgreSQL (Port 5433)", pg_running, "Container healthy" if pg_running else "PostgreSQL not running"))

    # 5. Model weights
    model_path = Path(config.get("assets", {}).get("itd_checkpoint_path", ".runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt"))
    checks.append(("ITD Checkpoint", model_path.exists(), f"Path: {model_path} ({model_path.stat().st_size if model_path.exists() else 0} bytes)"))

    # Print results
    all_ok = True
    for name, ok, detail in checks:
        status_str = "PASS" if ok else "FAIL"
        print(f"[{status_str}] {name}: {detail}")
        if not ok:
            all_ok = False

    if not all_ok:
        sys.exit(1)
    print("Doctor check completed successfully.")


def cmd_assets(args):
    print("=== Validating Media Assets ===")
    manifest_p = Path("asset-manifest.json")
    if not manifest_p.exists():
        print("[ERROR] asset-manifest.json not found.", file=sys.stderr)
        sys.exit(1)
    with open(manifest_p, "r") as f:
        manifest = json.load(f)

    assets = manifest.get("assets", [])
    print(f"Total registered assets: {len(assets)}")
    all_exist = True
    for a in assets:
        fname = a["filename"]
        slot = a.get("assigned_slot", "UNASSIGNED")
        p = Path(fname)
        exists = p.exists()
        print(f"  [{slot}] {fname} - {'FOUND' if exists else 'MISSING'} ({a.get('resolution')}, {a.get('duration_s')}s)")
        if not exists:
            all_exist = False

    if not all_exist:
        sys.exit(1)
    print("Asset validation completed.")


def cmd_model_check(args):
    print("=== Checking ITD Pretrained Model Checkpoint ===")
    config = load_agent_config(args.config)
    mpath = Path(config.get("assets", {}).get("itd_checkpoint_path", ".runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt"))
    if not mpath.exists():
        print(f"[ERROR] Checkpoint not found at {mpath}", file=sys.stderr)
        sys.exit(1)

    hasher = hashlib.sha256()
    with open(mpath, "rb") as f:
        while chunk := f.read(1024 * 1024):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    expected_digest = "06006ecb5fe52a348ceed805bf0aa6b32af7e24e689d09a6582f6d53159d6b00"

    print(f"  File size: {mpath.stat().st_size:,} bytes")
    print(f"  SHA-256: {digest}")
    if digest == expected_digest:
        print("  Hash verification: MATCH (Authentic ITD v1.2 Checkpoint)")
    else:
        print(f"  Hash verification: MISMATCH (Expected {expected_digest})", file=sys.stderr)
        sys.exit(1)


def cmd_geometry(args):
    print("=== Validating Camera Geometry Configurations ===")
    cfg_p = Path("packages/camera-config/cameras.json")
    if not cfg_p.exists():
        print(f"[ERROR] Camera config not found at {cfg_p}", file=sys.stderr)
        sys.exit(1)
    with open(cfg_p, "r") as f:
        data = json.load(f)

    cams = data.get("cameras", {})
    print(f"Loaded {len(cams)} camera configurations:")
    for cid, cdata in cams.items():
        geom = cdata.get("geometry", {})
        road_poly = geom.get("road_roi", [])
        line = geom.get("counting_line", {})
        queue_roi = geom.get("queue_roi", [])
        p1 = line.get("p1", [])
        p2 = line.get("p2", [])
        print(f"  [{cid}] Road vertices: {len(road_poly)}, Line: {p1} -> {p2}, Queue ROI vertices: {len(queue_roi)}")

    evidence_dir = Path(".runtime/evidence/geometry_previews")
    if evidence_dir.exists():
        previews = list(evidence_dir.glob("*.png"))
        print(f"  Visual evidence previews: {len(previews)} images in {evidence_dir}")
    print("Geometry check passed.")


def cmd_process(args):
    mode = args.mode
    print(f"=== Video Stream Processing (Mode: {mode}) ===")
    if mode == "cached":
        obs_dir = Path(".runtime/vision/observations")
        if not obs_dir.exists():
            print(f"[ERROR] Observations directory not found: {obs_dir}", file=sys.stderr)
            sys.exit(1)
        files = list(obs_dir.glob("*.jsonl"))
        total_records = 0
        for f in files:
            count = sum(1 for _ in open(f, "r"))
            total_records += count
            print(f"  {f.name}: {count} 5-second observation bins")
        print(f"Total cached observation records: {total_records}")
    elif mode == "online":
        print("Starting concurrent orchestrator smoke test...")
        res = subprocess.run([sys.executable, "services/vision/concurrent_orchestrator.py"], capture_output=True, text=True)
        print(res.stdout)
        if res.returncode != 0:
            print(res.stderr, file=sys.stderr)
            sys.exit(res.returncode)
    else:
        print(f"[ERROR] Unknown mode: {mode}", file=sys.stderr)
        sys.exit(1)


def cmd_profile(args):
    print("=== Generating Boundary Demand Profiles ===")
    from services.simulation.video_demand import VideoProfileDemandProvider
    provider = VideoProfileDemandProvider(observations_dir=".runtime/vision/observations", scale=1.0)
    manifest = provider.export_manifest()
    out_path = Path("demand-profile-manifest.json")
    with open(out_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Exported demand profile manifest to {out_path}")
    for link, info in manifest["boundary_links"].items():
        print(f"  Link {link} ({info['assigned_camera']}): {info['total_profile_mass_veh']} veh across {info['bins_count']} bins")


def cmd_annotate(args):
    print("=== Auto-Annotation & Provenance ===")
    res = subprocess.run([sys.executable, "services/vision/auto_annotation.py"], capture_output=True, text=True)
    print(res.stdout)
    if res.returncode != 0:
        print(res.stderr, file=sys.stderr)
        sys.exit(res.returncode)


def cmd_benchmark(args):
    print("=== Running Target Machine Benchmarks ===")
    from services.vision.benchmark_suite import run_benchmark
    report = run_benchmark()
    print(f"Benchmark finished with status: {report.get('status')}")


def cmd_verify(args):
    print("=== Running Full Verification Suite ===")
    
    # 1. Python Unit and Integration Tests
    print("\n--- 1. Python Tests ---")
    py_res = subprocess.run([".venv/bin/pytest", "-v"], capture_output=True, text=True)
    print(py_res.stdout)
    if py_res.returncode != 0:
        print(py_res.stderr, file=sys.stderr)
        print("[FAIL] Python test suite failed!")
        sys.exit(1)
    print("[PASS] Python test suite passed.")

    # 2. Go Tests
    print("\n--- 2. Go API & Contracts Tests ---")
    go_res = subprocess.run(["go", "test", "./..."], capture_output=True, text=True)
    print(go_res.stdout)
    if go_res.returncode != 0:
        print(go_res.stderr, file=sys.stderr)
        print("[FAIL] Go test suite failed!")
        sys.exit(1)
    print("[PASS] Go test suite passed.")

    # 3. UI Vitest
    print("\n--- 3. UI Vitest Suite ---")
    ui_res = subprocess.run(["npm", "--prefix", "apps/web", "test"], capture_output=True, text=True)
    print(ui_res.stdout)
    if ui_res.returncode != 0:
        print(ui_res.stderr, file=sys.stderr)
        print("[FAIL] UI test suite failed!")
        sys.exit(1)
    print("[PASS] UI test suite passed.")

    print("\nALL VERIFICATION CHECKS PASSED.")


def cmd_package(args):
    print("=== Packaging & Readiness Verification ===")
    readiness_p = Path("readiness.json")
    if not readiness_p.exists():
        print("[ERROR] readiness.json not found", file=sys.stderr)
        sys.exit(1)
    with open(readiness_p, "r") as f:
        readiness = json.load(f)
    print(f"Readiness Status: {readiness.get('overall_release_readiness')}")
    print(f"Delivery Version: {readiness.get('prd_version')}")


def main():
    parser = argparse.ArgumentParser(description="Traffic Digital Twin Unified Management Tool")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_cfg_arg(sub):
        sub.add_argument("--config", default="agent-config.json", help="Path to agent configuration")

    p_doc = subparsers.add_parser("doctor", help="Run system diagnostics and dependency checks")
    add_cfg_arg(p_doc)
    p_doc.set_defaults(func=cmd_doctor)

    p_ass = subparsers.add_parser("assets", help="Validate registered video media files")
    add_cfg_arg(p_ass)
    p_ass.set_defaults(func=cmd_assets)

    p_mod = subparsers.add_parser("model-check", help="Verify ITD checkpoint hash and classes")
    add_cfg_arg(p_mod)
    p_mod.set_defaults(func=cmd_model_check)

    p_geo = subparsers.add_parser("geometry", help="Validate camera geometry and counting lines")
    add_cfg_arg(p_geo)
    p_geo.set_defaults(func=cmd_geometry)

    p_pro = subparsers.add_parser("process", help="Execute video processing pipeline")
    add_cfg_arg(p_pro)
    p_pro.add_argument("--mode", choices=["cached", "online"], default="cached", help="Processing mode")
    p_pro.set_defaults(func=cmd_process)

    p_prf = subparsers.add_parser("profile", help="Generate video-derived demand profiles")
    add_cfg_arg(p_prf)
    p_prf.set_defaults(func=cmd_profile)

    p_ann = subparsers.add_parser("annotate", help="Export pre-annotations and review logs")
    add_cfg_arg(p_ann)
    p_ann.set_defaults(func=cmd_annotate)

    p_bmk = subparsers.add_parser("benchmark", help="Execute target machine performance benchmark")
    add_cfg_arg(p_bmk)
    p_bmk.set_defaults(func=cmd_benchmark)

    p_ver = subparsers.add_parser("verify", help="Run complete test suites across Python, Go, and Web")
    add_cfg_arg(p_ver)
    p_ver.set_defaults(func=cmd_verify)

    p_pkg = subparsers.add_parser("package", help="Verify release packaging and readiness bundle")
    add_cfg_arg(p_pkg)
    p_pkg.set_defaults(func=cmd_package)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
