"""Traffic-state provider protocol and provider factory."""
from __future__ import annotations

import os
from typing import Protocol


class TrafficStateProvider(Protocol):
    def reset(self, command): ...
    def step(self): ...
    def copy_state(self): ...
    def apply_plan(self, command): ...
    def start_clock(self): ...
    def stop(self): ...
    def close(self): ...


def build_engine(config_path=None, engine_kind=None, **kwargs):
    kind = (engine_kind or os.environ.get("TWIN_ENGINE", "aggregate")).strip().lower()
    if kind == "aggregate":
        from services.simulation.aggregate_engine import AggregateEngine
        return AggregateEngine(config_path=config_path, **kwargs)
    if kind == "replay":
        raise ValueError("Replay is published by the Go replay provider, not a simulation process")
    if kind == "sumo":
        raise ValueError("SUMO is not available in the default runtime profile")
    raise ValueError(f"Unsupported traffic engine: {kind}")
