import pytest
from scripts.benchmark_compute import resource_protocol


def test_resource_protocol_does_not_reuse_a_different_workstations_budget(tmp_path):
    import json
    path = tmp_path / 'budget.json'
    path.write_text(json.dumps({'target_cpu':'frozen CPU'}))
    with pytest.raises(ValueError, match='target machine'):
        resource_protocol(path, 'actual CPU')
    assert resource_protocol(path, 'frozen CPU')['target_cpu'] == 'frozen CPU'
