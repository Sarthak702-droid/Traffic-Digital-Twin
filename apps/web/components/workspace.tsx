"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
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
import { DecisionPanel } from "@/components/decision-panel";
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
  const [view, setView] = useState<View>("command");
  const [scenarioID, setScenarioID] = useState<Scenario["id"]>("peak_surge");
  const [seed, setSeed] = useState("1101");
  const [manual, setManual] = useState(false);

  const {
    selectedNode,
    selectNode,
    role,
    dgpModalOpen,
    setDgpModalOpen,
    selectedHorizon,
  } = useWorkspace();

  const client = useQueryClient();
  const network = useQuery({ queryKey: ["network"], queryFn: getNetwork });
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
    queryKey: ["audit"],
    queryFn: () =>
      request<{ events: AuditRecord[]; next_after: number }>("/audit?limit=50"),
    enabled: view === "audit",
  });

  // Real-time analysis query (forecasts, recommendations, comparisons)
  const analysisQuery = useQuery({
    queryKey: ["analysis", live.frame?.run_id],
    queryFn: () => request<Analysis>("/analysis"),
    refetchInterval: 2000,
    retry: false,
  });

  const analysis: Analysis | null =
    analysisQuery.data && (!live.frame?.run_id || analysisQuery.data.run_id === live.frame.run_id)
      ? analysisQuery.data
      : null;

  const [simulationComparison, setSimulationComparison] = useState<ComparisonResult | null>(null);
  const [systemMode, setSystemMode] = useState<"recommend" | "observe" | "manual">(
    manual ? "manual" : "recommend",
  );

  // Decision mutation (Story S15: Simulate, Approve, Modify, Reject)
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
      const rec = analysis?.recommendation;
      if (!rec) throw Error("No active recommendation to act upon");
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
        setSimulationComparison(data.result);
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
      const nextManual = !manual;
      setManual(nextManual);
      setSystemMode(nextManual ? "manual" : "recommend");
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
      setSystemMode(m);
      setManual(m === "manual");
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
          mode: manual ? "observe" : "recommend",
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
  const dbReady = health.data?.components.some(
    (c) => c.component === "database" && c.status === "normal",
  );

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
          health={health.data}
          manual={manual}
          mode={systemMode}
          onChangeMode={(m) => changeModeMutation.mutate(m)}
          onToggleManual={() => modeMutation.mutate()}
          isPendingManual={modeMutation.isPending || changeModeMutation.isPending}
        />

        {/* Prominent Disclosure Banner (PRD §8.1) */}
        <div className="disclosure" role="region" aria-label="Operating Mode Disclosure">
          <ShieldCheck size={14} />
          <span>
            DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL
          </span>
        </div>

        <main className="product-content">
          {/* Role-Specific Executive / Supervisor Banner (PRD §4) */}
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
                  Safety limits strictly validated: min green 15s, max green 55s, yellow/all-red clearance enforced. Full PostgreSQL audit trail enabled.
                </p>
              </div>
              <span className="safety-pill">
                <Check size={12} /> All Safety Envelopes Intact
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
                        <Check size={13} /> Configuration validated
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

                      {/* 4-column Action Rail (Story S09 / PRD §8.1) */}
                      <ActionRail
                        network={data}
                        frame={live.fresh ? live.frame : null}
                        analysis={analysis}
                        scenarioID={scenarioID}
                        setScenarioID={setScenarioID}
                        seed={seed}
                        setSeed={setSeed}
                        dbReady={!!dbReady}
                        liveFresh={live.fresh}
                        prepareMutation={prepare}
                        resetMutation={reset}
                        onSimulate={() => decision.mutate({ action: "simulate" })}
                        onApprove={() => decision.mutate({ action: "approve" })}
                        onModify={(reason, changes) =>
                          decision.mutate({ action: "modify", reason, changes })
                        }
                        onReject={(reason) =>
                          decision.mutate({ action: "reject", reason })
                        }
                        decisionPending={decision.isPending}
                        comparisonResult={simulationComparison}
                        onClearComparison={() => setSimulationComparison(null)}
                        manualMode={manual || systemMode === "manual"}
                      />
                    </div>

                    {/* Exactly 5 Summary KPIs Strip (Story S09 / PRD §8.1) */}
                    <KpiStrip
                      frame={live.fresh ? live.frame : null}
                      analysis={analysis}
                    />

                    {/* Live Stream Health & Signal Summary */}
                    <LiveSummary live={live} />

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

                {/* 2. NETWORK SCREEN (PRD §8.4) */}
                {view === "network" && (
                  <NetworkView
                    network={data}
                    frame={live.fresh ? live.frame : null}
                    analysis={analysis}
                    onSelectNode={selectNode}
                    route={[]}
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
                        <h2>C3 Capacity Cut to 50%</h2>
                        <p>
                          Simulates a lane blockage at C3. In normal fixed timing, queue spillback reaches C6 within 90 seconds. With coordinated decision support, C6 green time is metered and C1 clears northbound traffic.
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
                        <h2>Guaranteed Emergency Green Wave</h2>
                        <p>
                          Pre-clears cross-traffic along C6 → C3 → C1 → C2 before vehicle arrival. Following clearance, bounded recovery cycles restore equilibrium to cross-traffic without permanent gridlock.
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
                    <div className="overline">VISION ANALYTICS (PRD §8.5)</div>
                    <h2>Sample Video Traffic Extraction</h2>
                    <p>
                      Camera feeds extract aggregate counts and vehicle tracks without facial recognition, ANPR, or citizen surveillance. Demonstrates real-world bridge from CCTV cameras to machine-readable digital twin inputs.
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
                          <span>PostgreSQL Sequential Record · Latest 50 events</span>
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
              TRAFFIC DIGITAL TWIN <span>/ COMMAND CENTER & JUNCTION INTELLIGENCE (EPIC 3)</span>
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
