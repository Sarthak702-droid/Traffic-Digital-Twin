"use client";

import { AlertTriangle, Check, Clock3, MapPin, RotateCcw, ShieldCheck, Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Network } from "../../../packages/contracts/typescript/network";
import type { TrafficState } from "../../../packages/contracts/typescript/events";

const stages = ["scheduled", "pre_clearance", "priority", "recovery", "complete"] as const;
type EmergencyStage = (typeof stages)[number];

export type CorridorRow = {
  nodeID: string;
  kind: "controlled" | "boundary";
  eta: number | null;
  signal: string | null;
  countdown: number | null;
};

export function emergencyStage(value: string | undefined): EmergencyStage | null {
  return stages.includes(value as EmergencyStage) ? (value as EmergencyStage) : null;
}

export function corridorRows(network: Network, frame: TrafficState | null): CorridorRow[] {
  const emergency = frame?.emergency;
  if (!emergency) return [];
  return emergency.route_node_ids.map((nodeID, index) => {
    const node = network.nodes.find((item) => item.id === nodeID);
    const signal = frame?.signals.find((item) => item.node_id === nodeID);
    return {
      nodeID,
      kind: node?.kind === "controlled" ? "controlled" : "boundary",
      eta: emergency.eta_s[index] ?? null,
      signal: signal?.indication ?? null,
      countdown: signal?.remaining_s ?? null,
    };
  });
}

function currentLocation(rows: CorridorRow[], stage: EmergencyStage | null): string {
  if (!stage) return "Modeled emergency progress unavailable until a valid event arrives.";
  if (stage === "scheduled") return "Awaiting deterministic virtual dispatch at C6.";
  if (stage === "recovery" || stage === "complete") return "Vehicle has cleared the configured corridor.";
  const passed = rows.reduce((latest, row, index) => row.eta === 0 ? index : latest, -1);
  if (passed < 0) return "Modeled arrival window has not reached the corridor.";
  if (passed >= rows.length - 1) return `Model indicates clearance through ${rows[passed].nodeID}.`;
  return `Modeled between ${rows[passed].nodeID} and ${rows[passed + 1].nodeID}.`;
}

function displacedQueues(network: Network, frame: TrafficState | null, route: string[]) {
  if (!frame) return 0;
  const controlled = new Set(network.nodes.filter((node) => node.kind === "controlled" && route.includes(node.id)).map((node) => node.id));
  const routeMovements = new Set(route.slice(0, -1).map((node, index) => `${node}-${route[index + 1]}`).filter(Boolean));
  return network.movements
    .filter((movement) => controlled.has(movement.node_id) && !routeMovements.has(movement.incoming_link_id))
    .map((movement) => frame.movements.find((state) => state.movement_id === movement.id))
    .filter((state): state is NonNullable<typeof state> => !!state)
    .reduce((sum, state) => sum + state.queue_veh, 0);
}

export function EmergencyCorridorPanel({
  network, frame, canOperate, pending, locked, error, onLaunch, onReset,
}: {
  network: Network;
  frame: TrafficState | null;
  canOperate: boolean;
  pending: boolean;
  locked: boolean;
  error?: string;
  onLaunch: () => void;
  onReset: () => void;
}) {
  const active = frame?.scenario_type === "ambulance_corridor" ? frame.emergency : null;
  const stage = emergencyStage(active?.status);
  const rows = active ? corridorRows(network, frame) : [];
  const route = active?.route_node_ids ?? network.scenarios.find((item) => item.id === "ambulance_corridor")?.route_node_ids ?? [];
  const displaced = displacedQueues(network, active ? frame : null, route);
  const blocked = locked || !canOperate;
  const activeIndex = stage ? stages.indexOf(stage) : -1;

  return (
    <section className="emergency-corridor-panel" aria-labelledby="emergency-corridor-heading">
      <div className="panel-heading emergency-heading">
        <div>
          <div className="overline"><Siren size={13} /> SIMULATED EMERGENCY EVENT</div>
          <h2 id="emergency-corridor-heading">Corridor readiness</h2>
        </div>
        <span className={`quiet-badge emergency-stage-${stage ?? "unavailable"}`}>{stage ?? "unavailable"}</span>
      </div>

      {active && stage ? (
        <>
          <div className="emergency-location" role="status">
            <MapPin size={17} />
            <div><span>MODELED ROUTE PROGRESS</span><strong>{currentLocation(rows, stage)}</strong></div>
          </div>
          <ol className="emergency-stage-track" aria-label="Emergency lifecycle">
            {stages.map((item, index) => <li key={item} className={index <= activeIndex ? "reached" : ""} aria-current={item === stage ? "step" : undefined}><span>{index < activeIndex ? <Check size={12} /> : index + 1}</span><small>{item.replace("_", " ")}</small></li>)}
          </ol>
          <div className="corridor-list" aria-label="Corridor junction readiness">
            {rows.map((row) => (
              <div className="corridor-row" key={row.nodeID}>
                <div><strong>{row.nodeID}</strong><span>{row.kind === "controlled" ? "Controlled junction" : "Boundary route point"}</span></div>
                <div><span>ETA</span><strong>{row.eta === null ? "—" : `${Math.round(row.eta)}s`}</strong></div>
                <div><span>Signal</span><strong>{row.kind === "controlled" && row.signal ? `${row.signal.replace("_", " ")} · ${Math.ceil(row.countdown ?? 0)}s` : "Not configured"}</strong></div>
              </div>
            ))}
          </div>
          <div className="emergency-recovery-grid">
            <div><span>Displaced cross-traffic queue</span><strong>{displaced.toFixed(0)} veh</strong></div>
            <div><span>Configured recovery bound</span><strong>{active.recovery_cycles_remaining > 0 ? `${active.recovery_cycles_remaining} cycles remaining` : stage === "complete" ? "Complete" : "Awaiting recovery"}</strong></div>
          </div>
          <div className="emergency-safety-note" role="status">
            {stage === "priority" || stage === "pre_clearance" ? <ShieldCheck size={17} /> : <Clock3 size={17} />}
            <p>{stage === "recovery" ? "Cross-traffic is selected by the bounded fairness recovery cycle. Completion remains a live state, not a clearance guarantee." : stage === "complete" ? "Configured recovery bound completed in the virtual scenario. Inspect live queues before drawing operational conclusions." : "Priority is scheduled only through the configured green → amber → all-red sequence and remains gated by receiving storage."}</p>
          </div>
        </>
      ) : (
        <div className="emergency-empty" role="status"><Siren size={21} /><p>Launch the seeded virtual ambulance corridor to view modeled ETA, safe signal transitions and recovery progress. C6 and C2 are boundary route points; they have no configured signals.</p></div>
      )}

      {blocked && <p className="emergency-blocked" role="alert"><AlertTriangle size={16} />{locked ? "Clear active manual timing locks before scheduling this protected scenario." : "A fresh authorized database and service connection is required to schedule the virtual scenario."}</p>}
      <div className="emergency-actions">
        <Button disabled={blocked || pending} onClick={onLaunch}>{pending ? "Scheduling…" : "Start virtual emergency"}</Button>
        <Button variant="outline" disabled={!active || !canOperate || pending} onClick={onReset}><RotateCcw size={15} /> Reset same seed</Button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
