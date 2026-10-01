import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('verify_contracts',ROOT/'scripts/verify-contracts.py')
verify=importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


def test_verifier_rejects_an_owned_route_missing_from_openapi():
    def load(path):
        data=json.loads((ROOT/path).read_text())
        if path.endswith('openapi.json'):
            data['paths'].pop('/api/v1/runs/{id}/report')
        return data
    with patch.object(verify,'check_file_exists_and_valid_json',side_effect=load):
        with pytest.raises(AssertionError,match='ownership'):
            verify.main()


def test_verifier_does_not_require_historical_completion_as_runtime_evidence(capsys):
    def load(path):
        data=json.loads((ROOT/path).read_text())
        if path.endswith('delivery-status.json'):
            for task in data['tasks'].values(): task['status']='open'
        return data
    with patch.object(verify,'check_file_exists_and_valid_json',side_effect=load): verify.main()
    output=capsys.readouterr().out
    assert 'junctions active' not in output
    assert 'does not establish runtime or prototype acceptance' in output
