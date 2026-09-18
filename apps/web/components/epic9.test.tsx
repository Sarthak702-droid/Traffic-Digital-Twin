import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import config from "../../../packages/scenario-config/c1-c6.json";
import { networkSchema } from "@/lib/api";
import { IncidentRecoveryPanel, incidentRecovery } from "./incident-recovery-panel";
import type { TrafficState } from "../../../packages/contracts/typescript/events";

const network = networkSchema.parse(config);
const frame: TrafficState = {
  schema_version: "1.0", run_id: "incident-run", timestamp: "2026-09-18T00:00:00Z", simulation_time_s: 160, source: "synthetic", replay: false,
  scenario_type: "incident_c3", seed: 2202, signals: [], vehicles_in_network: 0, inserted_total: 0, arrived_total: 0, teleported_total: 0,
  active_plan: network.phases.map((phase) => ({ node_id: phase.node_id, phase_id: phase.id, green_s: 25 })),
  incident: { id: "incident", run_id: "incident-run", node_id: "C3", kind: "capacity_reduction", capacity_ratio: 0.35, status: "recovering", recovery_cycles: 2 },
  movements: [{ movement_id: "C6-C3-C1", queue_veh: 12, arrival_rate_vpm: 0, departure_rate_vpm: 12, avg_speed_kph: 15, occupancy_ratio: 0.5, downstream_capacity_veh: 20, current_phase_id: "C3-FROM-C6", waiting_age_s: 20, vehicle_count: 12, arrivals_total: 30, departures_total: 18, permission: "green" }],
};

describe("Epic 9: C3 incident and network recovery", () => {
  it("derives a queue-drain estimate from measured simulation values", () => {
    const recovery = incidentRecovery(network, frame);
    expect(recovery.affectedLinks).toContain("C6-C3");
    expect(recovery.estimateSeconds).toBe(60);
    expect(recovery.estimateCycles).toBeGreaterThan(0);
    expect(recovery.blocked).toBe(false);
  });

  it("shows controls and clearly distinguishes an observed estimate from the configured countdown", () => {
    render(<IncidentRecoveryPanel network={network} frame={frame} capacityRatio={0.35} onCapacityRatio={() => {}} onLaunch={() => {}} onReset={() => {}} canOperate pending={false} />);
    expect(screen.getByLabelText("Remaining C3 capacity")).toBeInTheDocument();
    expect(screen.getByText(/Actual remaining capacity/)).toBeInTheDocument();
    expect(screen.getByText(/Observed queue-drain estimate/)).toBeInTheDocument();
    expect(screen.getByText(/not a measured clearance guarantee/)).toBeInTheDocument();
  });
});
