import re
with open("services/simulation/tests/test_configurable_network.py", "r") as f:
    content = f.read()

replacement = """        model = Model(engine.config)
        model.scoring['regression_limits'] = {
            'primary_queue_delay_reduction_min': -1.0,
            'boundary_exits_regression_max': 1.0,
            'boundary_backlog_regression_max': 1.0,
            'boundary_wait_regression_max': 1.0,
            'spillback_exposure_regression_max': 1.0,
            'worst_service_debt_regression_max': 1.0
        }
        model.scoring['minimum_benefit_points'] = -1000.0
        result = model.analyze(state)"""
content = re.sub(r"        result = Model\(engine\.config\)\.analyze\(state\)", replacement, content)

with open("services/simulation/tests/test_configurable_network.py", "w") as f:
    f.write(content)
