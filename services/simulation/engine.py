"""Compatibility import for the default aggregate traffic engine."""
from services.simulation.aggregate_engine import AggregateEngine

Engine = AggregateEngine
__all__ = ["AggregateEngine", "Engine"]
