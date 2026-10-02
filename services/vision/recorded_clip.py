"""Authorized recorded-clip registration and finalized observation cache.

Only aggregate windows leave this boundary. Source media and tracking state stay local.
"""
from __future__ import annotations

import hashlib
import fcntl
import json
import math
import os
import uuid
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path

from services.vision.resource_probe import ProcessResourceProbe
from services.shared.network_config import config_hash, load_config

OBSERVATION_SCHEMA = 'camera-observation-v1'
DETECTOR_VERSION = 'itd-v1.2-yolo-vehicle-counts-v2'
TRACKER_VERSION = 'bytetrack-ultralytics-8.4.129'
EXPECTED_ITD_SHA256 = '06006ecb5fe52a348ceed805bf0aa6b32af7e24e689d09a6582f6d53159d6b00'


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _hash_json(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _write_json(path: Path, payload: dict) -> None:
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(payload, sort_keys=True, indent=2) + '\n')
    os.replace(temporary, path)


def _validate_geometry(geometry: dict) -> None:
    line = geometry.get('counting_line', {})
    points = (line.get('p1'), line.get('p2'))
    vector = geometry.get('direction_vector')
    def point(value):
        return (isinstance(value, (list, tuple)) and len(value) == 2
                and all(isinstance(item, (int, float)) and math.isfinite(item) and 0 <= item <= 1 for item in value))
    if not all(point(value) for value in points) or points[0] == points[1]:
        raise ValueError('Configured counting line must have two distinct normalized points')
    if (not isinstance(vector, (list, tuple)) or len(vector) != 2
        or any(not isinstance(item, (int, float)) or not math.isfinite(item) or abs(item) > 1 for item in vector)
        or all(item == 0 for item in vector)):
        raise ValueError('Configured direction vector is invalid')
    queue = geometry.get('queue_roi')
    if queue is not None and (not isinstance(queue, list) or len(queue) < 3 or not all(point(value) for value in queue)):
        raise ValueError('Configured queue region must contain normalized polygon points')
    if geometry.get('primary_direction') not in ('approaching', 'departing'):
        raise ValueError('Configured primary direction is invalid')


class RecordedClipProcessor:
    def __init__(self, output_dir, camera_config_path, model_path, authorized_roots,
                 session_factory=None, expected_model_sha256=EXPECTED_ITD_SHA256):
        self.output_dir = Path(output_dir)
        self.camera_config_path = Path(camera_config_path)
        self.model_path = Path(model_path)
        self.authorized_roots = tuple(Path(root).resolve() for root in authorized_roots)
        self.session_factory = session_factory
        self.expected_model_sha256 = expected_model_sha256

    def register(self, camera_id: str, video_path, authorization_reference: str) -> dict:
        if not authorization_reference or not authorization_reference.strip():
            raise ValueError('An authorization reference for recorded media is required')
        path = Path(video_path).resolve()
        if not self.authorized_roots or not any(path.is_relative_to(root) for root in self.authorized_roots):
            raise ValueError('Clip is outside an authorized root')
        if not path.is_file():
            raise FileNotFoundError(f'Recorded clip is missing: {path}')
        if self.model_path.is_dir():
            raise ValueError('Detector checkpoint must be a regular .pt file, not an extracted directory')
        if not self.model_path.is_file():
            raise FileNotFoundError(f'Detector checkpoint is missing: {self.model_path}')
        config = json.loads(self.camera_config_path.read_text())
        camera = config.get('cameras', {}).get(camera_id)
        if not camera or not camera.get('geometry'):
            raise ValueError('An explicitly configured camera and geometry are required')
        geometry = camera['geometry']
        _validate_geometry(geometry)
        network = load_config()
        boundary = network['camera_boundary_links'].get(camera_id, '')
        if camera.get('injects_boundary_mass', False) != bool(boundary) or camera.get('boundary_link_id', '') != boundary:
            raise ValueError('Camera boundary role does not match network mapping')
        clip_hash = _hash_file(path)
        model_hash = _hash_file(self.model_path)
        if model_hash != self.expected_model_sha256:
            raise ValueError('Detector checkpoint SHA-256 does not match the verified ITD v1.2 model')
        geometry_hash = _hash_json(geometry)
        configuration_hash = config_hash(network)
        camera_config_hash = _hash_json(camera)
        identity = {'camera_id': camera_id, 'clip_sha256': clip_hash, 'geometry_sha256': geometry_hash,
                    'model_sha256': model_hash, 'detector_version': DETECTOR_VERSION,
                    'tracker_version': TRACKER_VERSION, 'observation_schema_version': OBSERVATION_SCHEMA,
                    'config_hash': configuration_hash, 'camera_config_sha256': camera_config_hash}
        return {'status': 'registered', 'camera_id': camera_id, 'clip_path': str(path),
                'authorization_reference': authorization_reference.strip(), 'boundary_link_id': boundary,
                'geometry': geometry, **identity}

    def process(self, registration: dict, max_duration_s=None) -> dict:
        if max_duration_s is not None and (not math.isfinite(max_duration_s) or max_duration_s <= 0):
            raise ValueError('Maximum processing duration must be finite and positive')
        current = self.register(registration['camera_id'], registration['clip_path'], registration['authorization_reference'])
        identity_fields = ('camera_id', 'clip_sha256', 'geometry_sha256', 'model_sha256',
                           'detector_version', 'tracker_version', 'observation_schema_version',
                           'config_hash', 'camera_config_sha256')
        if any(current[key] != registration[key] for key in identity_fields):
            raise ValueError('Registered clip, model, geometry or configuration changed before processing')
        self.output_dir.mkdir(parents=True, exist_ok=True)
        with (self.output_dir / '.fresh-inference.lock').open('a+b') as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError('Fresh inference slot is occupied for this output directory') from error
            return self._process_locked(current, max_duration_s, identity_fields)

    def _process_locked(self, current: dict, max_duration_s, identity_fields: tuple[str, ...]) -> dict:
        key = _hash_json({name: current[name] for name in identity_fields} | {'max_duration_s': max_duration_s})
        directory = self.output_dir / current['camera_id'] / key
        directory.mkdir(parents=True, exist_ok=True)
        manifest_path = directory / 'manifest.json'
        observations_path = directory / 'observations.jsonl'
        if manifest_path.is_file() and observations_path.is_file():
            try:
                cached = json.loads(manifest_path.read_text())
                if (cached.get('status') == 'complete' and cached.get('cache_key') == key
                    and cached.get('observations_sha256') == _hash_file(observations_path)):
                    rows = [json.loads(line) for line in observations_path.read_text().splitlines() if line]
                    if len(rows) == cached['window_count'] and rows and all(
                        row['source_identity']['source_session_id'] == cached['source_session_id']
                        and row['source_identity']['clip_sha256'] == current['clip_sha256']
                        and row['source_identity']['config_hash'] == current['config_hash']
                        and row['source_identity']['geometry_sha256'] == current['geometry_sha256']
                        and row['source_identity']['detector_version'] == current['detector_version']
                        and row['source_identity']['tracker_version'] == current['tracker_version']
                        for row in rows
                    ):
                        return {**cached, 'processing_mode': 'cached_observations'}
            except (KeyError, ValueError, OSError):
                pass
        source_session_id = str(uuid.uuid4())
        temporary = observations_path.with_name('observations.jsonl.tmp')
        count = 0
        previous_end = -1.0
        probe=ProcessResourceProbe()
        try:
            factory = self.session_factory
            if factory is None:
                from services.vision.itd_pipeline import ITDVideoAnalyticsSession
                factory = ITDVideoAnalyticsSession
            session = factory(camera_id=current['camera_id'], video_path=current['clip_path'],
                              model_path=str(self.model_path), geometry=current['geometry'],
                              session_id=source_session_id)
            with temporary.open('w') as destination:
                for observation in session.process_stream(max_duration_s=max_duration_s):
                    row = asdict(observation) if is_dataclass(observation) else dict(observation)
                    start = float(row['window_start_s'])
                    end = float(row['window_end_s'])
                    available = float(row['available_at_source_s'])
                    crossings = row['crossings_veh']
                    if (not all(math.isfinite(value) for value in (start, end, available))
                        or start < 0 or end <= start or start < previous_end
                        or available < end or type(crossings) is not int or crossings < 0
                        or row.get('direction_id') != current['geometry'].get('primary_direction')
                        or row.get('observation_status', 'valid') != 'valid'):
                        raise ValueError('Invalid, overlapping or out-of-order finalized observation')
                    queue = row.get('queue_visible_veh_estimate')
                    if queue is not None and (type(queue) is not int or queue < 0):
                        raise ValueError('Invalid visible queue estimate')
                    previous_end = end
                    row.update(schema_version=OBSERVATION_SCHEMA,
                               observation_id=f'{source_session_id}:{count}', camera_id=current['camera_id'],
                               clip_id=current['clip_sha256'], session_id=source_session_id,
                               boundary_link_id=current['boundary_link_id'],
                               processed_at_utc=datetime.now(timezone.utc).isoformat(),
                               observation_status='valid', validation_level='provisional_unreviewed',
                               processing_mode='online_inference', speed_kph=None, speed_status='uncalibrated',
                               geometry_hash=current['geometry_sha256'], model_hash=current['model_sha256'],
                               source_identity={'clip_sha256': current['clip_sha256'],
                                                'geometry_sha256': current['geometry_sha256'],
                                                'detector_version': current['detector_version'],
                                                'tracker_version': current['tracker_version'],
                                                'observation_schema_version': OBSERVATION_SCHEMA,
                                                'source_session_id': source_session_id,
                                                'config_hash': current['config_hash'],
                                                'processing_mode': 'online_inference'})
                    destination.write(json.dumps(row, sort_keys=True) + '\n')
                    count += 1
            if not count:
                raise ValueError('No finalized observation windows were produced')
            os.replace(temporary, observations_path)
            manifest = {key: value for key, value in current.items() if key not in ('geometry',)}
            manifest.update(status='complete', cache_key=key, source_session_id=source_session_id,
                            window_count=count, observations_path=str(observations_path),
                            observations_sha256=_hash_file(observations_path),
                            processing_mode='online_inference',
                            resource_measurements=probe.result(getattr(session,'inference_frames_total',None)))
            _write_json(manifest_path, manifest)
            return manifest
        except Exception as error:
            temporary.unlink(missing_ok=True)
            observations_path.unlink(missing_ok=True)
            _write_json(manifest_path, {'status': 'failed', 'cache_key': key, 'error': str(error)})
            raise
        finally:
            probe.close()
