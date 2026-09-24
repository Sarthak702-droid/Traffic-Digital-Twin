import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { TopBar } from "./top-bar";
import { SessionPanel } from "./session-panel";
import { ActionRail } from "./action-rail";
import { ApiError, isEmergencyProtectionError, isStaleUncertainCommandError, request } from "@/lib/api";
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
          { component: "simulation", status: "normal", message: "Aggregate flow running" },
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
          { component: "simulation", status: "normal", message: "Aggregate flow running" },
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
    it("distinguishes an active uncertain command from an orphaned stale error", () => {
      const error = new ApiError("Outcome unknown", 409, "cmd-uncertain-1", true);

      expect(isStaleUncertainCommandError(error, "cmd-uncertain-1")).toBe(false);
      expect(isStaleUncertainCommandError(error, null)).toBe(true);
      expect(isStaleUncertainCommandError(new Error("ordinary failure"), null)).toBe(false);
      expect(isEmergencyProtectionError(new ApiError("Protected", 409, undefined, false, "EMERGENCY_PROTECTION_ACTIVE"))).toBe(true);
    });

    it("asks for credentials when no verified session exists", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ok:false,status:401,json:async()=>({message:"Sign in required"}),headers:new Headers()} as Response);
      render(<SessionPanel />, { wrapper });

      expect(await screen.findByLabelText(/Username/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Sign in/i })).toBeEnabled();
      vi.restoreAllMocks();
    });

    it("reports session service loss without presenting it as a bad password", async () => {
      vi.spyOn(globalThis,"fetch").mockResolvedValueOnce({ok:false,status:503,json:async()=>({message:"Session store unavailable"}),headers:new Headers()} as Response);
      render(<SessionPanel />, {wrapper});
      expect(await screen.findByText(/Session service unavailable/i)).toBeInTheDocument();
      vi.restoreAllMocks();
    });

    it("displays the verified identity and a sign-out action", async () => {
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
      expect(screen.getByText(/Authenticated session/i)).toHaveTextContent("supervisor");
      expect(screen.getByRole("button", { name: /Sign out/i })).toBeInTheDocument();

      vi.restoreAllMocks();
    });

    it("retains an uncertain command through session expiry and re-login without replaying it", async () => {
      localStorage.setItem("twin-uncertain-command", "cmd-expired-1001");
      queryClient.setQueryData(["runs"],[{id:"prior-session-run"}]);
      let signedIn = true;
      let commandAttempts = 0;
      const calls: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input); calls.push(`${init?.method || "GET"} ${url}`);
        if (url.endsWith("/session/login")) { signedIn = true; return {ok:true,status:200,json:async()=>({actor:"alice",role:"operator"}),headers:new Headers()} as Response; }
        if (url.endsWith("/session/logout")) { signedIn = false; return {ok:true,status:200,json:async()=>({success:true}),headers:new Headers()} as Response; }
        if (url.endsWith("/session")) return signedIn
          ? {ok:true,status:200,json:async()=>({actor:"alice",role:"operator"}),headers:new Headers()} as Response
          : {ok:false,status:401,json:async()=>({message:"Sign in required"}),headers:new Headers()} as Response;
        if (url.endsWith("/commands/cmd-expired-1001")) {
          if (commandAttempts++===0) { signedIn=false; return {ok:false,status:401,json:async()=>({message:"Session expired"}),headers:new Headers()} as Response; }
          return {ok:true,status:200,json:async()=>({status:"completed",response:{applied:true}}),headers:new Headers()} as Response;
        }
        throw Error(`Unexpected request ${url}`);
      });
      render(<SessionPanel />, { wrapper });
      expect(await screen.findByText("alice")).toBeInTheDocument();
      expect(await screen.findByLabelText(/Username/i)).toBeInTheDocument();
      expect(queryClient.getQueryData(["runs"])).toBeUndefined();
      expect(screen.getByText(/Previous command needs review/i)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/Username/i), {target:{value:"alice"}});
      fireEvent.change(screen.getByLabelText(/Password/i), {target:{value:"correct-test-password"}});
      fireEvent.click(screen.getByRole("button", {name:/Sign in/i}));
      expect(await screen.findByText("alice")).toBeInTheDocument();
      await waitFor(()=>expect(screen.getByText((_,element)=>element?.tagName==="P"&&!!element.textContent?.includes("cmd-expired-1001 · completed"))).toBeInTheDocument());
      expect(localStorage.getItem("twin-uncertain-command")).toBe("cmd-expired-1001");
      expect(calls.filter(call=>call.startsWith("POST "))).toEqual(["POST /api/v1/session/login"]);
      fireEvent.click(screen.getByRole("button", {name:/Sign out/i}));
      expect(await screen.findByLabelText(/Username/i)).toBeInTheDocument();
      expect(localStorage.getItem("twin-uncertain-command")).toBe("cmd-expired-1001");
      expect(calls.filter(call=>call.startsWith("POST "))).toEqual(["POST /api/v1/session/login","POST /api/v1/session/logout"]);
      vi.restoreAllMocks();
    });

    it("uses cookies and never sends browser role or actor headers", async () => {
      const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce({ok:false,status:401,json:async()=>({message:"Sign in required"}),headers:new Headers()} as Response);
      await expect(request("/mode/manual",{method:"POST",headers:{"X-Role":"supervisor","X-Actor":"forged"}})).rejects.toMatchObject({status:401});
      const init=fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.credentials).toBe("same-origin");
      expect(new Headers(init.headers).has("X-Role")).toBe(false);
      expect(new Headers(init.headers).has("X-Actor")).toBe(false);
      vi.restoreAllMocks();
    });

    it("blocks timing actions during emergency priority but still permits rejection", () => {
      const frame = {
        ...makeSampleState(),
        scenario_type: "ambulance_corridor",
        emergency: { id: "emergency-1", run_id: "run-e14-test", route_node_ids: ["C6", "C3", "C1", "C2"], status: "priority", eta_s: [0, 5, 20, 40], recovery_cycles_remaining: 2, vehicle_id: "ambulance" },
      } as TrafficState;
      const analysis = {
        run_id: frame.run_id,
        simulation_time_s: frame.simulation_time_s,
        forecasts: [],
        recommendation: { id: "rec-emergency", run_id: frame.run_id, timestamp: frame.timestamp, priority: "critical", reason: "Protected corridor timing", changes: [], safety_status: "requires_fresh_validation", status: "pending", explanation_facts: [] },
        alternatives: [],
      } as any;
      render(<ActionRail network={makeNetwork()} frame={frame} analysis={analysis} scenarioID="ambulance_corridor" setScenarioID={vi.fn()} seed="3303" setSeed={vi.fn()} dbReady={true} liveFresh={true} prepareMutation={{ mutate: vi.fn(), isPending: false, isError: false, error: null, isSuccess: false, reset: vi.fn() }} resetMutation={{ mutate: vi.fn(), isPending: false, isError: false, error: null, isSuccess: false, reset: vi.fn() }} onSimulate={vi.fn()} onApprove={vi.fn()} onModify={vi.fn()} onReject={vi.fn()} decisionPending={false} />);

      expect(screen.getByText(/Emergency signal protection is controlling this corridor/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /simulate/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /approve in twin/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /^modify$/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /^reject$/i })).toBeEnabled();
    });

    it("clears recovered command errors after the operator finishes review", async () => {
      localStorage.setItem("twin-uncertain-command", "cmd-reviewed-1001");
      const onReviewFinished = vi.fn();
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        const data = url.endsWith("/session")
          ? { actor: "demo-operator", role: "operator" }
          : { status: "completed", response: { applied: true } };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(data),
          headers: new Headers({ "Content-Type": "application/json" }),
        } as Response);
      });

      render(<SessionPanel onReviewFinished={onReviewFinished} />, { wrapper });

      const checkbox = await screen.findByLabelText(/I have checked the recorded outcome/i);
      fireEvent.click(checkbox);
      await waitFor(() => expect(screen.getByRole("button", { name: /Finish review/i })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: /Finish review/i }));

      expect(onReviewFinished).toHaveBeenCalledWith("cmd-reviewed-1001");
      expect(localStorage.getItem("twin-uncertain-command")).toBeNull();
      expect(screen.queryByText(/Previous command needs review/i)).not.toBeInTheDocument();
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
