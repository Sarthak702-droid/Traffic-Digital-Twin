"""Completion summaries must agree with their inspectable evidence."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def test_completion_summary_matches_its_declared_control_benchmark():
    report=json.loads((ROOT/'reports/audit-remediation-completion.json').read_text())
    summary=report['summary']['control_benchmark']
    benchmark=json.loads((ROOT/summary['artifact']).read_text())['virtual_control']
    for key in ('eligible_origins','improved_origins','gate_pass'):
        assert summary[key]==benchmark[key]
    fraction=benchmark['improved_origins']/benchmark['eligible_origins']
    assert summary['improved_fraction']==fraction
    assert summary['required_improved_fraction']==.5
    if not benchmark['gate_pass']:
        assert f"{benchmark['improved_origins']}/{benchmark['eligible_origins']}" in report['summary']['failed_gate']
        assert report['summary']['acceptance']=='incomplete'

def test_completion_status_totals_come_from_all_twenty_findings():
    report=json.loads((ROOT/'reports/audit-remediation-completion.json').read_text())
    assert len(report['items'])==20
    assert report['summary']['fixed']==sum(i['status']=='Fixed' for i in report['items'])
    assert report['summary']['partially_fixed']==sum(i['status']=='Partially Fixed' for i in report['items'])
