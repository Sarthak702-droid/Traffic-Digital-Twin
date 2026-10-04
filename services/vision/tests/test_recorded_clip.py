import json
import hashlib
from dataclasses import dataclass

import pytest

from services.vision.recorded_clip import RecordedClipProcessor


@dataclass
class Window:
    window_start_s: float
    window_end_s: float
    available_at_source_s: float
    crossings_veh: int
    queue_visible_veh_estimate: int | None = None
    queue_status: str = 'unavailable'
    direction_id: str = 'approaching'


def setup_processor(tmp_path, factory):
    root = tmp_path / 'authorized'
    root.mkdir()
    clip = root / 'clip.mp4'
    clip.write_bytes(b'authorized recorded clip bytes')
    model = tmp_path / 'model.pt'
    model.write_bytes(b'private detector bytes')
    config = tmp_path / 'cameras.json'
    config.write_text(json.dumps({'cameras': {'CAM-01': {
        'network_role': 'external_boundary_input', 'boundary_link_id': 'C2-C1',
        'injects_boundary_mass': True, 'geometry': {'primary_direction': 'approaching',
        'counting_line': {'p1': [0.1, 0.5], 'p2': [0.9, 0.5]},
        'direction_vector': [0, 1], 'queue_roi': [[0, 0], [1, 0], [1, 1]]},
    }}}))
    processor = RecordedClipProcessor(tmp_path / 'out', config, model, [root], session_factory=factory,
        expected_model_sha256=hashlib.sha256(model.read_bytes()).hexdigest())
    return processor, clip, model, config


def test_registration_requires_authorized_clip_and_geometry(tmp_path):
    processor, clip, _, _ = setup_processor(tmp_path, lambda **_: None)
    with pytest.raises(ValueError, match='authorization'):
        processor.register('CAM-01', clip, '')
    with pytest.raises(ValueError, match='authorized root'):
        processor.register('CAM-01', tmp_path / 'other.mp4', 'rights recorded')
    with pytest.raises(FileNotFoundError):
        processor.register('CAM-01', clip.with_name('missing.mp4'), 'rights recorded')
    with pytest.raises(ValueError, match='configured camera'):
        processor.register('CAM-99', clip, 'rights recorded')
    registration = processor.register('CAM-01', clip, 'operator rights record')
    assert len(registration['clip_sha256']) == len(registration['geometry_sha256']) == 64
    assert registration['boundary_link_id'] == 'C2-C1'
    assert registration['status'] == 'registered'


def test_unverified_checkpoint_is_rejected(tmp_path):
    processor, clip, model, config = setup_processor(tmp_path, lambda **_: None)
    real_policy = RecordedClipProcessor(tmp_path / 'out', config, model, [clip.parent])
    with pytest.raises(ValueError, match='checkpoint SHA-256'):
        real_policy.register('CAM-01', clip, 'operator rights record')


def test_extracted_checkpoint_directory_is_rejected_clearly(tmp_path):
    processor, clip, _, config = setup_processor(tmp_path, lambda **_: None)
    extracted = tmp_path / 'best_xl_ITD_v1.2.pt'
    extracted.mkdir()
    (extracted / 'data.pkl').write_bytes(b'extracted archive member')
    folder_policy = RecordedClipProcessor(tmp_path / 'out', config, extracted, [clip.parent])
    with pytest.raises(ValueError, match='regular .pt file'):
        folder_policy.register('CAM-01', clip, 'operator rights record')


def test_processing_finalizes_identity_and_reuses_only_exact_cache(tmp_path):
    calls = []
    def factory(**kwargs):
        calls.append(kwargs)
        class Session:
            coverage={"status":"complete","requested_frames":10,"decoded_frames":10,"source_fps":1,"decoded_until_source_s":10}
            def process_stream(self, **_):
                yield Window(0, 5, 5.2, 0)
                yield Window(5, 10, 10.2, 3, 2, 'estimated_visible_region')
        return Session()
    processor, clip, model, config = setup_processor(tmp_path, factory)
    registration = processor.register('CAM-01', clip, 'operator rights record')
    fresh = processor.process(registration)
    assert fresh['status'] == 'complete' and fresh['processing_mode'] == 'online_inference'
    assert fresh['resource_measurements']['wall_s'] > 0
    assert fresh['resource_measurements']['fresh_inference_fps'] is None
    assert fresh['resource_measurements']['peak_ram_bytes'] > 0
    rows = [json.loads(line) for line in open(fresh['observations_path'])]
    assert [row['crossings_veh'] for row in rows] == [0, 3]
    assert all(row['validation_level'] == 'provisional_unreviewed' for row in rows)
    assert all(row['processed_at_utc'] and row['source_identity']['source_session_id'] for row in rows)
    assert all(row['source_identity']['clip_sha256'] == registration['clip_sha256'] for row in rows)
    assert all(row['boundary_link_id'] == 'C2-C1' for row in rows)
    assert processor.process(registration)['processing_mode'] == 'cached_observations'
    assert len(calls) == 1
    restarted = RecordedClipProcessor(tmp_path / 'out', config, model, [clip.parent], session_factory=factory,
        expected_model_sha256=processor.expected_model_sha256)
    assert restarted.process(restarted.register('CAM-01', clip, 'operator rights record'))['processing_mode'] == 'cached_observations'
    assert len(calls) == 1
    model.write_bytes(b'changed model bytes')
    restarted.expected_model_sha256 = hashlib.sha256(model.read_bytes()).hexdigest()
    changed = restarted.register('CAM-01', clip, 'operator rights record')
    assert restarted.process(changed)['processing_mode'] == 'online_inference'
    assert len(calls) == 2
    output = restarted.process(changed)['observations_path']
    rows = [json.loads(line) for line in open(output)]
    rows[0]['crossings_veh'] = 9
    with open(output, 'w') as destination:
        destination.writelines(json.dumps(row) + '\n' for row in rows)
    assert restarted.process(changed)['processing_mode'] == 'online_inference'
    assert len(calls) == 3


def test_second_fresh_job_is_rejected_while_inference_slot_is_occupied(tmp_path):
    second = None
    registration = None
    calls = []

    def factory(**_):
        calls.append('entered')
        with pytest.raises(RuntimeError, match='inference slot'):
            second.process(registration)
        class Session:
            coverage={"status":"complete","requested_frames":5,"decoded_frames":5,"source_fps":1,"decoded_until_source_s":5}
            def process_stream(self, **_):
                yield Window(0, 5, 5, 1)
        return Session()

    def second_factory(**_):
        calls.append('second entered')
        class Session:
            coverage={"status":"complete","requested_frames":5,"decoded_frames":5,"source_fps":1,"decoded_until_source_s":5}
            def process_stream(self, **_):
                yield Window(0, 5, 5, 1)
        return Session()

    first, clip, model, config = setup_processor(tmp_path, factory)
    second = RecordedClipProcessor(tmp_path / 'out', config, model, [clip.parent],
        session_factory=second_factory, expected_model_sha256=first.expected_model_sha256)
    registration = first.register('CAM-01', clip, 'operator rights record')
    assert first.process(registration)['status'] == 'complete'
    assert calls == ['entered']
    assert second.process(registration)['processing_mode'] == 'cached_observations'


@pytest.mark.parametrize('windows', [[], [Window(0, 5, 4, 1)], [Window(0, 5, 5, 1), Window(4, 9, 9, 2)]])
def test_failed_or_incomplete_processing_never_publishes_cache(tmp_path, windows):
    class Session:
        coverage={"status":"complete","requested_frames":5,"decoded_frames":5,"source_fps":1,"decoded_until_source_s":5}
        def process_stream(self, **_):
            yield from windows
    processor, clip, _, _ = setup_processor(tmp_path, lambda **_: Session())
    registration = processor.register('CAM-01', clip, 'operator rights record')
    with pytest.raises(ValueError):
        processor.process(registration)
    assert not list((tmp_path / 'out').rglob('*.jsonl'))
    assert json.loads(next((tmp_path / 'out').rglob('manifest.json')).read_text())['status'] == 'failed'


def test_compute_dependency_failure_is_recorded(tmp_path):
    def unavailable(**_): raise RuntimeError('detector unavailable')
    processor, clip, _, _ = setup_processor(tmp_path, unavailable)
    with pytest.raises(RuntimeError, match='detector unavailable'):
        processor.process(processor.register('CAM-01', clip, 'operator rights record'))
    manifest = json.loads(next((tmp_path / 'out').rglob('manifest.json')).read_text())
    assert manifest['status'] == 'failed'
    assert 'detector unavailable' in manifest['error']


def test_changed_clip_or_geometry_invalidates_registration(tmp_path):
    class Session:
        coverage={"status":"complete","requested_frames":5,"decoded_frames":5,"source_fps":1,"decoded_until_source_s":5}
        def process_stream(self, **_): yield Window(0, 5, 5, 1)
    processor, clip, _, config = setup_processor(tmp_path, lambda **_: Session())
    old = processor.register('CAM-01', clip, 'operator rights record')
    clip.write_bytes(b'changed authorized clip')
    with pytest.raises(ValueError, match='changed before processing'):
        processor.process(old)
    current = processor.register('CAM-01', clip, 'operator rights record')
    assert processor.process(current)['status'] == 'complete'
    data = json.loads(config.read_text())
    data['cameras']['CAM-01']['geometry']['counting_line']['p1'] = [.2, .5]
    config.write_text(json.dumps(data))
    with pytest.raises(ValueError, match='changed before processing'):
        processor.process(current)
    changed = processor.register('CAM-01', clip, 'operator rights record')
    assert changed['geometry_sha256'] != current['geometry_sha256']
    assert processor.process(changed)['processing_mode'] == 'online_inference'
