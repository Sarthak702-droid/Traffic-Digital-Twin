import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location('bootstrap',Path(__file__).parents[1]/'bootstrap-prototype.py')
bootstrap=importlib.util.module_from_spec(spec);spec.loader.exec_module(bootstrap)

def test_doctor_checks_active_npm_graph_not_uninstalled_foreign_platform_artifacts(tmp_path,monkeypatch):
    installed=tmp_path/'node_modules'/'active';installed.mkdir(parents=True)
    (installed/'package.json').write_text(json.dumps({'version':'1.0.0'}))
    (tmp_path/'package-lock.json').write_text(json.dumps({'packages':{'node_modules/active':{'version':'1.0.0'},'node_modules/unused-foreign':{'version':'2.0.0','optional':True,'os':['darwin']}}}))
    result=SimpleNamespace(returncode=0,stdout=str(tmp_path)+'\n'+str(installed)+'\n')
    monkeypatch.setattr(bootstrap.subprocess,'run',lambda *a,**kw:result)
    assert bootstrap.frontend_dependencies_match(tmp_path)
    (installed/'package.json').write_text(json.dumps({'version':'1.0.1'}))
    assert not bootstrap.frontend_dependencies_match(tmp_path)
    result.returncode=1 # npm detects a required dependency missing from active graph
    assert not bootstrap.frontend_dependencies_match(tmp_path)
