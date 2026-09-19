import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import config from "../../../packages/scenario-config/c1-c6.json";
import { networkSchema } from "@/lib/api";
import { corridorRows, EmergencyCorridorPanel, emergencyStage } from "./emergency-corridor-panel";
import type { TrafficState } from "../../../packages/contracts/typescript/events";

const network = networkSchema.parse(config);
const frame: TrafficState = {
  schema_version: "1.0", run_id: "emergency-run", timestamp: "2026-09-18T00:00:00Z", simulation_time_s: 45, source: "synthetic", replay: false,
  scenario_type: "ambulance_corridor", seed: 3303, signals: [
    { node_id: "C3", phase_id: "C3-FROM-C6", indication: "green", remaining_s: 12, permitted_movement_ids: ["C6-C3-C1"] },
    { node_id: "C1", phase_id: "C1-FROM-C3", indication: "all_red", remaining_s: 2, permitted_movement_ids: [] },
  ], vehicles_in_network: 0, inserted_total: 0, arrived_total: 0, teleported_total: 0, incident: null, active_plan: [],
  emergency: { id: "event", run_id: "emergency-run", route_node_ids: ["C6", "C3", "C1", "C2"], status: "pre_clearance", eta_s: [0, 12, 35, 55], recovery_cycles_remaining: 1, vehicle_id: "ambulance" },
  movements: [{ movement_id: "C5-C1-C2", queue_veh: 8, arrival_rate_vpm: 0, departure_rate_vpm: 0, avg_speed_kph: 0, occupancy_ratio: 0.3, downstream_capacity_veh: 5, current_phase_id: "C1-FROM-C5", waiting_age_s: 20, vehicle_count: 8, arrivals_total: 8, departures_total: 0, permission: "red" }],
};

describe("Epic 10: emergency corridor", () => {
  it("accepts only the published emergency lifecycle stages", () => {
    expect(emergencyStage("priority")).toBe("priority");
    expect(emergencyStage("green-wave")).toBeNull();
  });

  it("marks boundaries as route points without inventing a signal", () => {
    const rows = corridorRows(network, frame);
    expect(rows.find((row) => row.nodeID === "C2")).toMatchObject({ kind: "boundary", signal: null });
  });

  it("renders live transition and bounded recovery evidence", () => {
    render(<EmergencyCorridorPanel network={network} frame={frame} canOperate pending={false} locked={false} onLaunch={() => {}} onReset={() => {}} />);
    expect(screen.getByText(/Reported between C6 and C3/)).toBeInTheDocument();
    expect(screen.getAllByText("Boundary route point")).toHaveLength(2);
    expect(screen.getByText(/green · 12s/)).toBeInTheDocument();
    expect(screen.getByText(/Configured recovery bound/)).toBeInTheDocument();
    expect(screen.getByText(/green → amber → all-red/)).toBeInTheDocument();
  });
});
