#!/usr/bin/env python3
"""Prepare local aspect-preserving playback copies from registered source clips.

Original media and observation/session artifacts are never changed. Output stays
ignored and is bound to the original registered SHA-256 in an atomic manifest.
Requires FFmpeg on PATH, --ffmpeg, or the pinned imageio-ffmpeg runtime.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'display-rendition-v1'


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def registered_source(root, asset):
    root = Path(root).resolve()
    filename = asset['filename']
    if Path(filename).name != filename:
        raise ValueError('Registered clip filename must be a basename')
    source = (root / filename).resolve()
    if not source.is_relative_to(root) or not source.is_file():
        raise ValueError('Clip must exist inside the authorized video root')
    if sha256(source) != asset['sha256']:
        raise ValueError('Clip SHA-256 does not match registered source')
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'apps/web/public/vision-display-media')
    parser.add_argument('--ffmpeg')
    parser.add_argument('--cameras', nargs='*')
    args = parser.parse_args()
    ffmpeg = args.ffmpeg or shutil.which('ffmpeg')
    if not ffmpeg:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    assets = json.loads((ROOT / 'reports/asset-manifest.json').read_text())['assets']
    args.output.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'schema_version': VERSION, 'cameras': {}}
    for asset in assets:
        camera = asset['assigned_slot']
        if args.cameras and camera not in args.cameras:
            continue
        source = registered_source(args.video_root, asset)
        filename = f"{camera}-{asset['sha256']}-v1.mp4"
        output = args.output / filename
        cached = manifest['cameras'].get(camera, {})
        if (manifest.get('schema_version') == VERSION and cached.get('source_clip_sha256') == asset['sha256']
            and cached.get('filename') == filename and output.is_file() and sha256(output) == cached.get('rendition_sha256')):
            print(f'{camera}: matching display copy', flush=True)
            continue
        temporary = output.with_suffix('.tmp.mp4')
        print(f'{camera}: preparing full-clip display copy', flush=True)
        try:
            subprocess.run([str(ffmpeg), '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                '-threads', '1', '-i', str(source), '-map', '0:v:0', '-an', '-vf',
                "scale='if(gte(iw,ih),960,-2)':'if(gte(iw,ih),-2,960)',fps=15",
                '-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast', '-crf', '23',
                '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(temporary)], check=True)
            if not temporary.is_file() or temporary.stat().st_size == 0:
                raise ValueError('Display encoder produced no media')
            temporary.replace(output)
            manifest['cameras'][camera] = {'source_clip_sha256': asset['sha256'], 'filename': filename,
                'rendition_sha256': sha256(output), 'display_fps': 15, 'longest_side': 960, 'audio': 'muted'}
            atomic = manifest_path.with_suffix('.json.tmp')
            atomic.write_text(json.dumps(manifest, sort_keys=True))
            atomic.replace(manifest_path)
        finally:
            temporary.unlink(missing_ok=True)
    print(f"Completed {len(manifest['cameras'])} display copies", flush=True)


if __name__ == '__main__':
    main()
