import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { ActionRail } from "./action-rail";
import { networkSchema } from "@/lib/api";
import config from "../../../packages/scenario-config/c1-c6.json";
import type {
  Analysis,
  Recommendation,
  TimingChange,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const mockNetwork = networkSchema.parse(config);

const makeRec = (
  id = "rec-c1-c3-001",
  priority = "warning",
  reason = "Coordinated C1 clearance and C3 gating to mitigate spillback risk",
  changes: TimingChange[] = [
    { node_id: "C1", phase_id: "C1-FROM-C3", green_s: 40 },
    { node_id: "C1", phase_id: "C1-FROM-C2", green_s: 25 },
    { node_id: "C3", phase_id: "C3-FROM-C6", green_s: 25 },
    { node_id: "C3", phase_id: "C3-FROM-C1", green_s: 35 },
  ],
  facts: string[] = [
    "Trigger: spillback_risk (WARNING priority)",
    "Upstream corridor: Junction C3 platoon propagates to C1 via C3-C1 (ETA: ~22s)",
    "Coordinated timing: C1 (C1-FROM-C3: 40s) · C3 (C3-FROM-C6: 25s)",
    "120-second PN-MPC network cost: 142.50 across 6 bounded candidates",
    "Candidate alternative rank #1 of 3",
    "Human approval required; virtual digital twin signals only; model conservation-v2",
    "2 feasible alternatives scored and available for operator review",
  ]
): Recommendation => ({
  id,
  run_id: "run-e06-live",
  timestamp: "2026-09-17T00:00:00Z",
  priority,
  reason,
  changes,
  safety_status: "validated_safe",
  status: "pending",
  explanation_facts: facts,
});

const makeAlt = (
  id = "rec-c1-c3-alt1",
  c1Green = 35,
  c3Green = 20
): Recommendation => ({
  id,
  run_id: "run-e06-live",
  timestamp: "2026-09-17T00:00:00Z",
  priority: "normal",
  reason: `Feasible alternative: C1 (${c1Green}s) · C3 (${c3Green}s)`,
  changes: [
    { node_id: "C1", phase_id: "C1-FROM-C3", green_s: c1Green },
    { node_id: "C1", phase_id: "C1-FROM-C2", green_s: 65 - c1Green },
    { node_id: "C3", phase_id: "C3-FROM-C6", green_s: c3Green },
    { node_id: "C3", phase_id: "C3-FROM-C1", green_s: 60 - c3Green },
  ],
  safety_status: "validated_safe",
  status: "pending",
  explanation_facts: [
    "Trigger: corridor_coordination (NORMAL priority)",
    "Upstream corridor: Junction C3 platoon propagates to C1 via C3-C1 (ETA: ~22s)",
    "120-second PN-MPC network cost: 156.80 across 6 bounded candidates",
    "Candidate alternative rank #2 of 3",
    "Human approval required; virtual digital twin signals only; model conservation-v2",
  ],
});

const makeAnalysis = (
  rec: Recommendation | null = makeRec(),
  alternatives: Recommendation[] = [makeAlt("alt-1", 35, 20), makeAlt("alt-2", 45, 15)]
): Analysis => ({
  run_id: "run-e06-live",
  simulation_time_s: 60,
  forecasts: [
    {
      id: "fc-1",
      run_id: "run-e06-live",
      movement_id: "C3-C1-C2",
      horizon_s: 120,
      queue_veh: 22,
      occupancy_ratio: 0.88,
      arrivals_veh: 35,
      risk: "warning",
      spillback_eta_s: 85,
      model_version: "conservation-v2",
      explanation_facts: ["Projected spillback in 85s"],
    },
  ],
  recommendation: rec,
  alternatives,
});

describe("Epic 6: AGDA & Network Recommendations (S16, S17, S18, S19)", () => {
  const defaultProps = (analysis: Analysis | null = makeAnalysis()) => ({
    network: mockNetwork,
    frame: { run_id: "run-e06-live", replay: false, source: "synthetic" } as TrafficState,
    analysis,
    scenarioID: "peak_surge" as const,
    setScenarioID: vi.fn(),
    seed: "1101",
    setSeed: vi.fn(),
    dbReady: true,
    liveFresh: true,
    canAct: true,
    decisionPending: false,
    manualMode: false,
    prepareMutation: { mutate: vi.fn(), isPending: false, isError: false, error: null, isSuccess: false, reset: vi.fn() },
    resetMutation: { mutate: vi.fn(), isPending: false, isError: false, error: null, isSuccess: false, reset: vi.fn() },
    onSimulate: vi.fn(),
    onApprove: vi.fn(),
    onModify: vi.fn(),
    onReject: vi.fn(),
    onSelectAlternative: vi.fn(),
  });

  // Story S16 & S17: Coordinated candidate signal plans across C1 and C3
  it("Story S17: renders coordinated corridor plan card with C1 clearance and C3 metering", () => {
    render(<ActionRail {...defaultProps()} />);

    // Verify coordinated corridor card exists
    const corridorCard = screen.getByTestId("coordinated-corridor-card");
    expect(corridorCard).toBeInTheDocument();
    expect(screen.getByText(/COORDINATED NETWORK PLAN \(C1 \+ C3\)/i)).toBeInTheDocument();

    // Verify C1 downstream clearance and C3 upstream metering
    expect(screen.getByText(/C1 Downstream Clearance/i)).toBeInTheDocument();
    expect(within(corridorCard).getByText(/C1-FROM-C3: 40s/i)).toBeInTheDocument();
    expect(screen.getByText(/C3 Upstream Metering/i)).toBeInTheDocument();
    expect(within(corridorCard).getByText(/C3-FROM-C6: 25s/i)).toBeInTheDocument();

    // Verify transit delay
    expect(screen.getByText(/Platoon corridor transit delay ~22s/i)).toBeInTheDocument();
  });

  // Story S18: Simulate and score PN-MPC candidates with feasible alternatives
  it("Story S18: renders feasible candidate alternatives and allows operator selection", () => {
    const onSelectAlt = vi.fn();
    render(<ActionRail {...defaultProps()} onSelectAlternative={onSelectAlt} />);

    // Check alternatives section
    const altsSection = screen.getByTestId("feasible-alternatives");
    expect(altsSection).toBeInTheDocument();
    expect(screen.getByText(/FEASIBLE CANDIDATE ALTERNATIVES \(2\)/i)).toBeInTheDocument();

    // Verify both alternatives listed
    expect(screen.getByText("Alternative #1")).toBeInTheDocument();
    expect(screen.getByText("Alternative #2")).toBeInTheDocument();

    // Inspect Alternative #1
    const inspectBtns = screen.getAllByRole("button", { name: /inspect alternative/i });
    expect(inspectBtns.length).toBe(2);
    fireEvent.click(inspectBtns[0]);

    // Should inform parent through onSelectAlternative
    expect(onSelectAlt).toHaveBeenCalledWith(
      expect.objectContaining({ id: "alt-1" })
    );

    // Should render banner showing alternative inspection mode
    expect(screen.getByText(/Inspecting Alternative Candidate/i)).toBeInTheDocument();

    // Revert button restores primary plan
    const revertBtn = screen.getByRole("button", { name: /revert to recommended plan/i });
    fireEvent.click(revertBtn);
    expect(onSelectAlt).toHaveBeenCalledWith(null);
  });

  it("Story S18: displays explanatory notice when fewer than 2 alternatives exist", () => {
    const analysisWithOneAlt = makeAnalysis(makeRec(), [makeAlt("only-alt", 32, 22)]);
    render(<ActionRail {...defaultProps(analysisWithOneAlt)} />);

    expect(screen.getByText(/FEASIBLE CANDIDATE ALTERNATIVES \(1\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Fewer alternatives: only 1 candidate met configured bounds and safety constraints/i)
    ).toBeInTheDocument();
  });

  // Story S19: Traceable recommendation explanations from structured facts
  it("Story S19: renders traceable explanation facts without invented ML claims", () => {
    render(<ActionRail {...defaultProps()} />);

    // First fact is shown immediately in recommendation card
    expect(screen.getByText(/Trigger: spillback_risk \(WARNING priority\)/i)).toBeInTheDocument();

    // Expandable structured explanation facts
    const expandBtn = screen.getByRole("button", { name: /view structured explanation/i });
    fireEvent.click(expandBtn);

    // Verify structured facts appear
    expect(screen.getByText(/120-second PN-MPC network cost: 142.50 across 6 bounded candidates/i)).toBeInTheDocument();
    expect(screen.getByText(/Human approval required; virtual digital twin signals only; model conservation-v2/i)).toBeInTheDocument();
    expect(screen.getByText(/2 feasible alternatives scored and available for operator review/i)).toBeInTheDocument();
  });

  it("Story S19: displays truthful idle/manual state when recommendations are unavailable or suspended", () => {
    // 1. Manual mode
    const { rerender } = render(<ActionRail {...defaultProps()} manualMode={true} />);
    expect(screen.getByText(/MANUAL MODE ACTIVE/i)).toBeInTheDocument();
    expect(screen.getByText(/Autonomous recommendations suspended/i)).toBeInTheDocument();

    // 2. No recommendation
    const noRecAnalysis = makeAnalysis(null, []);
    rerender(<ActionRail {...defaultProps(noRecAnalysis)} manualMode={false} />);
    expect(screen.getByText(/No actionable recommendation is available/i)).toBeInTheDocument();
  });
});
