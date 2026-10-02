#!/usr/bin/env python3
"""Register and process one authorized local clip into versioned aggregate windows."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.vision.recorded_clip import RecordedClipProcessor


def limit_cpu_cores(count):
    if not hasattr(os, 'sched_getaffinity') or not hasattr(os, 'sched_setaffinity'):
        raise RuntimeError('CPU-budgeted fresh inference requires Linux affinity support')
    available = sorted(os.sched_getaffinity(0))
    if count <= 0 or count > len(available):
        raise ValueError('CPU core limit must be positive and within the available CPU set')
    selected = available[:count]
    # Apply before importing the detector runtime: subsequently created decode,
    # BLAS and model workers inherit this bounded CPU set.
    os.sched_setaffinity(0, set(selected))
    return selected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--camera', required=True)
    parser.add_argument('--clip', type=Path, required=True)
    parser.add_argument('--authorized-root', type=Path, required=True)
    parser.add_argument('--authorization-reference', required=True)
    parser.add_argument('--model', type=Path, default=ROOT / '.runtime/models/itd-v1.2/best_xl_ITD_v1.2.pt')
    parser.add_argument('--camera-config', type=Path, default=ROOT / 'packages/camera-config/cameras.json')
    parser.add_argument('--output-dir', type=Path, default=ROOT / '.runtime/vision/processed')
    parser.add_argument('--max-duration-s', type=float)
    parser.add_argument('--cpu-core-limit', type=int, default=4)
    args = parser.parse_args()
    if args.max_duration_s is not None and args.max_duration_s <= 0:
        parser.error('--max-duration-s must be positive')
    try:
        limit_cpu_cores(args.cpu_core_limit)
    except (ValueError, RuntimeError) as error:
        parser.error(str(error))
    processor = RecordedClipProcessor(args.output_dir, args.camera_config, args.model, [args.authorized_root])
    try:
        registration = processor.register(args.camera, args.clip, args.authorization_reference)
        outcome = processor.process(registration, max_duration_s=args.max_duration_s)
    except Exception as error:
        parser.exit(1, f'processing failed: {error}\n')
    print(json.dumps({key: outcome[key] for key in ('status', 'processing_mode', 'camera_id',
        'source_session_id', 'window_count', 'observations_path', 'clip_sha256', 'config_hash')}, sort_keys=True))


if __name__ == '__main__':
    main()
