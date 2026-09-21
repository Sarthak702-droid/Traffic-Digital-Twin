"use client";

import { AlertTriangle, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Network } from "../../../packages/contracts/typescript/network";
import type { TrafficState } from "../../../packages/contracts/typescript/events";

export type IncidentRecovery = {
  affectedLinks: string[];
  upstreamQueueVeh: number;
  upstreamDepartureVpm: number;
  blocked: boolean;
  estimateSeconds: number | null;
  estimateCycles: number | null;
};

export function incidentRecovery(network: Network, frame: TrafficState | null): IncidentRecovery {
  const incoming = new Set(network.movements.filter((movement) => movement.node_id === "C3").map((movement) => movement.id));
  const links = [...new Set(network.movements.filter((movement) => incoming.has(movement.id)).map((movement) => movement.incoming_link_id))];
  const aggregates = (frame?.links ?? []).filter((link) => links.includes(link.link_id));
  const measured = frame?.movements.filter((movement) => incoming.has(movement.movement_id)) ?? [];
  const upstreamQueueVeh = aggregates.length ? aggregates.reduce((sum, link) => sum + link.queued_veh_estimate, 0) : measured.reduce((sum, movement) => sum + movement.queue_veh, 0);
  const upstreamDepartureVpm = aggregates.length ? aggregates.reduce((sum, link) => sum + link.outflow_vpm, 0) : measured.reduce((sum, movement) => sum + movement.departure_rate_vpm, 0);
  const blocked = aggregates.length ? aggregates.some((link) => link.receiving_blocked || link.storage_utilization_ratio >= 0.98) : measured.some((movement) => movement.downstream_capacity_veh <= 0 || movement.occupancy_ratio >= 0.98);
  const c3Phases = network.phases.filter((phase) => phase.node_id === "C3");
  const cycleSeconds = c3Phases.reduce((sum, phase) => {
    const green = frame?.active_plan.find((change) => change.phase_id === phase.id)?.green_s ?? phase.min_green_s;
    return sum + green + phase.amber_s + phase.all_red_s;
  }, 0);
  const estimateSeconds = upstreamDepartureVpm > 0 && !blocked ? Math.ceil(upstreamQueueVeh / (upstreamDepartureVpm / 60)) : null;
  return {
    affectedLinks: links,
    upstreamQueueVeh,
    upstreamDepartureVpm,
    blocked,
    estimateSeconds,
    estimateCycles: estimateSeconds !== null && cycleSeconds > 0 ? Math.ceil(estimateSeconds / cycleSeconds) : null,
  };
}

export function IncidentRecoveryPanel({
  network,
  frame,
  capacityRatio,
  onCapacityRatio,
  onLaunch,
  onReset,
  canOperate,
  pending,
  error,
}: {
  network: Network;
  frame: TrafficState | null;
  capacityRatio: number;
  onCapacityRatio: (value: number) => void;
  onLaunch: () => void;
  onReset: () => void;
  canOperate: boolean;
  pending: boolean;
  error?: string;
}) {
  const configured = network.scenarios.find((scenario) => scenario.id === "incident_c3")?.capacity_ratio ?? 0.35;
  const active = frame?.scenario_type === "incident_c3" ? frame.incident : null;
  const recovery = incidentRecovery(network, active ? frame : null);

  return (
    <section className="incident-recovery-panel" aria-labelledby="incident-heading">
      <div className="panel-heading">
        <div>
          <div className="overline">C3 VIRTUAL CAPACITY INCIDENT</div>
          <h2 id="incident-heading">Containment and recovery</h2>
        </div>
        <span className={`quiet-badge ${active?.status === "active" ? "badge-warning" : ""}`}>{active?.status ?? "READY"}</span>
      </div>

      <div className="incident-control-grid">
        <label>
          <span><SlidersHorizontal size={14} /> Remaining C3 capacity</span>
          <select aria-label="Remaining C3 capacity" value={capacityRatio} onChange={(event) => onCapacityRatio(Number(event.target.value))} disabled={!canOperate || pending}>
            <option value={0.2}>Severe · 20%</option>
            <option value={0.35}>Configured default · 35%</option>
            <option value={0.5}>Moderate · 50%</option>
            <option value={0.7}>Limited · 70%</option>
          </select>
        </label>
        <div className="incident-definition">
          <strong>capacity_reduction</strong>
          <span>Virtual aggregate-flow constraint only. No physical controller is connected.</span>
        </div>
      </div>

      <div className="incident-stat-grid">
        <div><span>Actual remaining capacity</span><strong>{Math.round((active?.capacity_ratio ?? configured) * 100)}%</strong></div>
        <div><span>Configured recovery countdown</span><strong>{active ? `${active.recovery_cycles} cycles` : "—"}</strong></div>
        <div><span>Modeled upstream queue</span><strong>{active ? `${recovery.upstreamQueueVeh.toFixed(0)} veh` : "—"}</strong></div>
      </div>

      {active ? (
        <div className={`incident-recovery-note ${recovery.blocked ? "incident-blocked" : ""}`} role="status">
          {recovery.blocked ? <AlertTriangle size={17} /> : <ShieldCheck size={17} />}
          <div>
            <strong>{recovery.blocked ? "Release gate held: a receiving link is full or blocked." : recovery.estimateCycles !== null ? `Modeled queue-drain estimate: about ${recovery.estimateCycles} C3 cycles (${recovery.estimateSeconds}s).` : "Recovery estimate unavailable until modeled discharge is positive."}</strong>
            <p>Affected approaches: {recovery.affectedLinks.join(", ") || "unavailable"}. This estimate uses current aggregate queues and discharge; the configured countdown is not a measured clearance guarantee.</p>
          </div>
        </div>
      ) : (
        <p className="panel-message">The default run reduces C3 to {Math.round(configured * 100)}% from 30s to 150s. Select a permitted virtual severity before launch.</p>
      )}

      <div className="incident-actions">
        <Button disabled={!canOperate || pending} onClick={onLaunch}>{pending ? "Starting incident…" : "Start configured C3 incident"}</Button>
        <Button variant="outline" disabled={!active || !canOperate || pending} onClick={onReset}><RotateCcw size={15} /> Reset same seed</Button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
