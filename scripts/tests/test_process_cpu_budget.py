import importlib.util
from pathlib import Path
import pytest

spec=importlib.util.spec_from_file_location('process_clip_cli',Path(__file__).parents[1]/'process-recorded-clip.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def test_cpu_budget_limits_new_inference_workers_before_runtime_import(monkeypatch):
    seen=[]
    monkeypatch.setattr(module.os,'sched_getaffinity',lambda pid:{2,3,4,5,6,7})
    monkeypatch.setattr(module.os,'sched_setaffinity',lambda pid,cores:seen.append((pid,cores)))
    assert module.limit_cpu_cores(4)==[2,3,4,5]
    assert seen==[(0,{2,3,4,5})]
    with pytest.raises(ValueError):module.limit_cpu_cores(0)
    with pytest.raises(ValueError):module.limit_cpu_cores(7)
