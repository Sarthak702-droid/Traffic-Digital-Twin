import pytest
from scripts.rehearse_prototype import select_sources


def test_select_sources_ignores_old_config_but_never_guesses_between_sessions():
    rows = [dict(camera_id='CAM-01', config_hash='old', status='cached_valid', source_session_id='old'),
            dict(camera_id='CAM-01', config_hash='current', status='cached_valid', source_session_id='a')]
    assert select_sources(rows, ['CAM-01'], 'current') == {'CAM-01': 'a'}
    rows.append({**rows[-1], 'source_session_id': 'b'})
    with pytest.raises(ValueError, match='exactly one'):
        select_sources(rows, ['CAM-01'], 'current')
    with pytest.raises(ValueError, match='exactly one'):
        select_sources(rows, ['CAM-02'], 'current')
