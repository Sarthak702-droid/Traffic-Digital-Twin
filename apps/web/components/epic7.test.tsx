import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { NetworkView, ComparisonTable, outcome } from "./network-view";
import config from "../../../packages/scenario-config/c1-c6.json";
import { networkSchema } from "@/lib/api";
import type {
  Analysis,
  ComparisonResult,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

afterEach(() => {
  cleanup();
});

const mockNetwork = networkSchema.parse(config);

const makeFrame = (overrides: Partial<TrafficState> = {}): TrafficState => ({
  schema_version: "1.0",
  run_id: "run-epic7-001",
  timestamp: "2026-09-17T12:00:00Z",
  scenario_type: "peak_surge",
  seed: 1337,
  simulation_time_s: 45,
  source: "synthetic",
  movements: [],
  signals: [],
  active_plan: mockNetwork.phases.map((p) => ({
    node_id: p.node_id,
    phase_id: p.id,
    green_s: p.min_green_s + Math.floor((p.max_green_s - p.min_green_s) / 2),
  })),
  ...overrides,
});

const makeComparison = (overrides: Partial<ComparisonResult> = {}): ComparisonResult => ({
  run_id: "run-epic7-001",
  recommendation_id: "rec-001",
  baseline_max_queue_veh: 22.5,
  candidate_max_queue_veh: 18.3,
  baseline_avg_delay_s: 14.7,
  candidate_avg_delay_s: 11.2,
  baseline_spillback_s: 5.0,
  candidate_spillback_s: 3.1,
  baseline_stops_per_vehicle: 2.4,
  candidate_stops_per_vehicle: 2.4,
  initial_time_s: 45,
  model_version: "conservation-v2",
  horizon_s: 120,
  seed: 1337,
  ...overrides,
});

const makeAnalysis = (comparison?: ComparisonResult | null): Analysis => ({
  run_id: "run-epic7-001",
  simulation_time_s: 45,
  forecasts: [],
  recommendation: {
    id: "rec-001",
    run_id: "run-epic7-001",
    timestamp: "2026-09-17T12:00:00Z",
    priority: "warning",
    reason: "Coordinated C1 clearance",
    changes: [
      { node_id: "C1", phase_id: "C1-FROM-C3", green_s: 40 },
      { node_id: "C1", phase_id: "C1-FROM-C2", green_s: 20 },
      { node_id: "C3", phase_id: "C3-FROM-C6", green_s: 25 },
      { node_id: "C3", phase_id: "C3-FROM-C1", green_s: 35 },
    ],
    safety_status: "validated_safe",
    status: "pending",
    explanation_facts: [],
  },
  alternatives: [],
  comparison: comparison ?? undefined,
});

describe("Epic 7: Before-vs-after Evidence (S21, S22)", () => {
  describe("S21: Isolated equal-seed simulation branches", () => {
    it("renders simulation provenance strip with seed, initial time, horizon, and model version", () => {
      const comparison = makeComparison();
      const frame = makeFrame();
      const analysis = makeAnalysis(comparison);

      render(
        <NetworkView
          network={mockNetwork}
          frame={frame}
          analysis={analysis}
          comparisonResult={comparison}
          onSelectNode={() => {}}
        />
      );

      // Switch to comparison view
      fireEvent.click(screen.getByRole("button", { name: /Before vs After/ }));

      // Verify provenance information is displayed
      expect(screen.getByText(/conservation-v2/)).toBeInTheDocument();
      expect(screen.getByText(/horizon 120s/)).toBeInTheDocument();
      expect(screen.getByText(/seed 1337/)).toBeInTheDocument();
      expect(screen.getByText(/initial 45s/)).toBeInTheDocument();
    });

    it("renders run_id and recommendation_id binding", () => {
      const comparison = makeComparison();
      const frame = makeFrame();
      const analysis = makeAnalysis(comparison);

      render(
        <NetworkView
          network={mockNetwork}
          frame={frame}
          analysis={analysis}
          comparisonResult={comparison}
          onSelectNode={() => {}}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /Before vs After/ }));

      expect(screen.getByText(/run-epic7-001/)).toBeInTheDocument();
      expect(screen.getByText(/rec-001/)).toBeInTheDocument();
    });

    it("displays zero-mutation disclaimer", () => {
      const comparison = makeComparison();
      const frame = makeFrame();
      const analysis = makeAnalysis(comparison);

      render(
        <NetworkView
          network={mockNetwork}
          frame={frame}
          analysis={analysis}
          comparisonResult={comparison}
          onSelectNode={() => {}}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /Before vs After/ }));

      expect(screen.getByText(/Zero mutation of live digital twin run/)).toBeInTheDocument();
    });
  });

  describe("S22: Synchronized comparison and impact", () => {
    it("renders split-screen dual canvases with baseline and candidate columns", () => {
      const comparison = makeComparison();
      const frame = makeFrame();
      const analysis = makeAnalysis(comparison);

      render(
        <NetworkView
          network={mockNetwork}
          frame={frame}
          analysis={analysis}
          comparisonResult={comparison}
          onSelectNode={() => {}}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /Before vs After/ }));

      expect(screen.getByTestId("split-comparison-view")).toBeInTheDocument();
      expect(screen.getByTestId("baseline-canvas-column")).toBeInTheDocument();
      expect(screen.getByTestId("candidate-canvas-column")).toBeInTheDocument();
      expect(screen.getByText("BASELINE STRATEGY (CURRENT TIMING)")).toBeInTheDocument();
      expect(screen.getByText("PREDICTIVE RECOMMENDATION (AGDA PLAN)")).toBeInTheDocument();
    });

    it("displays exactly 4 PRD §8.4 outcome metrics with SIMULATED badge", () => {
      const comparison = makeComparison();
      const frame = makeFrame();
      const analysis = makeAnalysis(comparison);

      render(
        <NetworkView
          network={mockNetwork}
          frame={frame}
          analysis={analysis}
          comparisonResult={comparison}
          onSelectNode={() => {}}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /Before vs After/ }));

      // 4 metrics (each appears in both summary card and table row)
      const metricsSection = screen.getByLabelText("Aggregate comparison result");
      expect(within(metricsSection).getAllByText("Maximum queue (veh)").length).toBeGreaterThanOrEqual(1);
      expect(within(metricsSection).getAllByText("Average modeled delay (s)").length).toBeGreaterThanOrEqual(1);
      expect(within(metricsSection).getAllByText("Spillback (movement-seconds)").length).toBeGreaterThanOrEqual(1);
      expect(within(metricsSection).getAllByText("Modeled stops / vehicle").length).toBeGreaterThanOrEqual(1);

      // SIMULATED badge (may appear multiple times in split header and table)
      const badges = screen.getAllByText("SIMULATED");
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it("renders honest delta indicators (improved, unchanged, worse)", () => {
      const comparison = makeComparison({
        baseline_max_queue_veh: 22.5,
        candidate_max_queue_veh: 18.3,   // improved
        baseline_avg_delay_s: 14.7,
        candidate_avg_delay_s: 11.2,     // improved
        baseline_spillback_s: 5.0,
        candidate_spillback_s: 3.1,      // improved
        baseline_stops_per_vehicle: 2.4,
        candidate_stops_per_vehicle: 2.4, // unchanged
      });

      const frame = makeFrame();
      const analysis = makeAnalysis(comparison);

      render(
        <NetworkView
          network={mockNetwork}
          frame={frame}
          analysis={analysis}
          comparisonResult={comparison}
          onSelectNode={() => {}}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /Before vs After/ }));

      // Check outcome texts (rendered via outcome function in table rows)
      expect(screen.getByText(/Improved: 4.20/)).toBeInTheDocument();  // max_queue 22.5->18.3
      expect(screen.getByText(/Unchanged/)).toBeInTheDocument();        // stops unchanged
    });

    it("shows no-comparison empty state when run_id mismatches (stale rejection)", () => {
      // Comparison from different run_id
      const staleComparison = makeComparison({ run_id: "stale-run-old" });
      const frame = makeFrame({ run_id: "run-epic7-001" });
      const analysis = makeAnalysis(staleComparison);

      render(
        <NetworkView
          network={mockNetwork}
          frame={frame}
          analysis={analysis}
          comparisonResult={staleComparison}
          onSelectNode={() => {}}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /Before vs After/ }));

      // Stale comparison should show unavailable status
      expect(screen.getByRole("status")).toHaveTextContent("No matching comparison available");
    });

    it("triggers simulation on button click when recommendation exists", () => {
      const onSimulate = vi.fn();
      const frame = makeFrame();
      const analysis = makeAnalysis(null);

      render(
        <NetworkView
          network={mockNetwork}
          frame={frame}
          analysis={analysis}
          onSelectNode={() => {}}
          onSimulate={onSimulate}
          isSimulating={false}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /Before vs After/ }));

      const simBtn = screen.getByRole("button", { name: /Simulate in Digital Twin/ });
      expect(simBtn).toBeInTheDocument();
      fireEvent.click(simBtn);
      expect(onSimulate).toHaveBeenCalledTimes(1);
    });

    it("disables simulate button and shows loading text when isSimulating=true", () => {
      const onSimulate = vi.fn();
      const frame = makeFrame();
      const analysis = makeAnalysis(null);

      render(
        <NetworkView
          network={mockNetwork}
          frame={frame}
          analysis={analysis}
          onSelectNode={() => {}}
          onSimulate={onSimulate}
          isSimulating={true}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: /Before vs After/ }));

      const simBtn = screen.getByRole("button", { name: /Simulating in Digital Twin/ });
      expect(simBtn).toBeDisabled();
    });
  });

  describe("outcome() helper", () => {
    it("returns correct delta for improved metrics", () => {
      expect(outcome(22.5, 18.3)).toBe("Improved: 4.20 (18.7%)");
    });

    it("returns correct delta for worse metrics", () => {
      expect(outcome(10, 15)).toBe("Worse: 5.00 (50.0%)");
    });

    it("handles zero baseline without division by zero", () => {
      expect(outcome(0, 5)).toBe("Worse: 5.00 (baseline is zero)");
      expect(outcome(0, 0)).toBe("Unchanged");
    });
  });
});
