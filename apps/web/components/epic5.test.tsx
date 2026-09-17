import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ActionRail, MANDATORY_REASONS } from "./action-rail";
import { TopBar } from "./top-bar";
import { JunctionDrawerContent } from "./junction-drawer";
import { networkSchema } from "@/lib/api";
import config from "../../../packages/scenario-config/c1-c6.json";
import type {
  Analysis,
  ComparisonResult,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

afterEach(()=>{cleanup();sessionStorage.clear()});

const mockNetwork = networkSchema.parse(config);

function makeAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    run_id: "test-run",
    simulation_time_s: 45,
    forecasts: [
      {
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
        explanation_facts: ["Projected arrivals: 24.0 veh over 120s horizon"],
      },
    ],
    recommendation: {
      id: "rec-101",
      run_id: "test-run",
      timestamp: new Date().toISOString(),
      priority: "warning",
      reason: "Optimize C1 corridor green splits to prevent queue spillback",
      changes: [
        { node_id: "C1", phase_id: "C1-EW", green_s: 30 },
      ],
      safety_status: "validated_safe",
      status: "pending",
      explanation_facts: ["Expected queue reduction: 35%"],
    },
    alternatives: [],
    comparison: null,
    ...overrides,
  };
}

const mockMutations = {
  prepareMutation: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    isSuccess: false,
    reset: vi.fn(),
  },
  resetMutation: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    isSuccess: false,
    reset: vi.fn(),
  },
};

describe("Epic 5: Safety Envelope & Human Authority (S13, S14, S15)", () => {
  describe("Story S13: Validate every candidate and application (Safety Bounds)", () => {
    it("renders bounds chips and validates within-bounds timing input", () => {
      const onModify = vi.fn();
      render(
        <ActionRail
          network={mockNetwork}
          frame={null}
          analysis={makeAnalysis()}
          scenarioID="peak_surge"
          setScenarioID={vi.fn()}
          seed="42"
          setSeed={vi.fn()}
          dbReady={true}
          liveFresh={true}
          prepareMutation={mockMutations.prepareMutation}
          resetMutation={mockMutations.resetMutation}
          onSimulate={vi.fn()}
          onApprove={vi.fn()}
          onModify={onModify}
          onReject={vi.fn()}
          decisionPending={false}
        />,
      );

      // Open Modify panel
      const modifyBtn = screen.getByRole("button", { name: /^modify$/i });
      fireEvent.click(modifyBtn);

      // Verify bounded modification header and checklist
      expect(screen.getByText("BOUNDED MODIFICATION")).toBeDefined();
      expect(screen.getByLabelText("Safety Envelope Verification")).toBeDefined();
      expect(screen.getByText("Configured min/max boundaries satisfied")).toBeDefined();
      expect(screen.getByText("Conflict matrix requires fresh server validation")).toBeDefined();

      // Check input for C1-EW
      const input = screen.getByLabelText("Green seconds C1-EW") as HTMLInputElement;
      expect(input).toBeDefined();
      expect(input.value).toBe("30");

      // Verify bounds are shown (C1-EW phase min 10, max 55)
      expect(screen.getByText(/Bounds: 10s–55s/)).toBeDefined();

      fireEvent.change(screen.getByLabelText("Modification reason category"), { target: { value: "Field observation" } });
      // Both a deliberate reason and valid bounds are required.
      const submitBtn = screen.getByRole("button", { name: /confirm modification & apply/i });
      expect(submitBtn.hasAttribute("disabled")).toBe(false);
    });

    it("disables modification submission and displays warning when out of bounds", () => {
      render(
        <ActionRail
          network={mockNetwork}
          frame={null}
          analysis={makeAnalysis()}
          scenarioID="peak_surge"
          setScenarioID={vi.fn()}
          seed="42"
          setSeed={vi.fn()}
          dbReady={true}
          liveFresh={true}
          prepareMutation={mockMutations.prepareMutation}
          resetMutation={mockMutations.resetMutation}
          onSimulate={vi.fn()}
          onApprove={vi.fn()}
          onModify={vi.fn()}
          onReject={vi.fn()}
          decisionPending={false}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /^modify$/i }));
      const input = screen.getByLabelText("Green seconds C1-EW");

      // Input excessive value (e.g. 75s when max is 55s)
      fireEvent.change(input, { target: { value: "75" } });

      // Out of bounds warning displayed
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText("Must be between 10s and 55s")).toBeDefined();

      // Submit button disabled
      const submitBtn = screen.getByRole("button", { name: /confirm modification & apply/i });
      expect(submitBtn.hasAttribute("disabled")).toBe(true);

      // Input too low value (e.g. 5s when min is 10s)
      fireEvent.change(input, { target: { value: "5" } });
      expect(screen.getByText("Must be between 10s and 55s")).toBeDefined();
      expect(submitBtn.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("Story S14: Support observe, recommend, and manual modes", () => {
    it("renders three-mode segmented control and triggers mode transitions", () => {
      const onChangeMode = vi.fn();
      render(
        <TopBar
          manual={false}
          onToggleManual={vi.fn()}
          mode="recommend"
          onChangeMode={onChangeMode}
        />,
      );

      const recBtn = screen.getByRole("button", { name: /recommend/i });
      const obsBtn = screen.getByRole("button", { name: /observe/i });
      const manBtn = screen.getByRole("button", { name: /manual/i });

      expect(recBtn).toBeDefined();
      expect(obsBtn).toBeDefined();
      expect(manBtn).toBeDefined();

      // Initially recommend is active
      expect(recBtn.className).toContain("active");

      // Click Observe
      fireEvent.click(obsBtn);
      expect(onChangeMode).toHaveBeenCalledWith("observe");

      // Click Manual
      fireEvent.click(manBtn);
      expect(onChangeMode).toHaveBeenCalledWith("manual");
    });

    it("displays manual authority alert banner and suspends automated recs in manual mode", () => {
      render(
        <ActionRail
          network={mockNetwork}
          frame={null}
          analysis={makeAnalysis()}
          scenarioID="peak_surge"
          setScenarioID={vi.fn()}
          seed="42"
          setSeed={vi.fn()}
          dbReady={true}
          liveFresh={true}
          prepareMutation={mockMutations.prepareMutation}
          resetMutation={mockMutations.resetMutation}
          onSimulate={vi.fn()}
          onApprove={vi.fn()}
          onModify={vi.fn()}
          onReject={vi.fn()}
          decisionPending={false}
          manualMode={true}
        />,
      );

      // Card header should reflect manual authority
      expect(screen.getByText("MANUAL AUTHORITY")).toBeDefined();

      // Manual banner should be visible
      const banner = screen.getByRole("status");
      expect(banner).toBeDefined();
      expect(screen.getByText("MANUAL MODE ACTIVE")).toBeDefined();
      expect(
        screen.getByText(/Autonomous recommendations suspended/i),
      ).toBeDefined();

      // Decision action buttons should not be rendered in manual mode
      expect(screen.queryByRole("button", { name: /^approve in twin$/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^simulate$/i })).toBeNull();
    });
  });

  describe("Story S15: Approve, modify, reject with audit & simulated comparison", () => {
    it("provides 4 decision actions: Simulate, Approve in Twin, Modify, Reject", () => {
      const onSimulate = vi.fn();
      const onApprove = vi.fn();

      render(
        <ActionRail
          network={mockNetwork}
          frame={null}
          analysis={makeAnalysis()}
          scenarioID="peak_surge"
          setScenarioID={vi.fn()}
          seed="42"
          setSeed={vi.fn()}
          dbReady={true}
          liveFresh={true}
          prepareMutation={mockMutations.prepareMutation}
          resetMutation={mockMutations.resetMutation}
          onSimulate={onSimulate}
          onApprove={onApprove}
          onModify={vi.fn()}
          onReject={vi.fn()}
          decisionPending={false}
        />,
      );

      const simBtn = screen.getByRole("button", { name: /simulate/i });
      const appBtn = screen.getByRole("button", { name: /approve in twin/i });
      const modBtn = screen.getByRole("button", { name: /^modify$/i });
      const rejBtn = screen.getByRole("button", { name: /^reject$/i });

      expect(simBtn).toBeDefined();
      expect(appBtn).toBeDefined();
      expect(modBtn).toBeDefined();
      expect(rejBtn).toBeDefined();

      fireEvent.click(simBtn);
      expect(onSimulate).toHaveBeenCalledTimes(1);

      fireEvent.click(appBtn);
      expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it("requires mandatory reason selection when modifying a recommendation", () => {
      const onModify = vi.fn();
      render(
        <ActionRail
          network={mockNetwork}
          frame={null}
          analysis={makeAnalysis()}
          scenarioID="peak_surge"
          setScenarioID={vi.fn()}
          seed="42"
          setSeed={vi.fn()}
          dbReady={true}
          liveFresh={true}
          prepareMutation={mockMutations.prepareMutation}
          resetMutation={mockMutations.resetMutation}
          onSimulate={vi.fn()}
          onApprove={vi.fn()}
          onModify={onModify}
          onReject={vi.fn()}
          decisionPending={false}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /^modify$/i }));

      // Mandatory reason selector should have all 9 reasons
      const reasonSelect = screen.getByLabelText("Modification reason category") as HTMLSelectElement;
      expect(reasonSelect).toBeDefined();
      expect(reasonSelect.options.length).toBe(MANDATORY_REASONS.length + 1);
      expect(reasonSelect.value).toBe("");
      expect(screen.getByRole("button", {name:/confirm modification & apply/i})).toBeDisabled();

      // Select Accident/obstruction
      fireEvent.change(reasonSelect, { target: { value: "Accident/obstruction" } });
      const notesInput = screen.getByLabelText("Modification details and justification");
      fireEvent.change(notesInput, { target: { value: "Lane blocked at North approach" } });

      // Change timing
      const input = screen.getByLabelText("Green seconds C1-EW");
      fireEvent.change(input, { target: { value: "35" } });

      // Submit
      fireEvent.click(screen.getByRole("button", { name: /confirm modification & apply/i }));
      expect(onModify).toHaveBeenCalledWith(
        "Accident/obstruction: Lane blocked at North approach",
        [{ node_id: "C1", phase_id: "C1-EW", green_s: 35 }],
      );
    });

    it("requires mandatory reason when rejecting a recommendation", () => {
      const onReject = vi.fn();
      render(
        <ActionRail
          network={mockNetwork}
          frame={null}
          analysis={makeAnalysis()}
          scenarioID="peak_surge"
          setScenarioID={vi.fn()}
          seed="42"
          setSeed={vi.fn()}
          dbReady={true}
          liveFresh={true}
          prepareMutation={mockMutations.prepareMutation}
          resetMutation={mockMutations.resetMutation}
          onSimulate={vi.fn()}
          onApprove={vi.fn()}
          onModify={vi.fn()}
          onReject={onReject}
          decisionPending={false}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));

      expect(screen.getByText("REJECTION REASON")).toBeDefined();

      const reasonSelect = screen.getByLabelText("Rejection reason category");
      fireEvent.change(reasonSelect, { target: { value: "Emergency vehicle" } });

      const notesInput = screen.getByLabelText("Rejection justification");
      fireEvent.change(notesInput, { target: { value: "Priority route cleared manually" } });

      fireEvent.click(screen.getByRole("button", { name: /confirm rejection/i }));
      expect(onReject).toHaveBeenCalledWith(
        "Emergency vehicle: Priority route cleared manually",
      );
    });

    it("renders all 4 PRD §8.4 outcome metrics in simulated comparison card", () => {
      const comparisonData: ComparisonResult = {
        run_id: "test-run",
        recommendation_id: "rec-101",
        model_version: "conservation-v2",
        initial_time_s: 45,
        horizon_s: 120,
        seed: 42,
        baseline_max_queue_veh: 28.4,
        candidate_max_queue_veh: 18.2,
        baseline_avg_delay_s: 34.6,
        candidate_avg_delay_s: 22.1,
        baseline_spillback_s: 45,
        candidate_spillback_s: 0,
        baseline_stops_per_vehicle: 1.85,
        candidate_stops_per_vehicle: 1.20,
      };

      const onClear = vi.fn();

      render(
        <ActionRail
          network={mockNetwork}
          frame={null}
          analysis={makeAnalysis()}
          scenarioID="peak_surge"
          setScenarioID={vi.fn()}
          seed="42"
          setSeed={vi.fn()}
          dbReady={true}
          liveFresh={true}
          prepareMutation={mockMutations.prepareMutation}
          resetMutation={mockMutations.resetMutation}
          onSimulate={vi.fn()}
          onApprove={vi.fn()}
          onModify={vi.fn()}
          onReject={vi.fn()}
          decisionPending={false}
          comparisonResult={comparisonData}
          onClearComparison={onClear}
        />,
      );

      // Verify comparison region
      const region = screen.getByRole("region", { name: "Simulated Comparison Outcome" });
      expect(region).toBeDefined();
      expect(screen.getByText("SIMULATED ROLLOUT COMPARISON")).toBeDefined();

      // Verify 4 outcome metrics
      expect(screen.getByText("Max Queue (veh)")).toBeDefined();
      expect(screen.getByText("Average Delay (s)")).toBeDefined();
      expect(screen.getByText("Spillback Duration (s)")).toBeDefined();
      expect(screen.getByText("Stops per Vehicle")).toBeDefined();

      // Check values
      expect(screen.getByText("28.4")).toBeDefined();
      expect(screen.getByText("18.2")).toBeDefined();
      expect(screen.getByText("34.6")).toBeDefined();
      expect(screen.getByText("22.1")).toBeDefined();
      expect(screen.getByText("45")).toBeDefined();
      expect(screen.getByText("0")).toBeDefined();
      expect(screen.getByText("1.85")).toBeDefined();
      expect(screen.getByText("1.20")).toBeDefined();

      // Check dismissal
      const dismissBtn = screen.getByRole("button", { name: "Dismiss comparison" });
      fireEvent.click(dismissBtn);
      expect(onClear).toHaveBeenCalledTimes(1);
    });
  });
});

describe("Epic 5 recovery regressions", () => {
  function props() { return {
    network:mockNetwork, frame:null, analysis:makeAnalysis(), scenarioID:"peak_surge" as const,
    setScenarioID:vi.fn(),seed:"1101",setSeed:vi.fn(),dbReady:true,liveFresh:true,
    ...mockMutations,onSimulate:vi.fn(),onApprove:vi.fn(),onModify:vi.fn(),onReject:vi.fn(),decisionPending:false,
    draftOwner:"operator-test",
  }; }
  it("retains failed edits across disabled recovery and remount, isolated by user", async () => {
    const p=props();p.onModify=vi.fn().mockRejectedValue(new Error("Writer unavailable; inspect saved command"));
    const view=render(<ActionRail {...p}/>);
    fireEvent.click(screen.getByRole("button",{name:/^modify$/i}));
    fireEvent.change(screen.getByLabelText("Modification reason category"),{target:{value:"Field observation"}});
    fireEvent.change(screen.getByLabelText("Modification details and justification"),{target:{value:"Keep this draft"}});
    fireEvent.change(screen.getByLabelText("Green seconds C1-EW"),{target:{value:"35"}});
    fireEvent.click(screen.getByRole("button",{name:/confirm modification & apply/i}));
    expect(await screen.findByText("Writer unavailable; inspect saved command")).toBeInTheDocument();
    view.rerender(<ActionRail {...p} canAct={false}/>);
    expect(screen.getByLabelText("Modification details and justification")).toHaveValue("Keep this draft");
    expect(screen.getByRole("button",{name:/confirm modification & apply/i})).toBeDisabled();
    view.unmount();
    const restored=render(<ActionRail {...p}/>);
    expect(screen.getByLabelText("Modification details and justification")).toHaveValue("Keep this draft");
    expect(screen.getByLabelText("Green seconds C1-EW")).toHaveValue(35);
    restored.unmount();
    render(<ActionRail {...p} draftOwner="different-operator"/>);
    expect(screen.queryByLabelText("Modification details and justification")).not.toBeInTheDocument();
  });
  it("does not submit a rejection without an explicit category, even with notes", () => {
    const p=props();render(<ActionRail {...p}/>);
    fireEvent.click(screen.getByRole("button",{name:/^reject$/i}));
    fireEvent.change(screen.getByLabelText("Rejection justification"),{target:{value:"Notes alone are insufficient"}});
    expect(screen.getByRole("button",{name:/confirm rejection/i})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:/confirm rejection/i}));
    expect(p.onReject).not.toHaveBeenCalled();
  });

  it("disables all action rail controls when canAct is false (e.g. Viewer role)", () => {
    const p = props();
    render(<ActionRail {...p} canAct={false} />);
    expect(screen.getByRole("button", { name: /simulate/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /approve in twin/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^modify$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeDisabled();
  });

  it("renders junction drawer locks, reflects active locks, and triggers toggle lock", () => {
    const onToggleLock = vi.fn();
    const chosenNode = mockNetwork.nodes.find((n) => n.id === "C1")!;
    render(
      <JunctionDrawerContent
        chosen={chosenNode}
        network={mockNetwork}
        frame={null}
        analysis={makeAnalysis()}
        activeLocks={["C1-FROM-C2"]}
        onToggleLock={onToggleLock}
        canLock={true}
      />,
    );

    // Should display timing locks section
    expect(screen.getByText("SAFETY ENVELOPE & TIMING LOCKS")).toBeDefined();
    expect(screen.getByText("Phase & Movement Locks")).toBeDefined();

    // Check active lock on C1-FROM-C2
    expect(screen.getByText("LOCKED")).toBeDefined();
    const unlockBtn = screen.getByRole("button", { name: /unlock phase C1-FROM-C2/i });
    expect(unlockBtn).toBeDefined();
    fireEvent.click(unlockBtn);
    expect(onToggleLock).toHaveBeenCalledWith("C1-FROM-C2", false);

    // Check unlocked phase C1-FROM-C3
    const lockBtn = screen.getByRole("button", { name: /lock phase C1-FROM-C3/i });
    expect(lockBtn).toBeDefined();
    fireEvent.click(lockBtn);
    expect(onToggleLock).toHaveBeenCalledWith("C1-FROM-C3", true);
  });

  it("disables junction drawer lock buttons when canLock is false", () => {
    const chosenNode = mockNetwork.nodes.find((n) => n.id === "C1")!;
    render(
      <JunctionDrawerContent
        chosen={chosenNode}
        network={mockNetwork}
        frame={null}
        analysis={makeAnalysis()}
        activeLocks={["C1-FROM-C2"]}
        onToggleLock={vi.fn()}
        canLock={false}
      />,
    );

    const unlockBtn = screen.getByRole("button", { name: /unlock phase C1-FROM-C2/i });
    expect(unlockBtn).toBeDisabled();
  });
});
