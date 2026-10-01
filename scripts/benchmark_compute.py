"""Measure serialized real aggregate simulation/candidate resources separately.

Run each mode in a fresh process. This tuning-only performance probe is neither
held-out accuracy/control evaluation nor continuous full-stack latency evidence.
"""
import argparse
import json
import math
import pathlib
import platform
import tempfile
import time

import twin_pb2 as pb
from services.intelligence.model import Model
from services.shared.network_config import ROOT, config_hash, load_config
from services.simulation.aggregate_engine import AggregateEngine
from services.vision.resource_probe import ProcessResourceProbe


def percentile95(values):
    return sorted(values)[max(0, math.ceil(.95 * len(values)) - 1)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['simulation', 'candidate_evaluation'], required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    protocol = json.loads((ROOT / 'packages/scenario-config/prototype-resource-budget-v1.json').read_text())
    budget = protocol[args.mode]
    cases, times = [], []
    probe = ProcessResourceProbe()
    try:
        for graph in protocol['graphs']:
            config = load_config(ROOT / 'packages/scenario-config' / graph)
            model = Model(config)
            for scenario in protocol['scenarios']:
                elapsed, outcomes = [], {}
                with tempfile.TemporaryDirectory(prefix='traffic-compute-') as directory:
                    engine = AggregateEngine(config_path=ROOT / "packages/scenario-config" / graph, directory=directory)
                    try:
                        state = engine.reset(pb.RunCommand(schema_version='1.0', run_id='resource-' + scenario,
                                                            scenario_type=scenario, seed=protocol['seed'], mode='recommend'))
                        for tick in range(budget.get('step_samples_per_scenario', budget.get('samples_per_scenario', 0) * 30)):
                            started = time.perf_counter()
                            state = engine.step()
                            if args.mode == 'simulation':
                                elapsed.append(time.perf_counter() - started)
                            elif (tick + 1) % 30 == 0:
                                started = time.perf_counter()
                                analysis = model.analyze(state)
                                elapsed.append(time.perf_counter() - started)
                                outcomes[analysis.outcome] = outcomes.get(analysis.outcome, 0) + 1
                    finally:
                        engine.close()
                times.extend(elapsed)
                cases.append({'graph': config['id'], 'config_hash': config_hash(config), 'scenario': scenario,
                              'samples': len(elapsed), 'p95_wall_s': percentile95(elapsed),
                              'max_wall_s': max(elapsed), 'analysis_outcomes': outcomes})
        resources = probe.result(None)
        resources["measurement_scope"] = "serialized compute process including snapshot setup; CPU sampled at 100ms; RSS process lifetime peak"
    finally:
        probe.close()
    limit = budget['step_p95_wall_s' if args.mode == 'simulation' else 'analysis_p95_wall_s']
    p95 = percentile95(times)
    result = {'schema_version': 'prototype-compute-resource-v1', 'protocol_version': protocol['version'],
              'mode': args.mode, 'python': platform.python_version(), 'budget': budget,
              'sample_scope': 'serialized real Python compute; source/seed tuning only; RSS process lifetime peak',
              'samples': len(times), 'p95_wall_s': p95, 'cases': cases, 'resources': resources,
              'within_budget': p95 <= limit and resources['peak_cpu_percent'] <= 100 * budget['peak_cpu_cores']
              and resources['peak_ram_bytes'] <= budget['peak_ram_bytes'],
              'full_stack_state_to_recommendation_p95': None}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ['mode', 'samples', 'p95_wall_s', 'resources', 'within_budget']}))


if __name__ == '__main__':
    main()
