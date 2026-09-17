import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { TopBar } from "./top-bar";
import { KpiStrip } from "./kpi-strip";
import { ActionRail } from "./action-rail";
import { JunctionDrawerContent } from "./junction-drawer";
import { DgpPresentationModal } from "./dgp-presentation";
import { NetworkView } from "./network-view";
import { NetworkCanvas } from "./network-canvas";
import { networkSchema } from "@/lib/api";
import config from "../../../packages/scenario-config/c1-c6.json";
import type {
  Analysis,
  HealthState,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

afterEach(cleanup);

const mockNetwork = networkSchema.parse(config);

function makeSampleState(overrides: Partial<TrafficState> = {}): TrafficState {
  return {
    schema_version: "1.0",
    run_id: "test-run-123",
    timestamp: new Date().toISOString(),
    simulation_time_s: 45,
    source: "synthetic",
    movements: [
      {
        movement_id: "C3-C1-C2",
        queue_veh: 8,
        arrival_rate_vpm: 25.0,
        departure_rate_vpm: 15.0,
        avg_speed_kph: 22.4,
        occupancy_ratio: 0.65,
        downstream_capacity_veh: 60,
        current_phase_id: "C1-FROM-C3",
        waiting_age_s: 18.0,
        vehicle_count: 14,
        arrivals_total: 40,
        departures_total: 26,
        permission: "green",
      },
      {
        movement_id: "C6-C3-C1",
        queue_veh: 4,
        arrival_rate_vpm: 20.0,
        departure_rate_vpm: 18.0,
        avg_speed_kph: 31.0,
        occupancy_ratio: 0.40,
        downstream_capacity_veh: 85,
        current_phase_id: "C3-FROM-C6",
        waiting_age_s: 8.0,
        vehicle_count: 6,
        arrivals_total: 35,
        departures_total: 29,
        permission: "green",
      },
    ],
    signals: [
      {
        node_id: "C1",
        phase_id: "C1-FROM-C3",
        indication: "green",
        remaining_s: 14,
        permitted_movement_ids: ["C3-C1-C2"],
      },
      {
        node_id: "C3",
        phase_id: "C3-FROM-C6",
        indication: "amber",
        remaining_s: 3,
        permitted_movement_ids: ["C6-C3-C1"],
      },
    ],
    vehicles_in_network: 20,
    inserted_total: 75,
    arrived_total: 55,
    teleported_total: 0,
    scenario_type: "peak_surge",
    seed: 1101,
    active_plan: [],
    replay: false,
    ...overrides,
  };
}

function makeSampleAnalysis(): Analysis {
  return {
    run_id: "test-run-123",
    simulation_time_s: 45,
    forecasts: [
      {
        id: "fc-30",
        run_id: "test-run-123",
        movement_id: "C3-C1-C2",
        horizon_s: 30,
        queue_veh: 11.2,
        occupancy_ratio: 0.72,
        arrivals_veh: 14.5,
        risk: "warning",
        spillback_eta_s: 82,
        model_version: "conservation-v2",
        explanation_facts: [
          "Northbound platoon from C3 arriving at C1 in ~75s",
        ],
      },
      {
        id: "fc-60",
        run_id: "test-run-123",
        movement_id: "C3-C1-C2",
        horizon_s: 60,
        queue_veh: 14.8,
        occupancy_ratio: 0.88,
        arrivals_veh: 22.0,
        risk: "critical",
        spillback_eta_s: 82,
        model_version: "conservation-v2",
        explanation_facts: [
          "C1 storage projected to reach 88% capacity without intervention",
        ],
      },
      {
        id: "fc-300",
        run_id: "test-run-123",
        movement_id: "C3-C1-C2",
        horizon_s: 300,
        queue_veh: 16.0,
        occupancy_ratio: 0.92,
        arrivals_veh: 65.0,
        risk: "critical",
        spillback_eta_s: 82,
        model_version: "conservation-v2",
        explanation_facts: ["5-minute forward advisory"],
      },
    ],
    recommendation: {
      id: "rec-1",
      run_id: "test-run-123",
      timestamp: new Date().toISOString(),
      priority: "high",
      reason: "Extend C1 Northbound Green to Prevent Spillback",
      changes: [
        { node_id: "C1", phase_id: "C1-FROM-C3", green_s: 38 },
      ],
      safety_status: "Safety verified",
      status: "pending",
      explanation_facts: [
        "Adds +8s to C1 Phase 1, absorbing C3 northbound discharge platoon",
      ],
    },
    comparison: {
      run_id: "test-run-123",
      recommendation_id: "rec-1",
      baseline_max_queue_veh: 16.5,
      candidate_max_queue_veh: 11.2,
      baseline_avg_delay_s: 36.2,
      candidate_avg_delay_s: 22.4,
      initial_time_s: 45,
      model_version: "conservation-v2",
      baseline_spillback_s: 52,
      candidate_spillback_s: 0,
      baseline_stops_per_vehicle: 1.48,
      candidate_stops_per_vehicle: 0.86,
      horizon_s: 180,
      seed: 1101,
    },
    alternatives: [],
  };
}

const mockHealth: HealthState = {
  timestamp: new Date().toISOString(),
  components: [
    { component: "api", status: "normal", message: "Go API connected" },
    { component: "database", status: "normal", message: "PostgreSQL connected" },
    { component: "simulation", status: "normal", message: "SUMO active" },
    { component: "intelligence", status: "normal", message: "Conservation engine online" },
    { component: "signal_controller", status: "unavailable", message: "No live signal control" },
  ],
};

describe("Epic 3 S08: Product Shell & Disclosure", () => {
  it("renders operating mode disclosure chips and title in TopBar", () => {
    render(
      <TopBar
        health={mockHealth}
        manual={false}
        onToggleManual={() => {}}
      />,
    );

    expect(screen.getByText("DEMONSTRATION MODE")).toBeInTheDocument();
    expect(screen.getByText("SYNTHETIC DATA")).toBeInTheDocument();
    expect(screen.getByText("NO LIVE SIGNAL CONTROL")).toBeInTheDocument();
    expect(screen.getByText("START DGP DEMONSTRATION")).toBeInTheDocument();
    expect(screen.getByText(/System: Normal/)).toBeInTheDocument();
  });

  it("supports role selector in TopBar", () => {
    render(
      <TopBar
        health={mockHealth}
        manual={false}
        onToggleManual={() => {}}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Select user role" });
    expect(select).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "viewer" } });
    expect(select).toHaveValue("viewer");
  });

  it("renders and navigates 8-step DGP demonstration modal", () => {
    const onOpenChange = vi.fn();
    render(
      <DgpPresentationModal open={true} onOpenChange={onOpenChange} />,
    );

    expect(screen.getByText("Step 1 of 8")).toBeInTheDocument();
    expect(screen.getByText("Current Network State")).toBeInTheDocument();
    expect(screen.getByText("EXECUTIVE TAKEAWAY")).toBeInTheDocument();

    // Click next step
    const nextBtn = screen.getByRole("button", { name: /Next Step/ });
    fireEvent.click(nextBtn);

    expect(screen.getByText("Step 2 of 8")).toBeInTheDocument();
    expect(screen.getByText("Future Congestion Prediction")).toBeInTheDocument();
  });
});

describe("Epic 3 S09: Data-driven Animated Twin & 5 Summary KPIs", () => {
  it("renders exactly five summary KPIs matching PRD §8.1", () => {
    const frame = makeSampleState();
    const analysis = makeSampleAnalysis();

    render(<KpiStrip frame={frame} analysis={analysis} />);

    expect(screen.getByText("VEHICLES IN NETWORK")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument(); // in network count

    expect(screen.getByText("AVG SPEED")).toBeInTheDocument();
    expect(screen.getByText("AVG QUEUE")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL NODES")).toBeInTheDocument();
    expect(screen.getByText("PREDICTED SPILLBACK ETA")).toBeInTheDocument();
    expect(screen.getByText(/82s/)).toBeInTheDocument();
  });

  it("renders live speed, queue, and signal countdowns on NetworkCanvas", () => {
    const frame = makeSampleState();
    const onSelect = vi.fn();

    render(
      <NetworkCanvas
        network={mockNetwork}
        frame={frame}
        onSelect={onSelect}
      />,
    );

    // Controlled junction countdowns rendered
    expect(screen.getByText("14s")).toBeInTheDocument(); // C1 countdown
    expect(screen.getByText("3s")).toBeInTheDocument(); // C3 countdown
    // Link speed overlays rendered
    expect(screen.getByText("22 km/h")).toBeInTheDocument();
    // Queue badges rendered
    expect(screen.getByText("Q:8")).toBeInTheDocument();
  });

  it("renders ActionRail with highest priority alert, recommendation, and next issue", () => {
    const frame = makeSampleState();
    const analysis = makeSampleAnalysis();

    render(
      <ActionRail
        network={mockNetwork}
        frame={frame}
        analysis={analysis}
        scenarioID="peak_surge"
        setScenarioID={() => {}}
        seed="1101"
        setSeed={() => {}}
        dbReady={true}
        liveFresh={true}
        prepareMutation={{
          mutate: vi.fn(),
          isPending: false,
          isError: false,
          error: null,
          isSuccess: false,
          reset: vi.fn(),
        }}
        resetMutation={{
          mutate: vi.fn(),
          isPending: false,
          isError: false,
          error: null,
          isSuccess: false,
          reset: vi.fn(),
        }}
        onSimulate={vi.fn()}
        onApprove={vi.fn()}
        onModify={vi.fn()}
        onReject={vi.fn()}
        decisionPending={false}
      />,
    );

    expect(screen.getByTestId("priority-alert")).toBeInTheDocument();
    expect(screen.getByTestId("current-recommendation")).toBeInTheDocument();
    expect(screen.getByTestId("next-predicted-issue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simulate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve in Twin" })).toBeInTheDocument();
  });
});

describe("Epic 3 S10: Junction Intelligence Drawer & Horizons", () => {
  it("renders current state, forward horizon tabs, and spillback ETA for C1", () => {
    const frame = makeSampleState();
    const analysis = makeSampleAnalysis();
    const nodeC1 = mockNetwork.nodes.find((n) => n.id === "C1")!;

    render(
      <JunctionDrawerContent
        chosen={nodeC1}
        network={mockNetwork}
        frame={frame}
        analysis={analysis}
      />,
    );

    // Current signal countdown
    expect(screen.getByText("14s remaining")).toBeInTheDocument();

    // Horizon tabs: NOW, +30s, +1m, +2m, +5m
    expect(screen.getByRole("tab", { name: /NOW/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /\+30s/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /\+1m/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /\+2m/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /\+5m/ })).toBeInTheDocument();

    // Plain-language cause and spillback alert
    expect(screen.getByText(/Spillback ETA: 82 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/Why this is happening/)).toBeInTheDocument();

    // Recommendation impact and safety check
    expect(screen.getByText(/Proposed signal timing adjustment/)).toBeInTheDocument();
    expect(screen.getByText(/Min green \(15s\) guaranteed/)).toBeInTheDocument();

    // Switch horizon to +30s
    fireEvent.click(screen.getByRole("tab", { name: /\+30s/ }));
    expect(screen.getByText("Predicted Queue")).toBeInTheDocument();
    expect(screen.getByText("11.2 veh")).toBeInTheDocument();
  });
});

describe("Epic 3 Network Screen Before-vs-After Mode (PRD §8.4)", () => {
  it("switches to Before-vs-After split mode and displays the 4 outcome metrics", () => {
    const frame = makeSampleState();
    const analysis = makeSampleAnalysis();

    render(
      <NetworkView
        network={mockNetwork}
        frame={frame}
        analysis={analysis}
        onSelectNode={() => {}}
      />,
    );

    // Switch to Before vs After mode
    fireEvent.click(screen.getByRole("button", { name: /Before vs After Split Mode/ }));

    expect(screen.getByText("BASELINE STRATEGY")).toBeInTheDocument();
    expect(screen.getByText("CANDIDATE PLAN")).toBeInTheDocument();

    // Check all 4 mandated outcome metrics
    expect(screen.getByText("1. Maximum Queue")).toBeInTheDocument();
    expect(screen.getByText("2. Average Modeled Delay")).toBeInTheDocument();
    expect(screen.getByText("3. Spillback Occurrence")).toBeInTheDocument();
    expect(screen.getByText("4. Modeled Stops / Vehicle")).toBeInTheDocument();

    // Check net improvements
    expect(screen.getByText("100% Spillback Eliminated")).toBeInTheDocument();
  });
});
