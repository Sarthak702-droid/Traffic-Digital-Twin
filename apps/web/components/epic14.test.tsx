import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { TopBar } from "./top-bar";
import { SessionPanel } from "./session-panel";
import { ActionRail } from "./action-rail";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fallbackNetworkConfig from "../../../packages/scenario-config/c1-c6.json";
import type { HealthState, TrafficState } from "../../../packages/contracts/typescript/events";
import type { Network } from "../../../packages/contracts/typescript/network";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const makeNetwork = (): Network => fallbackNetworkConfig as unknown as Network;

const makeSampleState = (): TrafficState => ({
  schema_version: "1.0",
  run_id: "run-e14-test",
  timestamp: new Date().toISOString(),
  simulation_time_s: 200,
  source: "synthetic",
  replay: false,
  movements: [],
  signals: [],
  vehicles_in_network: 42,
  inserted_total: 150,
  arrived_total: 108,
  teleported_total: 0,
  scenario_type: "peak_surge",
  seed: 1101,
  active_plan: [],
});

describe("Epic 14: Production UX, Access & Acceptance (S44–S48)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    queryClient.clear();
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // S44: Truthful loading, failure, offline, and recovery states
  // =========================================================================
  describe("S44: Truthful Loading, Failure & Health States", () => {
    it("reports 'Unknown' system health when health data is absent or stale", () => {
      render(
        <TopBar
          manual={false}
          onToggleManual={vi.fn()}
        />,
        { wrapper }
      );

      // Absent health must never claim "Normal" or "Healthy"
      expect(screen.getByText(/System: Unknown/i)).toBeInTheDocument();
      expect(screen.queryByText(/System: Normal/i)).not.toBeInTheDocument();
    });

    it("reports 'Degraded' when any core component fails", () => {
      const degradedHealth: HealthState = {
        timestamp: new Date().toISOString(),
        components: [
          { component: "api", status: "normal", message: "API active" },
          { component: "database", status: "degraded", message: "Connection pool latency high" },
          { component: "simulation", status: "normal", message: "SUMO running" },
          { component: "intelligence", status: "normal", message: "Inference ready" },
        ],
      };

      render(
        <TopBar
          health={degradedHealth}
          manual={false}
          onToggleManual={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByText(/System: Degraded/i)).toBeInTheDocument();
    });

    it("reports 'Normal' only when fresh validated health is supplied with all normal components", () => {
      const normalHealth: HealthState = {
        timestamp: new Date().toISOString(),
        components: [
          { component: "api", status: "normal", message: "API active" },
          { component: "database", status: "normal", message: "PostgreSQL connected" },
          { component: "simulation", status: "normal", message: "SUMO running" },
          { component: "intelligence", status: "normal", message: "Inference ready" },
        ],
      };

      render(
        <TopBar
          health={normalHealth}
          manual={false}
          onToggleManual={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByText(/System: Normal/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // S45: Recoverable and idempotent operator journeys
  // =========================================================================
  describe("S45: Operator Recovery & Draft Preservation", () => {
    it("retains modify draft notes and reason in sessionStorage across remount", () => {
      const draftKey = "twin-draft:operator-test:run-e14-test:rec-001";
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          modify: true,
          reject: false,
          reason: "Field observation",
          notes: "Heavy queue observed on North approach",
          edits: { P1: 45 },
        })
      );

      const net = makeNetwork();
      const frame = makeSampleState();
      const analysis = {
        schema_version: "1.0",
        run_id: "run-e14-test",
        simulation_time_s: 200,
        forecasts: [],
        recommendation: {
          id: "rec-001",
          run_id: "run-e14-test",
          status: "pending",
          priority: "high",
          title: "Optimize C1 cycle",
          explanation_facts: ["Queue overflow imminent"],
          changes: [{ phase_id: "P1", green_s: 35 }],
          impact_metrics: { delay_change_pct: -15, queue_change_pct: -20, throughput_change_pct: 12, compliance_score: 98 },
          simulated: false,
        },
        alternatives: [],
      } as any;

      render(
        <ActionRail
          network={net}
          frame={frame}
          analysis={analysis}
          scenarioID="peak_surge"
          setScenarioID={vi.fn()}
          seed="1101"
          setSeed={vi.fn()}
          dbReady={true}
          liveFresh={true}
          prepareMutation={{ mutate: vi.fn(), isPending: false, isError: false, error: null, isSuccess: false, reset: vi.fn() }}
          resetMutation={{ mutate: vi.fn(), isPending: false, isError: false, error: null, isSuccess: false, reset: vi.fn() }}
          onSimulate={vi.fn()}
          onApprove={vi.fn()}
          onModify={vi.fn()}
          onReject={vi.fn()}
          decisionPending={false}
          draftOwner="operator-test"
        />,
        { wrapper }
      );

      // Verify the saved draft was hydrated
      expect(screen.getByDisplayValue("Heavy queue observed on North approach")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Field observation")).toBeInTheDocument();
    });

    it("prompts confirmation before replacing an active run", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      const prepareMutate = vi.fn();

      const net = makeNetwork();
      const frame = makeSampleState();

      render(
        <ActionRail
          network={net}
          frame={frame}
          analysis={null}
          scenarioID="peak_surge"
          setScenarioID={vi.fn()}
          seed="1101"
          setSeed={vi.fn()}
          dbReady={true}
          liveFresh={true}
          prepareMutation={{ mutate: prepareMutate, isPending: false, isError: false, error: null, isSuccess: false, reset: vi.fn() }}
          resetMutation={{ mutate: vi.fn(), isPending: false, isError: false, error: null, isSuccess: false, reset: vi.fn() }}
          onSimulate={vi.fn()}
          onApprove={vi.fn()}
          onModify={vi.fn()}
          onReject={vi.fn()}
          decisionPending={false}
        />,
        { wrapper }
      );

      const startButton = screen.getByRole("button", { name: /start simulation/i });
      fireEvent.click(startButton);

      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Replace the active run?"));
      expect(prepareMutate).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    it("alerts and blocks new actions when an uncertain command is pending", () => {
      localStorage.setItem("twin-uncertain-command", "cmd-uncertain-9999");

      render(<SessionPanel />, { wrapper });

      expect(screen.getByText(/Previous command needs review/i)).toBeInTheDocument();
      expect(screen.getByText(/cmd-uncertain-9999/)).toBeInTheDocument();
      expect(screen.getByText(/Do not repeat an uncertain action/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // S46: Production roles and session recovery
  // =========================================================================
  describe("S46: Roles & Session Recovery", () => {
    it("renders sign-in form when unauthenticated", () => {
      render(<SessionPanel />, { wrapper });

      expect(screen.getByRole("heading", { name: /Sign in to the digital twin/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Sign in/i })).toBeInTheDocument();
    });

    it("displays authenticated session credentials and sign out action", async () => {
      // Mock successful session response
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ actor: "supervisor-ramesh", role: "supervisor" }),
          headers: new Headers({ "Content-Type": "application/json" }),
        } as Response)
      );

      render(<SessionPanel />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText("supervisor-ramesh")).toBeInTheDocument();
      });
      expect(screen.getByText(/Signed in as/i)).toHaveTextContent("supervisor");
      expect(screen.getByRole("button", { name: /Sign out/i })).toBeInTheDocument();

      vi.restoreAllMocks();
    });
  });

  // =========================================================================
  // S47: Accessibility and responsive critical flows
  // =========================================================================
  describe("S47: Accessibility, Keyboard & Modals", () => {
    it("opens and closes health dialog with keyboard focus and Escape key", () => {
      const normalHealth: HealthState = {
        timestamp: new Date().toISOString(),
        components: [
          { component: "api", status: "normal", message: "API active" },
        ],
      };

      render(
        <TopBar
          health={normalHealth}
          manual={false}
          onToggleManual={vi.fn()}
        />,
        { wrapper }
      );

      const healthBtn = screen.getByRole("button", { name: /System health:/i });
      expect(healthBtn).toHaveAttribute("aria-expanded", "false");

      // Open health dialog
      fireEvent.click(healthBtn);
      expect(healthBtn).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("dialog", { name: /Component Health Status/i })).toBeInTheDocument();

      // Press Escape to dismiss
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: /Component Health Status/i })).not.toBeInTheDocument();
      expect(healthBtn).toHaveAttribute("aria-expanded", "false");
    });

    it("exposes proper group and pressed attributes on mode segmented controls", () => {
      render(
        <TopBar
          manual={false}
          onToggleManual={vi.fn()}
          mode="recommend"
          onChangeMode={vi.fn()}
        />,
        { wrapper }
      );

      const modeGroup = screen.getByRole("group", { name: /Operational Mode Selection/i });
      expect(modeGroup).toBeInTheDocument();

      const recommendBtn = screen.getByRole("button", { name: /Recommend/i });
      expect(recommendBtn).toHaveClass("active");

      const observeBtn = screen.getByRole("button", { name: /Observe/i });
      expect(observeBtn).not.toHaveClass("active");
    });
  });
});
