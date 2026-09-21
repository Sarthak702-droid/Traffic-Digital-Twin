"""Simulator-neutral network configuration loading and immutable indexes."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "packages/scenario-config/c1-c6.json"


def load_config(path=None):
    config = json.loads(Path(path or DEFAULT_CONFIG).read_text())
    from services.simulation.safety import validate_config
    validate_config(config)
    return config


def config_hash(config) -> str:
    return hashlib.sha256(json.dumps(config, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True)
class NetworkIndex:
    nodes: dict
    links: dict
    movements: dict
    phases: dict
    movements_by_incoming: dict
    movements_by_outgoing: dict
    phases_by_node: dict
    boundary_inputs: tuple
    boundary_outputs: tuple

    @classmethod
    def build(cls, config):
        nodes = {v["id"]: v for v in config["nodes"]}
        links = {v["id"]: v for v in config["links"]}
        movements = {v["id"]: v for v in config["movements"]}
        phases = {v["id"]: v for v in config["phases"]}
        by_in, by_out, by_node = {}, {}, {}
        for movement in config["movements"]:
            by_in.setdefault(movement["incoming_link_id"], []).append(movement)
            by_out.setdefault(movement["outgoing_link_id"], []).append(movement)
        for phase in config["phases"]:
            by_node.setdefault(phase["node_id"], []).append(phase)
        inputs = tuple(k for k, v in links.items() if nodes[v["from_node"]]["kind"] == "boundary")
        outputs = tuple(k for k, v in links.items() if nodes[v["to_node"]]["kind"] == "boundary")
        return cls(nodes, links, movements, phases, by_in, by_out, by_node, inputs, outputs)
