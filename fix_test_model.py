import re
with open("services/intelligence/tests/test_model.py", "r") as f:
    content = f.read()

# restore to what it was
content = re.sub(r"    model=Model\(\);\n    model\.scoring.*model\.scoring\['minimum_benefit_points'\] = -1000\.0\n", "    model=Model();", content, flags=re.MULTILINE | re.DOTALL)

# split it properly
replacement = """    model=Model()
    model.scoring['regression_limits'] = {
        'primary_queue_delay_reduction_min': -1.0,
        'boundary_exits_regression_max': 1.0,
        'boundary_backlog_regression_max': 1.0,
        'boundary_wait_regression_max': 1.0,
        'spillback_exposure_regression_max': 1.0,
        'worst_service_debt_regression_max': 1.0
    }
    model.scoring['minimum_benefit_points'] = -1000.0
    state=pb.TrafficState(schema_version='1.0',run_id='unit',timestamp='2026-09-17T00:00:00Z',scenario_type='peak_surge',seed=1101,source='synthetic')"""
    
content = re.sub(r"    model=Model\(\);state=pb\.TrafficState\(schema_version='1\.0',run_id='unit',timestamp='2026-09-17T00:00:00Z',scenario_type='peak_surge',seed=1101,source='synthetic'\)", replacement, content)

with open("services/intelligence/tests/test_model.py", "w") as f:
    f.write(content)
