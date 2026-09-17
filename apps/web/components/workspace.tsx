"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
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
  ShieldCheck,
  Siren,
  TrafficCone,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { getNetwork, request } from "@/lib/api";
import { useLive } from "@/lib/live";
import { LiveSummary, JunctionLive } from "@/components/live-panel";
import { useWorkspace } from "@/lib/state";
import type {
  Network,
  Run,
  AuditRecord,
  Scenario,
} from "../../../packages/contracts/typescript/network";
import type { HealthState, TrafficState } from "../../../packages/contracts/typescript/events";
const sections = [
  { id: "command", label: "Command Center", icon: Layers },
  { id: "network", label: "Network", icon: NetworkIcon },
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
export function NetworkCanvas({
  network,
  onSelect,
  route = [],
  frame,
}: {
  network: Network;
  onSelect: (id: string) => void;
  route?: string[];
  frame?: TrafficState | null;
}) {
  const maxX = Math.max(...network.nodes.map((n) => n.x)) + 130,
    maxY = Math.max(...network.nodes.map((n) => n.y)) + 80;
  const nodes = new Map(network.nodes.map((n) => [n.id, n]));
  return (
    <svg
      className="network-svg"
      viewBox={`0 0 ${maxX} ${maxY}`}
      role="group"
      aria-label="Configured demonstration network; select a junction to inspect it"
    >
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".8" fill="#26343d" />
        </pattern>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="7"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#82919c" />
        </marker>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
      {network.links.map((link) => {
        const from = nodes.get(link.from_node),
          to = nodes.get(link.to_node);
        if (!from || !to) return null;
        const length = Math.hypot(to.x - from.x, to.y - from.y),
          dx = (to.x - from.x) / length,
          dy = (to.y - from.y) / length,
          offset = 10;
        const x1 = from.x + dx * 38 - dy * offset,
          y1 = from.y + dy * 38 + dx * offset,
          x2 = to.x - dx * 42 - dy * offset,
          y2 = to.y - dy * 42 + dx * offset;
        const highlighted = route.some(
          (id, i) => id === from.id && route[i + 1] === to.id,
        );
        return (
          <g key={link.id}>
            <title>
              {link.id}: {link.length_m} m, {link.storage_capacity_veh} vehicles
              of storage
            </title>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={highlighted ? "#c0abed" : "#25343f"}
              strokeWidth="16"
              strokeLinecap="round"
            />
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={highlighted ? "#e4d7ff" : "#70828f"}
              strokeWidth="1.2"
              strokeDasharray="4 7"
              markerEnd="url(#arrow)"
            />
            {frame && frame.movements.some(m => network.movements.some(c => c.id === m.movement_id && c.incoming_link_id === link.id) && m.vehicle_count > 0) && (
              <circle r="3" fill="#83b7a0" className="flow-marker">
                <animateMotion dur="3s" repeatCount="indefinite" path={`M ${x1} ${y1} L ${x2} ${y2}`} />
              </circle>
            )}
            {link.from_node < link.to_node && (
              <text
                x={(from.x + to.x) / 2 + (dx === 0 ? 42 : 0)}
                y={(from.y + to.y) / 2 + (dy === 0 ? -38 : 0)}
                className="link-label"
                textAnchor="middle"
              >
                {link.length_m} m
              </text>
            )}
          </g>
        );
      })}
      {network.nodes.map((node) => (
        <g
          key={node.id}
          role="button"
          tabIndex={0}
          aria-label={`Inspect ${node.id}, ${node.label}`}
          onClick={() => onSelect(node.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(node.id);
            }
          }}
          className="map-node"
        >
          <circle
            cx={node.x}
            cy={node.y}
            r="34"
            fill="#101b23"
            stroke={route.includes(node.id) ? "#baa3e6" : "#43545f"}
            strokeWidth="1.5"
          />
          {node.kind === "controlled" && (
            <circle
              cx={node.x}
              cy={node.y}
              r="41"
              fill="none"
              stroke={frame?.signals.find(s => s.node_id === node.id)?.indication === "green" ? "#83b7a0" : frame?.signals.find(s => s.node_id === node.id)?.indication === "amber" ? "#e4b967" : frame ? "#ce7975" : "#40575d"}
              strokeDasharray="3 5"
            />
          )}
          <text
            x={node.x}
            y={node.y + 6}
            textAnchor="middle"
            className="node-label"
          >
            {node.id}
          </text>
          <text
            x={node.x + (node.kind === "controlled" ? 60 : 0)}
            y={node.y + (node.kind === "controlled" ? 5 : 57)}
            textAnchor={node.kind === "controlled" ? "start" : "middle"}
            className="node-kind"
          >
            {node.kind === "controlled" ? "Controlled junction" : "Boundary"}
          </text>
        </g>
      ))}
    </svg>
  );
}
export function Workspace() {
  const live = useLive();
  const [view, setView] = useState<View>("command");
  const [scenarioID, setScenarioID] = useState<Scenario["id"]>("peak_surge");
  const [seed, setSeed] = useState("1101");
  const [formError, setFormError] = useState("");
  const [clock, setClock] = useState("Local workspace");
  const { selectedNode, selectNode } = useWorkspace();
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
  const prepare = useMutation({
    mutationFn: () =>
      request<Run>(`/scenarios/${scenarioID}/start`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "1.0",
          seed: Number(seed),
          mode: "recommend",
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["runs"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });
  const reset = useMutation({
    mutationFn: () => request<Run>("/scenarios/reset", {method: "POST", body: "{}"}),
    onSuccess: () => { prepare.reset(); client.invalidateQueries({queryKey:["runs"]}); client.invalidateQueries({queryKey:["audit"]}); }
  });
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const data = network.data;
  const chosen = data?.nodes.find((n) => n.id === selectedNode);
  const scenario = data?.scenarios.find((s) => s.id === scenarioID);
  const dbReady = health.data?.components.some(
    (c) => c.component === "database" && c.status === "normal",
  );
  function chooseScenario(id: Scenario["id"]) {
    setScenarioID(id);
    const s = data?.scenarios.find((s) => s.id === id);
    if (s) setSeed(String(s.seed));
    setFormError("");
    prepare.reset();
  }
  function submit() {
    if (!/^\d+$/.test(seed) || Number(seed) < 1 || Number(seed) > 4294967295) {
      setFormError("Enter an integer seed between 1 and 4294967295.");
      return;
    }
    setFormError("");
    prepare.mutate();
  }
  const refresh = () => {
    client.invalidateQueries();
  };
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <a href="/" className="wordmark">
          <span className="logo">
            <GitBranch size={23} />
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
          <p>Every signal decision stays within the digital twin.</p>
          <div className="environment">
            <span />
            LOCAL DEMONSTRATION
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="product-header">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>{sections.find((s) => s.id === view)?.label}</span>
          </div>
          <div className="header-right">
            <span className="local-clock">{clock}</span>
            <span className="operator-avatar">OP</span>
            <span className="operator-label">Demo operator</span>
          </div>
        </header>
        <div className="disclosure">
          <ShieldCheck size={14} />
          <span>
            DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL
          </span>
        </div>
        <main className="product-content">
          <div className="page-heading">
            <div>
              <div className="overline">NETWORK OPERATIONS / FOUNDATION</div>
              <h1>{sections.find((s) => s.id === view)?.label}</h1>
              <p>
                {view === "audit"
                  ? "A durable record of preparation and system availability."
                  : "One connected network. A clear starting point."}
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
                {(view === "command" ||
                  view === "network" ||
                  view === "emergency" ||
                  view === "incidents") && (
                  <>
                    <div className="workspace-status">
                      <span className="status-pill">
                        <Check size={13} /> Configuration validated
                      </span>
                      <span>
                        <span className={`status-dot ${live.fresh ? "" : "unknown"}`} /> {live.fresh ? "Live synthetic traffic · 1 Hz" : live.frame ? "Traffic stream stale / disconnected" : "Start a scenario to receive traffic"}
                      </span>
                      <span className="config-version">{data.id}</span>
                    </div>
                    <div
                      className={
                        view === "network"
                          ? "operations-grid expanded"
                          : "operations-grid"
                      }
                    >
                      <section className="network-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>
                              {view === "emergency"
                                ? "Emergency route configuration"
                                : view === "incidents"
                                  ? "Incident scenario configuration"
                                  : "C1–C6 network"}
                            </h2>
                            <span>
                              Directed links · {data.nodes.length} nodes ·{" "}
                              {data.links.length} links
                            </span>
                          </div>
                          <span className="quiet-badge">
                            {live.fresh ? "SUMO · SYNTHETIC" : "CONFIGURATION VIEW"}
                          </span>
                        </div>
                        <NetworkCanvas
                          network={data}
                          frame={live.fresh ? live.frame : null}
                          onSelect={selectNode}
                          route={
                            view === "emergency"
                              ? data.scenarios.find(
                                  (s) => s.id === "ambulance_corridor",
                                )?.route_node_ids
                              : []
                          }
                        />
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
                            <MapPin size={14} /> Select a node to inspect
                            traffic and configuration
                          </span>
                          <span>Flow markers are schematic, not vehicle positions</span>
                        </div>
                      </section>
                      {view !== "network" && (
                        <aside className="action-rail">
                          <section className="context-panel">
                            <div className="overline">SYSTEM AVAILABILITY</div>
                            <h2>
                              {live.fresh ? "The network, in motion." : "Your digital twin is ready."}
                              <br /><span>{live.fresh ? "Every second counts." : "Start a repeatable run."}</span>
                            </h2>
                            <p>
                              Seeded synthetic demand runs through SUMO with configured virtual signals. Inspect a junction for measured queues and movement permissions.
                            </p>
                            <div className="availability-row">
                              <span>
                                <Database size={15} /> Persistence
                              </span>
                              <span className={dbReady ? "healthy" : "muted"}>
                                {dbReady ? "Connected" : "Unavailable"}
                              </span>
                            </div>
                            <div className="availability-row">
                              <span>
                                <Activity size={15} /> Simulation
                              </span>
                              <span className={live.fresh ? "healthy" : "muted"}>{live.fresh ? "Streaming · 1 Hz" : "Unavailable"}</span>
                            </div>
                          </section>
                          {view === "incidents" ? (
                            <section className="context-panel">
                              <div className="overline">
                                INCIDENT_C3 / CONFIGURED
                              </div>
                              <h3>Reduced receiving capacity</h3>
                              <p>
                                C3 retains{" "}
                                {Math.round(
                                  (data.scenarios.find(
                                    (s) => s.id === "incident_c3",
                                  )?.capacity_ratio || 0) * 100,
                                )}
                                % of normal capacity in this scenario. Incident
                                execution and recovery are implemented in Epic
                                9.
                              </p>
                            </section>
                          ) : view === "emergency" ? (
                            <section className="context-panel">
                              <div className="overline">
                                AMBULANCE_CORRIDOR / CONFIGURED
                              </div>
                              <h3>
                                {data.scenarios
                                  .find((s) => s.id === "ambulance_corridor")
                                  ?.route_node_ids.join(" → ")}
                              </h3>
                              <p>
                                The route is connected. Pre-clearance and
                                cross-traffic recovery are implemented in Epic
                                10.
                              </p>
                            </section>
                          ) : (
                            <section className="context-panel prepare-panel">
                              <div className="overline">RUN A DEMO SCENARIO</div>
                              <label htmlFor="scenario">Scenario</label>
                              <select
                                id="scenario"
                                value={scenarioID}
                                onChange={(e) =>
                                  chooseScenario(
                                    e.target.value as Scenario["id"],
                                  )
                                }
                              >
                                {data.scenarios.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {scenarioLabels[s.id]}
                                  </option>
                                ))}
                              </select>
                              <label htmlFor="seed">Deterministic seed</label>
                              <input
                                id="seed"
                                inputMode="numeric"
                                value={seed}
                                onChange={(e) => {
                                  setSeed(e.target.value);
                                  prepare.reset();
                                }}
                                aria-describedby="seed-hint"
                              />
                              <p id="seed-hint" className="field-hint">
                                Same seed, repeatable baseline. Default:{" "}
                                {scenario?.seed}.
                              </p>
                              <Button
                                onClick={submit}
                                disabled={prepare.isPending || reset.isPending || !dbReady}
                              >
                                {prepare.isPending
                                  ? "Starting SUMO…"
                                  : "Start simulation"}
                                <ArrowRight size={16} />
                              </Button>
                              <Button variant="outline" onClick={() => reset.mutate()} disabled={!live.frame || reset.isPending || prepare.isPending || !dbReady}>{reset.isPending ? "Resetting…" : "Reset same seed"}<RefreshCw size={14}/></Button>
                              <p className="field-hint">Start replaces the active run. Reset repeats its scenario and seed, with a new audited run ID.</p>
                              {reset.isError && <p role="alert" className="form-error">{reset.error.message}</p>}
                              {reset.isSuccess && <p role="status" className="form-success">Scenario reset. Seed {reset.data.seed}.</p>}
                              {(formError || prepare.isError) && (
                                <p className="form-error" role="alert">
                                  {formError || prepare.error?.message}
                                </p>
                              )}
                              {prepare.isSuccess && (
                                <p className="form-success" role="status">
                                  Simulation started. Seed {prepare.data.seed}.
                                </p>
                              )}
                            </section>
                          )}
                        </aside>
                      )}
                    </div>
                    <LiveSummary live={live} />
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
                {view === "vision" && (
                  <section className="feature-empty">
                    <Video size={40} />
                    <div className="overline">OPTIONAL / EPIC 12</div>
                    <h2>No sample video connected</h2>
                    <p>
                      Video analytics will use a clearly labelled sample feed
                      with temporary camera-local track IDs. No live CCTV,
                      facial recognition or plate recognition is connected.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setView("network")}
                    >
                      Inspect the network <ArrowRight size={16} />
                    </Button>
                  </section>
                )}
                {view === "audit" && (
                  <div className="audit-layout">
                    <section className="history-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>Audit trail</h2>
                          <span>Oldest first · up to 50 events</span>
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
                        <div className="audit-list">
                          {audit.data.events.map((a) => (
                            <article key={a.id}>
                              <span className="audit-icon">
                                <Check size={16} />
                              </span>
                              <div>
                                <h3>{a.event_type}</h3>
                                <p>{a.reason}</p>
                                <small>
                                  {a.actor} ·{" "}
                                  {new Date(a.created_at).toLocaleString()} ·
                                  Safety: {a.safety_result}
                                </small>
                                <code>{a.run_id}</code>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="panel-message">
                          No audit events yet. Prepare a run to record the first
                          entry.
                        </p>
                      )}
                    </section>
                    <section className="context-panel">
                      <div className="overline">COMPONENT HEALTH</div>
                      <h2>Availability, made visible.</h2>
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
                              <th>Run</th>
                              <th>Created</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runs.data.map((run) => (
                              <tr key={run.id}>
                                <td>{scenarioLabels[run.scenario_type]}</td>
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
                        No runs prepared yet. Choose a scenario to save your
                        first deterministic baseline.
                      </p>
                    )}
                  </section>
                )}
              </>
            )
          )}
          <footer className="product-footer">
            <span>
              TRAFFIC DIGITAL TWIN <span>/ FOUNDATION V1</span>
            </span>
            <span>
              Configuration is synthetic. No field calibration claimed.
            </span>
          </footer>
        </main>
      </div>
      <Sheet
        open={!!chosen}
        onOpenChange={(open) => {
          if (!open) selectNode(null);
        }}
        title={
          chosen ? `${chosen.id} · ${chosen.label}` : "Junction configuration"
        }
        description="Synthetic traffic measurements and configured safety bounds."
      >
        {chosen && data && (
          <>
            <JunctionLive frame={live.fresh ? live.frame : null} network={data} nodeID={chosen.id} />
            <div className="drawer-facts">
              <div>
                <span>Node type</span>
                <strong>{chosen.kind}</strong>
              </div>
              <div>
                <span>Coordinates</span>
                <strong>
                  {chosen.x}, {chosen.y}
                </strong>
              </div>
            </div>
            <h3>Connected links</h3>
            {data.links
              .filter((l) => l.from_node === chosen.id)
              .map((l) => (
                <div className="drawer-link" key={l.id}>
                  <strong>
                    {l.from_node} → {l.to_node}
                  </strong>
                  <p>
                    {l.length_m} m · {l.lanes} lanes · {l.storage_capacity_veh}{" "}
                    veh storage
                  </p>
                  <span>
                    Free-flow configuration: {l.free_flow_speed_kph} km/h
                  </span>
                </div>
              ))}
            <h3>Signal phases</h3>
            {data.phases.filter((p) => p.node_id === chosen.id).length ? (
              data.phases
                .filter((p) => p.node_id === chosen.id)
                .map((p) => (
                  <div className="drawer-link" key={p.id}>
                    <strong>{p.id}</strong>
                    <p>
                      Green {p.min_green_s}–{p.max_green_s}s · Amber {p.amber_s}
                      s · All-red {p.all_red_s}s
                    </p>
                    <span>{p.movement_ids.length} compatible movements</span>
                  </div>
                ))
            ) : (
              <p className="drawer-note">
                Boundary node. No signal control is configured.
              </p>
            )}
            <div className="drawer-note">
              <ArrowDown size={16} />
              <p>
                Forecasts and recommendations are scheduled for later epics. Current measurements come from synthetic SUMO traffic.
              </p>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
