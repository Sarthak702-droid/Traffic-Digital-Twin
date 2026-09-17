import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { JunctionDrawerContent } from "./junction-drawer";
import { NetworkCanvas } from "./network-canvas";
import { NetworkView } from "./network-view";
import { networkSchema } from "@/lib/api";
import config from "../../../packages/scenario-config/c1-c6.json";
import type {
  Analysis,
  Forecast,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

afterEach(cleanup);

const mockNetwork = networkSchema.parse(config);

function makeForecast(overrides: Partial<Forecast> = {}): Forecast {
  return {
    id: "fc-1",
    run_id: "test-run",
    movement_id: "C3-C1-C2",
    horizon_s: 120,
    queue_veh: 18.5,
    occupancy_ratio: 0.88,
    arrivals_veh: 24.0,
    risk: "critical",
    spillback_eta_s: 104,
    model_version: "conservation-v2",
    explanation_facts: [
      "Upstream source: junction C3 via corridor C3-C1",
      "Projected arrivals: 24.0 veh over 120s horizon",
      "Storage occupancy: 88.0% (98.6/112 veh storage)",
      "Predicted spillback ETA: 104s before approach blockage",
      "Conservation-model simulation forecast",
    ],
    ...overrides,
  };
}

function makeAnalysis(forecasts: Forecast[]): Analysis {
  return {
    run_id: "test-run",
    simulation_time_s: 45,
    forecasts,
    recommendation: {
      id: "rec-1",
      run_id: "test-run",
      timestamp: new Date().toISOString(),
      priority: "warning",
      reason: "Clearance increase at C1 to prevent spillback",
      changes: [{ node_id: "C1", phase_id: "C1-FROM-C3", green_s: 35 }],
      safety_status: "requires_fresh_validation",
      status: "pending",
      explanation_facts: ["120-second weighted network cost: 42.10"],
    },
    alternatives: [],
    comparison: {
      run_id: "test-run",
      recommendation_id: "rec-1",
      baseline_max_queue_veh: 28.0,
      candidate_max_queue_veh: 14.0,
      baseline_avg_delay_s: 36.5,
      candidate_avg_delay_s: 22.1,
      initial_time_s: 45,
      model_version: "conservation-v2",
      baseline_spillback_s: 48,
      candidate_spillback_s: 0,
      baseline_stops_per_vehicle: 1.4,
      candidate_stops_per_vehicle: 0.8,
      horizon_s: 120,
      seed: 1101,
    },
  };
}

function makeSampleState(overrides: Partial<TrafficState> = {}): TrafficState {
  return {
    schema_version: "1.0",
    run_id: "test-run",
    timestamp: new Date().toISOString(),
    simulation_time_s: 30,
    source: "synthetic",
    movements: [],
    signals: [],
    vehicles_in_network: 15,
    inserted_total: 20,
    arrived_total: 5,
    teleported_total: 0,
    scenario_type: "peak_surge",
    seed: 1101,
    active_plan: [],
    replay: false,
    ...overrides,
  };
}

describe("Epic 4 (S11 & S12): Forecasts, Platoons & Spillback Intelligence", () => {
  it("Story S11: renders bounded forecasts across horizons with queue, storage and arrivals", () => {
    const fc30 = makeForecast({ horizon_s: 30, queue_veh: 6.2, occupancy_ratio: 0.35, arrivals_veh: 8.0, risk: "normal", spillback_eta_s: undefined });
    const fc60 = makeForecast({ horizon_s: 60, queue_veh: 12.4, occupancy_ratio: 0.55, arrivals_veh: 16.0, risk: "normal", spillback_eta_s: undefined });
    const fc120 = makeForecast({ horizon_s: 120, queue_veh: 18.5, occupancy_ratio: 0.88, arrivals_veh: 24.0, risk: "warning" });
    const fc300 = makeForecast({ horizon_s: 300, queue_veh: 22.1, occupancy_ratio: 0.94, arrivals_veh: 38.0, risk: "critical" });

    const analysis = makeAnalysis([fc30, fc60, fc120, fc300]);
    const c1Node = mockNetwork.nodes.find((n) => n.id === "C1")!;

    render(
      <JunctionDrawerContent
        chosen={c1Node}
        network={mockNetwork}
        frame={null}
        analysis={analysis}
      />,
    );

    // Click on +1m tab (60s)
    fireEvent.click(screen.getByRole("button", { name: "+1m" }));
    expect(screen.getByText("Predicted Queue")).toBeInTheDocument();
    expect(screen.getByText("12.4 veh")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
    expect(screen.getAllByText("16.0 veh").length).toBeGreaterThanOrEqual(1);

    // Click on +5m tab (300s)
    fireEvent.click(screen.getByRole("button", { name: "+5m" }));
    expect(screen.getByText("22.1 veh")).toBeInTheDocument();
    expect(screen.getByText("94%")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL RISK")).toBeInTheDocument();
  });

  it("Story S12: renders platoon arrival waveform with ETA tolerance and upstream source", () => {
    const fc120 = makeForecast({
      horizon_s: 120,
      arrivals_veh: 36.0,
      spillback_eta_s: 104,
      explanation_facts: [
        "Upstream source: junction C3 via corridor C3-C1",
        "Projected arrivals: 36.0 veh over 120s horizon",
        "Storage occupancy: 94.0% (105.0/112 veh storage)",
        "Predicted spillback ETA: 104s before approach blockage",
      ],
    });

    const analysis = makeAnalysis([fc120]);
    const c1Node = mockNetwork.nodes.find((n) => n.id === "C1")!;

    render(
      <JunctionDrawerContent
        chosen={c1Node}
        network={mockNetwork}
        frame={null}
        analysis={analysis}
      />,
    );

    // Switch to +2m horizon
    fireEvent.click(screen.getByRole("button", { name: "+2m" }));

    // Verify platoon waveform with ETA tolerance
    expect(screen.getByText(/Modeled arrivals/)).toBeInTheDocument();
    expect(screen.getAllByText("36.0 veh").length).toBeGreaterThanOrEqual(1);

    // Verify deterministic explanation facts include upstream source
    expect(screen.getByText("Upstream source: junction C3 via corridor C3-C1")).toBeInTheDocument();
    expect(screen.getByText("Predicted spillback ETA: 104s before approach blockage")).toBeInTheDocument();

    // Verify spillback alert box
    expect(screen.getByText("Spillback ETA: 104 seconds")).toBeInTheDocument();
  });

  it("Story S12: renders canvas spillback warning badge on corridor under risk", () => {
    const fc = makeForecast({
      movement_id: "C3-C1-C2",
      spillback_eta_s: 88,
      risk: "critical",
    });

    render(
      <NetworkCanvas
        network={mockNetwork}
        onSelect={() => {}}
        frame={makeSampleState()}
        forecasts={[fc]}
        horizon={120}
      />,
    );

    // Verify spillback badge is drawn on the canvas
    expect(screen.getByText(/⚠ SPILL 88s/)).toBeInTheDocument();
  });

  it("Story S11 & S12: NetworkView passes horizon forecasts and switches split mode", () => {
    const fc = makeForecast({ horizon_s: 60, queue_veh: 25.0 });
    const analysis = makeAnalysis([fc]);

    render(
      <NetworkView
        network={mockNetwork}
        frame={makeSampleState({ vehicles_in_network: 20 })}
        analysis={analysis}
        onSelectNode={() => {}}
      />,
    );

    // Click on +1m horizon button
    fireEvent.click(screen.getByRole("button", { name: "+60s" }));
    expect(screen.getByRole("button", { name: "+60s" })).toHaveAttribute("aria-pressed", "true");

    // Switch to Before vs After split mode
    fireEvent.click(screen.getByRole("button", { name: "Before vs After · Aggregate comparison" }));
    expect(screen.getByText("28.00")).toBeInTheDocument();
    expect(screen.getByText("14.00")).toBeInTheDocument();
  });
});
