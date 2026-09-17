"use client";

import { useEffect, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Database,
  GitBranch,
  Layers,
  MapPin,
  Network as NetworkIcon,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  TrafficCone,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { getNetwork, request } from "@/lib/api";
import { useLive } from "@/lib/live";
import { LiveSummary } from "@/components/live-panel";
import { SessionPanel, useSession } from "@/components/session-panel";
import { comparisonSchema } from "@/lib/response-schemas";
import { useWorkspace } from "@/lib/state";
import { TopBar } from "@/components/top-bar";
import { KpiStrip } from "@/components/kpi-strip";
import { ActionRail } from "@/components/action-rail";
import { NetworkCanvas } from "@/components/network-canvas";
import { NetworkView } from "@/components/network-view";
import { JunctionDrawerContent } from "@/components/junction-drawer";
import { DgpPresentationModal } from "@/components/dgp-presentation";
import type {
  Network,
  Run,
  AuditRecord,
  Scenario,
} from "../../../packages/contracts/typescript/network";
import type {
  Analysis,
  ComparisonResult,
  HealthState,
  Recommendation,
  TimingChange,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

// Re-export NetworkCanvas for test and consumer compatibility
export { NetworkCanvas };

const sections = [
  { id: "command", label: "Command Center", icon: Layers },
  { id: "network", label: "Network / Junction Intelligence", icon: NetworkIcon },
  { id: "vision", label: "Vision Analytics", icon: Video },
  { id: "incidents", label: "Incidents", icon: TrafficCone },
  { id: "emergency", label: "Emergency", icon: Siren },
  { id: "audit", label: "Audit & Health", icon: ShieldCheck },
] as const;

type View = (typeof sections)[number]["id"];

const scenarioLabels: Record<Scenario["id"], string> = {
  peak_surge: "Peak demand surge",
  incident_c3: "C3 capacity reduction",
  ambulance_corridor: "Emergency corridor",
};

export function Workspace() {
  const live = useLive();
  const session = useSession();
  const [dirty, setDirty] = useState(false);
  const [online,setOnline]=useState(true);
  const [auditAfter,setAuditAfter]=useState(0);
  const [auditPages,setAuditPages]=useState<number[]>([]);
  const [view, setViewState] = useState<View>("command");
  const acceptedURL = useRef("");
  const setView=(next:View)=>{if(dirty&&!window.confirm("Discard unsent decision draft and change section?"))return;setDirty(false);setViewState(next);const url=new URL(location.href);url.searchParams.set("view",next);history.pushState(null,"",url);acceptedURL.current=url.href};
  useEffect(()=>{const read=()=>{const next=new URL(location.href).searchParams.get("view");if(sections.some(s=>s.id===next))setViewState(next as View);acceptedURL.current=location.href};read();const back=()=>{if(!dirty||window.confirm("Leave the unsent draft?")){setDirty(false);read()}else if(acceptedURL.current){history.pushState(null,"",acceptedURL.current)}};const connectivity=()=>setOnline(navigator.onLine);connectivity();window.addEventListener("popstate",back);window.addEventListener("online",connectivity);window.addEventListener("offline",connectivity);const leave=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue=""}};window.addEventListener("beforeunload",leave);return()=>{window.removeEventListener("popstate",back);window.removeEventListener("online",connectivity);window.removeEventListener("offline",connectivity);window.removeEventListener("beforeunload",leave)}},[dirty]);
  const [scenarioID, setScenarioID] = useState<Scenario["id"]>("peak_surge");
  const [seed, setSeed] = useState("1101");

  const {
    selectedNode,
    selectNode,
    role,
    dgpModalOpen,
    setDgpModalOpen,
    selectedHorizon,
  } = useWorkspace();

  const activeRole = session.isSuccess && !session.isError && session.data?.role ? session.data.role : role;
  const canWrite = activeRole !== "viewer";

  const client = useQueryClient();
  const network = useQuery({ queryKey: ["network"], queryFn: getNetwork, enabled: session.isSuccess && !session.isError });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => request<HealthState>("/health"),
    refetchInterval: 10000,
  });
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: () => request<Run[]>("/runs"),
  });
  const audit = useQuery({
    queryKey: ["audit", auditAfter],
    queryFn: () =>
      request<{ events: AuditRecord[]; next_after: number }>(`/audit?limit=50&after=${auditAfter}`),
    refetchInterval: 5000,
    enabled: view === "audit",
  });

  // Real-time analysis query (forecasts, recommendations, comparisons)
  const analysisQuery = useQuery({
    queryKey: ["analysis", live.frame?.run_id],
    queryFn: ({signal}) => request<Analysis>("/analysis", {signal}),
    enabled: live.fresh && session.isSuccess,
    refetchInterval: 2000,
    retry: false,
  });

  const analysis: Analysis | null =
    live.fresh && !analysisQuery.isError && analysisQuery.data && live.frame && analysisQuery.data.run_id === live.frame.run_id && live.frame.simulation_time_s - analysisQuery.data.simulation_time_s <= 10 && live.frame.simulation_time_s >= analysisQuery.data.simulation_time_s
      ? analysisQuery.data
      : null;

  // Retain the last identified recommendation during temporary auth/network loss.
  // It remains disabled because decisionReady is based only on fresh analysis.
  const draftAnalysis = useRef<Analysis | null>(null);
  if (analysis?.recommendation) draftAnalysis.current = analysis;
  if (live.frame && draftAnalysis.current?.run_id !== live.frame.run_id) draftAnalysis.current = null;
  const decisionAnalysis = analysis?.recommendation ? analysis : draftAnalysis.current;

  const [simulationComparison, setSimulationComparison] = useState<ComparisonResult | null>(null);
  const [selectedAlternative, setSelectedAlternative] = useState<Recommendation | null>(null);
  const modeQuery=useQuery({queryKey:["mode"],queryFn:()=>request<{mode:"recommend"|"observe"|"manual";locks:string[]}>("/mode"),refetchInterval:3000,enabled:session.isSuccess});
  const systemMode=modeQuery.data?.mode ?? "observe";
  const manual=systemMode==="manual";
  const unresolvedQuery = useQuery({
    queryKey: ["unresolved-decisions"],
    queryFn: () =>
      request<{
        unresolved: Array<{
          command_id: string;
          recommendation_id: string;
          actor: string;
          created_at: string;
          payload: any;
        }>;
      }>("/decisions/unresolved"),
    refetchInterval: 3000,
    enabled: session.isSuccess,
  });

  const resolveDecisionMutation = useMutation({
    mutationFn: ({
      commandId,
      recommendationId,
      resolution,
      reason,
    }: {
      commandId: string;
      recommendationId: string;
      resolution: string;
      reason?: string;
    }) =>
      request("/decisions/resolve", {
        method: "POST",
        body: JSON.stringify({
          command_id: commandId,
          recommendation_id: recommendationId,
          resolution,
          reason,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["unresolved-decisions"] });
      client.invalidateQueries({ queryKey: ["analysis"] });
      client.invalidateQueries({ queryKey: ["audit"] });
      try {
        localStorage.setItem("twin-action-sync", Date.now().toString());
      } catch {}
    },
  });

  useEffect(() => {
    const refreshAll = () => {
      client.invalidateQueries({ queryKey: ["audit"] });
      client.invalidateQueries({ queryKey: ["mode"] });
      client.invalidateQueries({ queryKey: ["locks"] });
      client.invalidateQueries({ queryKey: ["analysis"] });
      client.invalidateQueries({ queryKey: ["unresolved-decisions"] });
    };
    window.addEventListener("audit-updated", refreshAll);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "twin-action-sync") refreshAll();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("audit-updated", refreshAll);
      window.removeEventListener("storage", onStorage);
    };
  }, [client]);

  // Decision mutation (Story S15 & S18: Simulate, Approve, Modify, Reject across primary or alternatives)
  const decision = useMutation({
    mutationFn: async ({
      action,
      reason,
      changes,
    }: {
      action: string;
      reason?: string;
      changes?: TimingChange[];
    }) => {
      const rec = selectedAlternative || analysis?.recommendation;
      if (!rec || !canWrite || !live.fresh || live.frame?.replay || modeQuery.isError || systemMode!=="recommend") throw Error("Fresh authorized recommendation required");
      return {
        action,
        result: await request<ComparisonResult>(
          `/recommendations/${rec.id}/${action}`,
          {
            method: "POST",
            body: JSON.stringify({
              reason: reason || "Operator applied in digital twin",
              ...(action === "modify" && changes ? { changes } : {}),
            }),
          },
        ),
      };
    },
    onSuccess: (data) => {
      if (data.action === "simulate") {
        setSimulationComparison(comparisonSchema.parse(data.result));
      } else {
        setSimulationComparison(null);
      }
      client.invalidateQueries({ queryKey: ["analysis"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  // Manual / System mode toggle mutations (Story S14)
  const modeMutation = useMutation({
    mutationFn: () =>
      request<{ mode: string }>(`/mode/${manual ? "recommend" : "manual"}`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: (data) => {
      client.invalidateQueries({queryKey:["mode"]});
      setSimulationComparison(null);
      client.invalidateQueries({ queryKey: ["analysis"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  const changeModeMutation = useMutation({
    mutationFn: async (targetMode: "recommend" | "observe" | "manual") => {
      return request<{ mode: string }>(`/mode/${targetMode}`, {
        method: "POST",
        body: "{}",
      });
    },
    onSuccess: (data) => {
      const m = (data.mode === "manual" ? "manual" : data.mode === "observe" ? "observe" : "recommend") as "recommend" | "observe" | "manual";
      client.invalidateQueries({queryKey:["mode"]});
      setSimulationComparison(null);
      client.invalidateQueries({ queryKey: ["analysis"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  const prepare = useMutation({
    mutationFn: () =>
      request<Run>(`/scenarios/${scenarioID}/start`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "1.0",
          seed: Number(seed),
          mode: systemMode,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["runs"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  const reset = useMutation({
    mutationFn: () =>
      request<Run>("/scenarios/reset", { method: "POST", body: "{}" }),
    onSuccess: () => {
      prepare.reset();
      client.invalidateQueries({ queryKey: ["runs"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  const data = network.data;
  const chosen = data?.nodes.find((n) => n.id === selectedNode);
  const dbReady = !health.isError && !modeQuery.isError && canWrite && online && health.data?.components.some(
    (c) => c.component === "database" && c.status === "normal",
  );

  const replay=useMutation({mutationFn:()=>request(`/replay/${scenarioID}`,{method:"POST",body:"{}"}),onSuccess:()=>{setSimulationComparison(null);client.invalidateQueries()}});
  const lock=useMutation({mutationFn:({target,locked}:{target:string;locked:boolean})=>request(`/locks/${target}`,{method:locked?"POST":"DELETE",body:"{}"}),onSuccess:()=>client.invalidateQueries()});
  const anyCommandPending=decision.isPending||modeMutation.isPending||changeModeMutation.isPending||prepare.isPending||reset.isPending||replay.isPending||lock.isPending||resolveDecisionMutation.isPending;
  const decisionReady=!!analysis && live.fresh && !live.frame?.replay && !!dbReady && systemMode==="recommend" && canWrite && !anyCommandPending;
  const refresh = () => {
    client.invalidateQueries();
  };

  return (
    <div className="app-shell">
      {/* Primary Sidebar (Story S08: Only 6 Primary Sections) */}
      <aside className="app-sidebar">
        <a href="/" className="wordmark">
          <span className="logo">
            <GitBranch size={22} />
          </span>
          <span>
            TRAFFIC<span className="wordmark-sub">DIGITAL TWIN</span>
          </span>
        </a>

        <div className="sidebar-label">OPERATIONS</div>
        <nav aria-label="Primary navigation">
          {sections.map((section) => (
            <button
              key={section.id}
              className={view === section.id ? "nav-item selected" : "nav-item"}
              aria-current={view === section.id ? "page" : undefined}
              onClick={() => setView(section.id)}
            >
              <section.icon size={18} />
              <span>{section.label}</span>
              {view === section.id && <ChevronRight size={14} />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <ShieldCheck size={20} />
          <strong>
            Human authority.
            <br />
            By design.
          </strong>
          <p>Every signal recommendation requires operator authorization.</p>
          <div className="environment">
            <span />
            LOCAL DEMONSTRATION
          </div>
        </div>
      </aside>

      {/* Main Operational Container */}
      <div className="app-main">
        {/* TopBar with Chips, Health, Clock, Role Switcher, and DGP Launcher (Story S08, S14) */}
        <TopBar
          health={health.isError ? undefined : health.data}
          manual={manual}
          mode={systemMode}
          onChangeMode={(m) => changeModeMutation.mutate(m)}
          onToggleManual={() => modeMutation.mutate()}
          isPendingManual={anyCommandPending || !canWrite || !live.frame || live.frame.replay || !online}
        />

        {/* Prominent Disclosure Banner */}
        <div className="disclosure" role="region" aria-label="Operating Mode Disclosure">
          <ShieldCheck size={14} />
          <span>
            DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL
          </span>
        </div>

        <main className="product-content">
          <SessionPanel/>
          {!online&&<p role="alert">Offline. Measurements may be stale; commands are disabled.</p>}
          {network.data?.provenance==="bundled-offline"&&<p role="alert">Bundled offline topology only. This configuration is not a live service response.</p>}
          {(decision.error||modeMutation.error||changeModeMutation.error||replay.error||lock.error)&&<p className="form-error" role="alert">{(decision.error||modeMutation.error||changeModeMutation.error||replay.error||lock.error)?.message}</p>}
          {decision.isSuccess&&<p role="status">{decision.data.action} acknowledged. Inspect the returned plan and audit; accepted timing waits for its safe phase boundary.</p>}
          {!analysis&&live.frame&&<p role="status">Fresh intelligence unavailable. Forecasts and decisions are disabled until recovery.</p>}

          {/* Role-Specific Executive / Supervisor Banner */}
          {role === "viewer" && (
            <div className="role-banner viewer-banner" role="status">
              <div>
                <strong>EXECUTIVE BRIEFING MODE (DGP / SENIOR LEADERSHIP)</strong>
                <p>
                  High-level outcome visualization. Deterministic simulation proof of concept. No live physical signal actuation.
                </p>
              </div>
              <Button
                variant="default"
                className="dgp-launch-button"
                onClick={() => setDgpModalOpen(true)}
              >
                <Sparkles size={14} /> Open Briefing Slides
              </Button>
            </div>
          )}

          {role === "supervisor" && (
            <div className="role-banner supervisor-banner" role="status">
              <div>
                <strong>SUPERVISOR OVERSIGHT MODE</strong>
                <p>
                  Inspect configured timing bounds, current safety results and persisted audit outcomes. Missing evidence is unavailable.
                </p>
              </div>
              <span className="safety-pill">
                <Check size={12} /> Review current safety evidence
              </span>
            </div>
          )}

          {/* Page Heading Row */}
          <div className="page-heading">
            <div>
              <div className="overline">
                {view === "command"
                  ? "COMMAND CENTER / JUNCTION INTELLIGENCE"
                  : view === "network"
                    ? "NETWORK TOPOLOGY & SIMULATION"
                    : view === "audit"
                      ? "SYSTEM AUDIT & COMPONENT HEALTH"
                      : "NETWORK OPERATIONS"}
              </div>
              <h1>{sections.find((s) => s.id === view)?.label}</h1>
              <p>
                {view === "command"
                  ? "Real-time twin state, forward horizons, predictive alerts, and operator actions."
                  : view === "network"
                    ? "Full connected C1–C6 corridor with before-and-after digital twin rollouts."
                    : view === "audit"
                      ? "Durable audit record in PostgreSQL with component availability."
                      : view === "vision"
                        ? "Computer vision edge pipeline demonstration."
                        : "One connected network. Continuous deterministic simulation."}
              </p>
            </div>
            <Button variant="outline" onClick={refresh}>
              <RefreshCw
                size={15}
                className={network.isFetching ? "spin" : ""}
              />{" "}
              Refresh
            </Button>
          </div>

          {network.isPending ? (
            <div className="loading-panel" role="status">
              <div className="skeleton" />
              <p>Loading network configuration…</p>
            </div>
          ) : network.isError ? (
            <div className="error-panel" role="alert">
              <Radio size={24} />
              <h2>Network configuration unavailable</h2>
              <p>{network.error.message}</p>
              <p>Start the local Go API and try again.</p>
              <Button onClick={() => network.refetch()}>
                Retry connection
              </Button>
            </div>
          ) : (
            data && (
              <>
                {/* 1. COMMAND CENTER VIEW */}
                {view === "command" && (
                  <>
                    {/* Status Pill */}
                    <div className="workspace-status">
                      <span className="status-pill">
                        <Check size={13} /> {data.provenance === "bundled-offline" ? "Bundled topology" : "Configuration validated"}
                      </span>
                      <span>
                        <span
                          className={`status-dot ${live.fresh ? "" : "unknown"}`}
                        />{" "}
                        {live.fresh
                          ? "Live synthetic traffic · 1 Hz"
                          : live.frame
                            ? "Traffic stream stale / disconnected"
                            : "Start a scenario to receive traffic"}
                      </span>
                      <span className="config-version">{data.id}</span>
                    </div>

                    {/* Operations Grid: 8-column Canvas + 4-column Action Rail */}
                    <div className="operations-grid">
                      <section className="network-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>C1–C6 Network Twin</h2>
                            <span>
                              Directed links · {data.nodes.length} nodes ·{" "}
                              {data.links.length} links
                            </span>
                          </div>
                          <span className="quiet-badge">
                            {live.fresh ? "SUMO · SYNTHETIC 1 Hz" : "CONFIGURATION VIEW"}
                          </span>
                        </div>

                        {/* Interactive Data-Driven Canvas (Story S09, S11, S12) */}
                        <NetworkCanvas
                          network={data}
                          frame={live.fresh ? live.frame : null}
                          onSelect={selectNode}
                          route={[]}
                          forecasts={analysis?.forecasts}
                          horizon={selectedHorizon}
                        />

                        {/* Node Shortcuts */}
                        <div
                          className="node-shortcuts"
                          aria-label="Inspect network nodes"
                        >
                          {data.nodes.map((n) => (
                            <Button
                              key={n.id}
                              variant="outline"
                              onClick={() => selectNode(n.id)}
                              aria-label={`Open ${n.id} details`}
                            >
                              {n.id}
                              <ChevronRight size={12} />
                            </Button>
                          ))}
                        </div>

                        <div className="canvas-footer">
                          <span>
                            <MapPin size={14} /> Select any junction (C1–C6) to inspect approach queues, storage, and signal phases
                          </span>
                          <span>
                            Overlays: Direction · Queue (veh) · Speed (km/h) · Signals (countdown)
                          </span>
                        </div>
                      </section>

                      {/* Unresolved Decision Intent Banner (Story S15 / PRD §8.3) */}
                      {unresolvedQuery.data?.unresolved && unresolvedQuery.data.unresolved.length > 0 && (
                        <aside
                          className="unresolved-intent-banner"
                          role="alert"
                          aria-label="Unresolved decision intent pending reconciliation"
                        >
                          <div className="unresolved-banner-content">
                            <AlertTriangle className="unresolved-alert-icon" size={18} />
                            <div className="unresolved-banner-text">
                              <strong>Unsettled Decision Intent Pending Reconciliation</strong>
                              <p>
                                Command <code>{unresolvedQuery.data.unresolved[0].command_id.slice(0, 8)}...</code> on recommendation <code>{unresolvedQuery.data.unresolved[0].recommendation_id}</code> by {unresolvedQuery.data.unresolved[0].actor} is unconfirmed. Subsequent plans are paused under Story S15 safety governance.
                              </p>
                            </div>
                            {(activeRole === "supervisor" || activeRole === "operator") && (
                              <Button
                                variant="default"
                                disabled={resolveDecisionMutation.isPending}
                                onClick={() =>
                                  resolveDecisionMutation.mutate({
                                    commandId: unresolvedQuery.data!.unresolved[0].command_id,
                                    recommendationId: unresolvedQuery.data!.unresolved[0].recommendation_id,
                                    resolution: "fail",
                                    reason: "Supervisor resolved unconfirmed decision intent",
                                  })
                                }
                                aria-label="Reconcile and clear pending decision intent"
                              >
                                {resolveDecisionMutation.isPending ? "Reconciling..." : "Resolve / Clear Intent"}
                              </Button>
                            )}
                          </div>
                        </aside>
                      )}

                      {/* 4-column Action Rail (Story S09 / PRD §8.1) */}
                      <ActionRail
                        key={`${session.data?.actor}:${live.frame?.run_id || "none"}`}
                        draftOwner={session.data?.actor}
                        canAct={decisionReady}
                        onDirty={setDirty}
                        network={data}
                        frame={live.fresh ? live.frame : null}
                        analysis={decisionAnalysis}
                        scenarioID={scenarioID}
                        setScenarioID={setScenarioID}
                        seed={seed}
                        setSeed={setSeed}
                        dbReady={!!dbReady}
                        liveFresh={live.fresh}
                        prepareMutation={prepare}
                        resetMutation={reset}
                        onSelectAlternative={setSelectedAlternative}
                        onSimulate={() => decision.mutate({ action: "simulate" })}
                        onApprove={() => decision.mutate({ action: "approve" })}
                        onModify={(reason, changes) =>
                          decision.mutateAsync({ action: "modify", reason, changes })
                        }
                        onReject={(reason) =>
                          decision.mutateAsync({ action: "reject", reason })
                        }
                        decisionPending={anyCommandPending}
                        comparisonResult={
                          (simulationComparison?.run_id === live.frame?.run_id &&
                            (simulationComparison?.recommendation_id === analysis?.recommendation?.id ||
                             simulationComparison?.recommendation_id === selectedAlternative?.id))
                            ? simulationComparison
                            : (analysis?.comparison?.run_id === live.frame?.run_id &&
                               (analysis?.comparison?.recommendation_id === analysis?.recommendation?.id ||
                                analysis?.comparison?.recommendation_id === selectedAlternative?.id))
                              ? analysis.comparison
                              : null
                        }
                        onClearComparison={() => setSimulationComparison(null)}
                        manualMode={manual}
                      />
                    </div>

                    {/* Exactly 5 Summary KPIs Strip (Story S09 / PRD §8.1) */}
                    <KpiStrip
                      frame={live.fresh ? live.frame : null}
                      analysis={analysis}
                    />

                    {/* Live Stream Health & Signal Summary */}
                    <LiveSummary live={live} />
                    <section className="context-panel"><h2>Recovery and timing locks</h2>
                    <p>{live.frame?.replay ? "Prerecorded replay · signal decisions disabled" : "Replay is a prerecorded fallback; it still requires the local gateway and database."}</p>
                    <Button disabled={!dbReady||anyCommandPending} onClick={()=>{if(!live.frame||window.confirm("Replace the current run with prerecorded replay?"))replay.mutate()}}>Start golden replay</Button>
                    <h3>Configured timing locks</h3><p>Locks persist across restarts and are checked before operator plan changes. Emergency scheduling remains separately protected.</p>
                    {data.phases.map(p=><Button key={p.id} variant="outline" disabled={!dbReady||!live.fresh||!!live.frame?.replay||anyCommandPending} onClick={()=>lock.mutate({target:p.id,locked:!modeQuery.data?.locks.includes(p.id)})}>{modeQuery.data?.locks.includes(p.id)?"Unlock":"Lock"} {p.id}</Button>)}
                    </section>

                    {/* Configuration / Topology Summary Strip */}
                    <div className="configuration-strip">
                      <div>
                        <span>CONTROLLED JUNCTIONS</span>
                        <strong>
                          {
                            data.nodes.filter((n) => n.kind === "controlled")
                              .length
                          }
                          <small>Configured</small>
                        </strong>
                      </div>
                      <div>
                        <span>BOUNDARY NODES</span>
                        <strong>
                          {
                            data.nodes.filter((n) => n.kind === "boundary")
                              .length
                          }
                          <small>Configured</small>
                        </strong>
                      </div>
                      <div>
                        <span>PROTECTED PHASES</span>
                        <strong>
                          {data.phases.length}
                          <small>Validated</small>
                        </strong>
                      </div>
                      <div>
                        <span>SCENARIO SEEDS</span>
                        <strong>
                          {data.scenarios.length}
                          <small>Deterministic</small>
                        </strong>
                      </div>
                    </div>
                  </>
                )}

                {/* 2. NETWORK SCREEN */}
                {view === "network" && (
                  <NetworkView
                    network={data}
                    frame={live.fresh ? live.frame : null}
                    analysis={analysis}
                    onSelectNode={selectNode}
                    route={[]}
                    comparisonResult={activeComparison}
                    onSimulate={() => decision.mutate({ action: "simulate" })}
                    isSimulating={decision.isPending}
                  />
                )}

                {/* 3. INCIDENTS VIEW */}
                {view === "incidents" && (
                  <div className="operations-grid">
                    <section className="network-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Incident Scenario · C3 Capacity Reduction</h2>
                          <span>Bottleneck simulation at C3 with upstream feeder metering</span>
                        </div>
                        <span className="quiet-badge">INCIDENT_C3</span>
                      </div>
                      <NetworkCanvas
                        network={data}
                        frame={live.fresh ? live.frame : null}
                        onSelect={selectNode}
                        route={["C6", "C3", "C1"]}
                      />
                    </section>
                    <aside className="action-rail">
                      <section className="context-panel">
                        <div className="overline">INCIDENT_C3 / BOTTLENECK</div>
                        {live.fresh && live.frame?.scenario_type==="incident_c3" && live.frame.incident?.id ? <p role="status">Stage: {live.frame.incident.status} · remaining capacity {Math.round(live.frame.incident.capacity_ratio*100)}% · configured recovery countdown {live.frame.incident.recovery_cycles} cycles. This countdown is not a measured queue-clearance estimate.</p> : <p role="status">No fresh incident run. Launch the configured scenario to inspect its lifecycle.</p>}
                        <h2>C3 configured remaining capacity: {Math.round((data.scenarios.find(s=>s.id==="incident_c3")?.capacity_ratio ?? 0)*100)}%</h2>
                        <p>
                          Configured capacity reduction at C3. Inspect actual upstream queues and forecast evidence; C6 is a boundary without signal control.
                        </p>
                        <Button
                          variant="default"
                          onClick={() => {
                            setScenarioID("incident_c3");
                            setSeed("2202");
                            setView("command");
                          }}
                        >
                          Launch in Command Center <ArrowRight size={15} />
                        </Button>
                      </section>
                    </aside>
                  </div>
                )}

                {/* 4. EMERGENCY VIEW */}
                {view === "emergency" && (
                  <div className="operations-grid">
                    <section className="network-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Ambulance Corridor Priority</h2>
                          <span>Designated green wave route: C6 → C3 → C1 → C2</span>
                        </div>
                        <span className="quiet-badge">AMBULANCE_CORRIDOR</span>
                      </div>
                      <NetworkCanvas
                        network={data}
                        frame={live.fresh ? live.frame : null}
                        onSelect={selectNode}
                        route={
                          data.scenarios.find(
                            (s) => s.id === "ambulance_corridor",
                          )?.route_node_ids ?? ["C6", "C3", "C1", "C2"]
                        }
                      />
                    </section>
                    <aside className="action-rail">
                      <section className="context-panel">
                        <div className="overline">AMBULANCE_CORRIDOR</div>
                        {live.fresh && live.frame?.scenario_type==="ambulance_corridor" && live.frame.emergency?.id ? <div role="status"><p>Stage: {live.frame.emergency.status} · recovery countdown {live.frame.emergency.recovery_cycles_remaining} cycles</p><ul>{live.frame.emergency.route_node_ids.map((n,i)=><li key={n}>{n}: {live.frame?.emergency?.eta_s[i] != null ? `${Math.round(live.frame.emergency.eta_s[i])}s modeled ETA` : "ETA unavailable"}</li>)}</ul></div> : <p role="status">No fresh emergency run. Launch the configured scenario to inspect stages and ETAs.</p>}
                        <h2>Simulated emergency priority</h2>
                        <p>
                          Priority is applied only at configured controlled junctions, subject to clearance and receiving capacity. Observe actual stage and recovery; passage time is not guaranteed.
                        </p>
                        <Button
                          variant="default"
                          onClick={() => {
                            setScenarioID("ambulance_corridor");
                            setSeed("3303");
                            setView("command");
                          }}
                        >
                          Launch in Command Center <ArrowRight size={15} />
                        </Button>
                      </section>
                    </aside>
                  </div>
                )}

                {/* 5. VISION ANALYTICS VIEW */}
                {view === "vision" && (
                  <section className="feature-empty">
                    <Video size={40} />
                    <div className="overline">VISION ANALYTICS</div>
                    <h2>Sample Video Traffic Extraction</h2>
                    <p>
                      Optional sample-video extraction is not implemented. No camera feed, vehicle tracks or analytics are available. Core synthetic scenarios and replay remain independent of this feature.
                    </p>
                    <Button variant="outline" onClick={() => setView("command")}>
                      Return to Command Center <ArrowRight size={16} />
                    </Button>
                  </section>
                )}

                {/* 6. AUDIT & HEALTH VIEW */}
                {view === "audit" && (
                  <div className="audit-layout">
                    <section className="history-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Durable Audit Trail</h2>
                          <span>PostgreSQL history · oldest first · pages of 50</span>
                        </div>
                        <ShieldCheck size={18} />
                      </div>
                      {audit.isPending ? (
                        <p className="panel-message">Loading audit history…</p>
                      ) : audit.isError ? (
                        <p className="panel-message form-error" role="alert">
                          {audit.error.message}
                        </p>
                      ) : audit.data?.events.length ? (
                        <div className="audit-list" role="feed" aria-label="Sequential Audit Log">
                          {audit.data.events.map((a) => {
                            const isApproved = a.safety_result === "accepted_at_safe_boundary";
                            const isSimulated = a.safety_result === "simulated";
                            const isRejected = a.safety_result.startsWith("rejected");
                            const isLock = a.event_type.startsWith("lock.");
                            const isMode = a.event_type.startsWith("mode.");
                            return (
                              <article key={a.id} className="audit-card">
                                <div className="audit-card-header">
                                  <span className={`audit-badge ${
                                    isApproved ? "badge-success" :
                                    isSimulated ? "badge-info" :
                                    isRejected ? "badge-danger" :
                                    isLock ? "badge-warning" : "badge-neutral"
                                  }`}>
                                    {a.event_type.toUpperCase()}
                                  </span>
                                  <span className="audit-timestamp">
                                    {new Date(a.created_at).toLocaleString()}
                                  </span>
                                </div>
                                <div className="audit-card-body">
                                  <h3>{a.reason}</h3>
                                  <div className="audit-meta-row">
                                    <span>Actor: <strong>{a.actor}</strong></span>
                                    <span>Safety Result: <strong className={isApproved ? "text-success" : isRejected ? "text-danger" : ""}>{a.safety_result}</strong></span>
                                  </div>
                                  <details><summary>Decision evidence</summary><p>Recommendation: {a.recommendation_id || "Not applicable"}</p><pre>Before: {JSON.stringify(a.before_values,null,2)}{"\n"}After: {JSON.stringify(a.after_values,null,2)}</pre></details>
                                  <div className="audit-run-id">
                                    <code>Run: {a.run_id}</code>
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="panel-message">
                          No audit events yet. Prepare or run a scenario to record entries.
                        </p>
                      )}
                    </section>

                    <section className="context-panel">
                      <h2>Audit pages</h2><Button disabled={auditPages.length===0} onClick={()=>{const previous=[...auditPages];setAuditAfter(previous.pop()||0);setAuditPages(previous)}}>Previous events</Button><Button disabled={!audit.data||audit.data.events.length<50} onClick={()=>{setAuditPages([...auditPages,auditAfter]);setAuditAfter(audit.data!.next_after)}}>Next events</Button><Button onClick={()=>{setAuditPages([]);setAuditAfter(0)}}>First page</Button>
                      <div className="overline">COMPONENT HEALTH</div>
                      <h2>System Availability</h2>
                      {health.isError ? (
                        <p className="form-error">Health API unavailable</p>
                      ) : (
                        health.data?.components.map((c) => (
                          <div className="component" key={c.component}>
                            <div>
                              <span
                                className={`status-dot ${c.status === "normal" ? "normal" : "unknown"}`}
                              />
                              <strong>
                                {c.component.replaceAll("_", " ")}
                              </strong>
                            </div>
                            <p>{c.message}</p>
                          </div>
                        ))
                      )}
                    </section>
                  </div>
                )}

                {/* Run History Table for Command and Audit */}
                {(view === "command" || view === "audit") && (
                  <section className="history-panel run-history">
                    <div className="panel-heading">
                      <div>
                        <h2>Run history</h2>
                        <span>Persisted in PostgreSQL · latest 50</span>
                      </div>
                      <span className="quiet-badge">
                        {runs.data?.length ?? "—"} RUNS
                      </span>
                    </div>
                    {runs.isPending ? (
                      <p className="panel-message">Loading saved runs…</p>
                    ) : runs.isError ? (
                      <p className="panel-message form-error" role="alert">
                        {runs.error.message}
                      </p>
                    ) : runs.data?.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Scenario</th>
                              <th>Seed</th>
                              <th>Run ID</th>
                              <th>Started At</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runs.data.map((run) => (
                              <tr key={run.id}>
                                <td>{scenarioLabels[run.scenario_type] || run.scenario_type}</td>
                                <td className="mono">{run.seed}</td>
                                <td className="mono" title={run.id}>
                                  {run.id.slice(0, 8)}
                                </td>
                                <td>
                                  {new Date(run.started_at).toLocaleString()}
                                </td>
                                <td>
                                  <span className="quiet-badge">
                                    {run.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="panel-message">
                        No runs recorded yet. Start a scenario to establish the first baseline.
                      </p>
                    )}
                  </section>
                )}
              </>
            )
          )}

          <footer className="product-footer">
            <span>
              TRAFFIC DIGITAL TWIN <span>/ SYNTHETIC DEMONSTRATION</span>
            </span>
            <span>
              Demonstration mode · Synthetic traffic · Zero live signal control.
            </span>
          </footer>
        </main>
      </div>

      {/* Junction Intelligence Drawer (Story S10: Sheet with Horizons, Cause & Recommendation) */}
      <Sheet
        open={!!chosen}
        onOpenChange={(open) => {
          if (!open) selectNode(null);
        }}
        title={
          chosen ? `${chosen.id} · ${chosen.label}` : "Junction Intelligence"
        }
        description="Junction state, forward horizons, deterministic cause, and recommendation impact."
      >
        {chosen && data && (
          <JunctionDrawerContent
            chosen={chosen}
            network={data}
            frame={live.fresh ? live.frame : null}
            analysis={analysis}
            activeLocks={modeQuery.data?.locks || []}
            onToggleLock={(target, locked) => lock.mutate({ target, locked })}
            canLock={!!dbReady && live.fresh && !live.frame?.replay && !anyCommandPending && canWrite}
          />
        )}
      </Sheet>

      {/* Guided 8-Step DGP Demonstration Presentation Modal (PRD §5 & §8.1) */}
      <DgpPresentationModal
        open={dgpModalOpen}
        onOpenChange={setDgpModalOpen}
      />
    </div>
  );
}
