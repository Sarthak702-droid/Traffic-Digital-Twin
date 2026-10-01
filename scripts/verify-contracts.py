#!/usr/bin/env python3
"""Audit and verify consistency across contracts, endpoints, schemas, and delivery plans."""

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

def check_file_exists_and_valid_json(rel_path: str):
    p = ROOT / rel_path
    assert p.exists(), f"Missing expected contract file: {rel_path}"
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        raise AssertionError(f"Failed to parse JSON in {rel_path}: {e}")

def main():
    print("Verifying repository contracts and endpoint consistency...")

    # 1. Verify contracts
    endpoint_ownership = check_file_exists_and_valid_json("packages/contracts/endpoint-ownership.json")
    openapi = check_file_exists_and_valid_json("packages/contracts/openapi.json")
    check_file_exists_and_valid_json("packages/contracts/events.schema.json")
    backlog = check_file_exists_and_valid_json("docs/backlog.json")
    delivery_status = check_file_exists_and_valid_json("docs/delivery-status.json")

    # 2. Check endpoints in endpoint-ownership vs openapi
    endpoints = endpoint_ownership.get("endpoints", [])
    ownership_routes = set()
    for row in endpoints:
        path = row["path"]
        method = row["method"].lower()
        owner = row.get("go_owner", "")
        assert owner, f"Missing Go owner for {method} {path}"
        ownership_routes.add((method, path))

    http_methods = {"get", "post", "put", "delete", "patch", "head", "options"}
    described = {(method.lower(), path) for path, methods in openapi.get("paths", {}).items()
                 for method in methods if method.lower() in http_methods}
    assert ownership_routes == described, f"Endpoint ownership differs from OpenAPI: missing={sorted(ownership_routes-described)} extra={sorted(described-ownership_routes)}"

    def check_refs(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "$ref" and child.startswith("#/"):
                    target = openapi
                    for part in child[2:].split("/"):
                        part = part.replace("~1", "/").replace("~0", "~")
                        assert part in target, f"Unresolved OpenAPI reference {child}"
                        target = target[part]
                else: check_refs(child)
        elif isinstance(value, list):
            for child in value: check_refs(child)
    check_refs(openapi)

    # 3. Check backlog vs delivery status
    total_stories = 0
    for epic in backlog.get("epics", []):
        for story in epic.get("stories", []):
            total_stories += 1
            sid = story["id"]
            assert sid in delivery_status["tasks"], f"Story {sid} missing from delivery-status.json"

    assert total_stories == len(delivery_status["tasks"]), f"Mismatch between backlog stories ({total_stories}) and delivery tasks ({len(delivery_status['tasks'])})"
    assert total_stories >= 45, f"Expected at least 45 stories, found {total_stories}"
    assert len(endpoints) >= 30, f"Expected >= 30 endpoints, found {len(endpoints)}"

    # These are static definitions, not evidence of active services or gate closure.
    graph_counts = []
    for name in ("c1-c6.json", "three-controlled-junctions.json"):
        graph = check_file_exists_and_valid_json("packages/scenario-config/" + name)
        ids = [node["id"] for node in graph["nodes"]]
        assert len(ids) == len(set(ids)), f"Duplicate configured node in {name}"
        graph_counts.append(len(ids))
    print(f"Static contracts verified: {total_stories} historical story IDs aligned, {len(endpoints)} endpoint descriptions match ownership, two graph definitions ({graph_counts}).")
    print("This check does not establish runtime or prototype acceptance.")

if __name__ == "__main__":
    main()
