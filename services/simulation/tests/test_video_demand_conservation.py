"""
Tests for Video-Derived Demand Adapter and Strict Mass Conservation.
PRD §13, §14; Tasks T08, T10.
"""

import pytest
from services.shared.network_config import NetworkIndex, load_config
from services.simulation.flow_kernel import step_cells
from services.simulation.video_demand import VideoProfileDemandProvider, CAMERA_TO_BOUNDARY_LINK


def test_video_demand_delayed_uniform_release_mass_conservation():
    provider = VideoProfileDemandProvider(
        observations_dir=".runtime/vision/observations",
        scale=1.0
    )

    total_offered = 0.0
    # Simulate discrete 1-second ticks for 30 seconds
    for t in range(1, 31):
        step_demand = provider.next(simulation_time_s=t, dt=1.0)
        total_offered += sum(step_demand.values())

    manifest = provider.export_manifest()
    total_profile = sum(b["total_profile_mass_veh"] for b in manifest["boundary_links"].values())

    # Total profile mass equals total offered mass plus pending unreleased mass
    pending = sum(b["pending_unreleased_mass_veh"] for b in manifest["boundary_links"].values())
    assert abs(total_profile - (total_offered + pending)) < 1e-6, "Mass conservation violated in delayed uniform release!"


def test_simulation_kernel_conserves_video_derived_demand():
    cfg = load_config()
    index = NetworkIndex.build(cfg)
    provider = VideoProfileDemandProvider(
        observations_dir=".runtime/vision/observations",
        scale=1.0
    )

    length = float(cfg.get("flow_model", {}).get("cell_length_m", 40))
    cells = {e: [0.0] * max(1, int(index.links[e]["length_m"] // length)) for e in index.links}
    backlogs = {e: 0.0 for e in index.boundary_inputs}
    capacity_ratios = {m: 1.0 for m in index.movements}
    permissions = set(index.movements.keys())  # all movements green

    initial_stock = sum(sum(v) for v in cells.values())
    cumulative_offered = 0.0
    cumulative_exits = 0.0

    for t in range(1, 25):
        ext_demand = provider.next(simulation_time_s=t, dt=1.0)
        cumulative_offered += sum(ext_demand.values())

        out = step_cells(index, cells, backlogs, ext_demand, permissions, capacity_ratios, dt=1.0)
        cumulative_exits += sum(out.exited.values())

    current_stock = sum(sum(v) for v in cells.values())
    current_backlogs = sum(backlogs.values())

    # Physical mass conservation identity:
    # initial_stock + cumulative_offered = current_stock + backlogs + cumulative_exits
    lhs = initial_stock + cumulative_offered
    rhs = current_stock + current_backlogs + cumulative_exits
    assert abs(lhs - rhs) < 1e-4, f"Physical conservation violated: LHS={lhs}, RHS={rhs}, diff={abs(lhs - rhs)}"
