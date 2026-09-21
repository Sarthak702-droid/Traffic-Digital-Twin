"""Seeded aggregate boundary demand; no vehicle identities or route records."""
from __future__ import annotations

import math
import random


class BoundaryDemand:
    def __init__(self, config, index, scenario, seed):
        self.config, self.index, self.scenario = config, index, scenario
        self.rng = random.Random(seed)
        self.generated = {edge: 0.0 for edge in index.boundary_inputs}

    def _poisson(self, rate):
        # Knuth is deterministic and sufficient for the small per-second rates here.
        limit, k, product = math.exp(-rate), 0, 1.0
        while product > limit:
            k += 1
            product *= self.rng.random()
        return float(k - 1)

    def next(self, simulation_time_s):
        values = {}
        for edge in self.index.boundary_inputs:
            link = self.index.links[edge]
            feeder = link["from_node"] == self.scenario["route_node_ids"][0]
            rate = self.scenario["base_rate_vps"]
            if feeder:
                active = self.scenario["surge_start_s"] <= simulation_time_s < self.scenario["surge_end_s"]
                rate = self.scenario["surge_rate_vps"] if active else self.scenario["feeder_rate_vps"]
            value = self._poisson(rate) if simulation_time_s < self.scenario["demand_duration_s"] else 0.0
            self.generated[edge] += value
            values[edge] = value
        return values
