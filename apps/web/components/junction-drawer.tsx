"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Clock,
  GitBranch,
  Layers,
  Lock,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Unlock,
} from "lucide-react";
import { Button } from "./ui/button";
import type { Network, Node } from "../../../packages/contracts/typescript/network";
import type {
  Analysis,
  Forecast,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

const horizons = [
  { label: "NOW", seconds: 0, tag: "current state" },
  { label: "+30s", seconds: 30, tag: "simulation forecast" },
  { label: "+1m", seconds: 60, tag: "simulation forecast" },
  { label: "+2m", seconds: 120, tag: "simulation forecast" },
  { label: "+5m", seconds: 300, tag: "5-minute output advisory" },
] as const;

export function JunctionDrawerContent({
  chosen,
  network,
  frame,
  analysis,
  activeLocks = [],
  onToggleLock,
  canLock = true,
}: {
  chosen: Node;
  network: Network;
  frame: TrafficState | null;
  analysis: Analysis | null;
  activeLocks?: string[];
  onToggleLock?: (target: string, locked: boolean) => void;
  canLock?: boolean;
}) {
  const [selectedHorizon, setSelectedHorizon] = useState<number>(0);

  const signal = frame?.signals.find((s) => s.node_id === chosen.id);
  const movements = frame?.movements.filter((m) =>
    network.movements.some(
      (c) => c.id === m.movement_id && c.node_id === chosen.id,
    ),
  );

  // Connected links
  const incomingLinks = network.links.filter((l) => l.to_node === chosen.id);
  const outgoingLinks = network.links.filter((l) => l.from_node === chosen.id);
  const phases = network.phases.filter((p) => p.node_id === chosen.id);

  // Filter forecasts for movements at this junction
  const junctionForecasts = (analysis?.forecasts ?? []).filter((f) =>
    network.movements.some(
      (c) => c.id === f.movement_id && c.node_id === chosen.id,
    ),
  );

  // Horizon-specific forecasts
  const activeForecasts = junctionForecasts.filter(
    (f) => f.horizon_s === selectedHorizon,
  );

  // Spillback forecast for this junction
  const spillbackForecast = junctionForecasts.find(
    (f) => f.spillback_eta_s != null && f.spillback_eta_s > 0,
  );

  // Active recommendation affecting this junction
  const recommendation = analysis?.recommendation;
  const junctionChanges = recommendation?.changes.filter((c) =>
    phases.some((p) => p.id === c.phase_id),
  );

  const explanationText = spillbackForecast?.explanation_facts?.join(" ") || (chosen.kind === "boundary" ? `Node ${chosen.id} is a configured boundary; it has no controlled signal.` : "No fresh causal explanation is available for this junction.");

  const currentHorizonObj = horizons.find((h) => h.seconds === selectedHorizon) ?? horizons[0];

  return (
    <div className="junction-drawer-body">
      {/* Node Metadata Header */}
      <div className="drawer-facts">
        <div>
          <span>Node Type</span>
          <strong>{chosen.kind === "controlled" ? "Controlled Junction" : "Boundary Node"}</strong>
        </div>
        <div>
          <span>Coordinates</span>
          <strong>
            {chosen.x}, {chosen.y}
          </strong>
        </div>
      </div>

      {/* Signal Status Pill */}
      {signal && (
        <div className="drawer-signal-header">
          <div className="signal-lead">
            <span className={`signal-light ${signal.indication}`} />
            <div>
              <strong>{signal.phase_id}</strong>
              <span className="signal-indication-name">
                {signal.indication.replace("_", " ")} indication
              </span>
            </div>
          </div>
          <div className="signal-countdown-pill">
            <Clock size={13} />
            <span>{signal.remaining_s}s remaining</span>
          </div>
        </div>
      )}

      {/* HORIZON SELECTOR (Story S10) */}
      <section className="drawer-horizon-section" aria-label="Forecast horizons">
        <div className="section-header-row">
          <div className="overline">FORWARD HORIZONS</div>
          <span className="horizon-badge">{currentHorizonObj.tag}</span>
        </div>

        <div className="horizon-tabs" role="group" aria-label="Select forecast horizon">
          {horizons.map((h) => (
            <button
              key={h.seconds}

              aria-pressed={selectedHorizon === h.seconds}
              className={`horizon-tab ${selectedHorizon === h.seconds ? "active" : ""}`}
              onClick={() => setSelectedHorizon(h.seconds)}
            >
              <span className="horizon-tab-label">{h.label}</span>
            </button>
          ))}
        </div>

        <p className="horizon-disclaimer">
          {selectedHorizon === 0
            ? "Live 1 Hz measurements from synthetic SUMO simulation."
            : selectedHorizon === 300
              ? "5-minute output advisory · Conservation model · No invented confidence bands."
              : "Simulation forecast · Conservation model · No invented confidence bands."}
        </p>

        {/* Forecast / Current Movement Metrics */}
        {selectedHorizon === 0 ? (
          /* NOW: Live approach measurements */
          movements?.length ? (
            <div className="movement-cards-list">
              {movements.map((m) => (
                <article className="drawer-movement-card" key={m.movement_id}>
                  <div className="card-top">
                    <strong>{m.movement_id}</strong>
                    <span className={`permission-badge ${m.permission}`}>
                      {m.permission}
                    </span>
                  </div>
                  <div className="metrics-grid">
                    <div>
                      <span className="m-label">Queue</span>
                      <strong className="m-val">{m.queue_veh} veh</strong>
                    </div>
                    <div>
                      <span className="m-label">Speed</span>
                      <strong className="m-val">{m.avg_speed_kph.toFixed(1)} km/h</strong>
                    </div>
                    <div>
                      <span className="m-label">Arrival / Departure</span>
                      <strong className="m-val">
                        {m.arrival_rate_vpm.toFixed(0)} / {m.departure_rate_vpm.toFixed(0)} vpm
                      </strong>
                    </div>
                    <div>
                      <span className="m-label">Storage Occupancy</span>
                      <strong className="m-val">{Math.round(m.occupancy_ratio * 100)}%</strong>
                    </div>
                    <div>
                      <span className="m-label">Downstream Space</span>
                      <strong className="m-val">{m.downstream_capacity_veh} veh</strong>
                    </div>
                    <div>
                      <span className="m-label">Max Wait Time</span>
                      <strong className="m-val">{m.waiting_age_s.toFixed(0)}s</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="drawer-note-text">
              {chosen.kind === "boundary"
                ? "Boundary node: free-flow connection without controlled signal phases."
                : "No movement measurements available. Start a scenario to receive stream."}
            </p>
          )
        ) : (
          /* FORWARD HORIZONS: +30s, +1m, +2m, +5m */
          activeForecasts.length > 0 ? (
            <div className="movement-cards-list">
              {activeForecasts.map((f) => (
                <article className={`drawer-movement-card forecast-${f.risk}`} key={f.id}>
                  <div className="card-top">
                    <strong>{f.movement_id}</strong>
                    <span className={`risk-badge ${f.risk}`}>
                      {f.risk.toUpperCase()} RISK
                    </span>
                  </div>
                  <div className="metrics-grid">
                    <div>
                      <span className="m-label">Predicted Queue</span>
                      <strong className="m-val">{f.queue_veh.toFixed(1)} veh</strong>
                    </div>
                    <div>
                      <span className="m-label">Predicted Storage</span>
                      <strong className="m-val">{Math.round(f.occupancy_ratio * 100)}%</strong>
                    </div>
                    <div>
                      <span className="m-label">Expected Arrivals</span>
                      <strong className="m-val">{f.arrivals_veh.toFixed(1)} veh</strong>
                    </div>
                    <div>
                      <span className="m-label">Spillback ETA</span>
                      <strong className={`m-val ${f.spillback_eta_s ? "critical" : ""}`}>
                        {f.spillback_eta_s != null ? `${f.spillback_eta_s}s` : "None"}
                      </strong>
                    </div>
                  </div>
                  {/* Platoon Waveform & Storage Progress (Story S11, S12) */}
                  <div className="platoon-progression-bar" title="Modeled arrivals over the selected horizon">
                    <div className="bar-labels">
                      <span className="wave-label"><GitBranch size={11} /> Modeled arrivals</span>
                      <span className="wave-val">{f.arrivals_veh.toFixed(1)} veh</span>
                    </div>
                    <div className="bar-track">
                      <div
                        className={`bar-fill ${f.risk}`}
                        style={{ width: `${Math.min(100, Math.max(8, (f.arrivals_veh / 35) * 100))}%` }}
                      />
                    </div>
                  </div>

                  {f.explanation_facts.length > 0 && (
                    <div className="forecast-facts-list">
                      {f.explanation_facts.map((fact, idx) => (
                        <p key={idx} className="forecast-fact-note">
                          {fact}
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="forecast-empty-state">
              <Activity size={18} />
              <p>
                Forecast for +{selectedHorizon}s is calculating or outside active horizon window.
                Analysis is refreshed separately from the traffic stream; retry when intelligence is available.
              </p>
            </div>
          )
        )}
      </section>

      {/* WHY THIS IS HAPPENING (Story S10) */}
      <section className="drawer-why-section">
        <div className="overline">DETERMINISTIC CAUSE ANALYSIS</div>
        <h3>Why this is happening</h3>
        <p className="drawer-narrative-text">{explanationText}</p>

        {spillbackForecast && (
          <div className="spillback-alert-box">
            <AlertTriangle size={18} className="alert-icon" />
            <div>
              <strong>
                Spillback ETA: {spillbackForecast.spillback_eta_s} seconds
              </strong>
              <p>
                Upstream storage overflow projected at {spillbackForecast.movement_id} without timing adjustment.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* RECOMMENDATION SUMMARY (Story S10) */}
      <section className="drawer-rec-section">
        <div className="overline">RECOMMENDATION IMPACT</div>
        <h3>Proposed signal timing adjustment</h3>
        {junctionChanges && junctionChanges.length > 0 ? (
          <div className="rec-impact-card">
            <div className="rec-header">
              <span className="rec-status-badge">Candidate Plan</span>
              <span className="safety-guarantee">{recommendation?.safety_status || "Not validated"}</span>
            </div>
            <ul className="rec-changes-list">
              {junctionChanges.map((c) => (
                <li key={c.phase_id}>
                  <strong>Phase {c.phase_id}</strong>: adjust green time to{" "}
                  <b>{c.green_s} seconds</b>
                </li>
              ))}
            </ul>
            <p>Safety status: {recommendation?.safety_status || "Requires fresh validation"}. Impact is available only in a matching aggregate comparison.</p>
          </div>
        ) : (
          <p className="drawer-note-text">
            No active timing changes recommended for {chosen.id}. No safety or traffic-flow conclusion is inferred from missing recommendations.
          </p>
        )}
      </section>

      {/* TIMING LOCKS & MOVEMENT PROTECTION (Story S13 / S14) */}
      <section className="drawer-locks-section" aria-label="Timing locks and safety controls">
        <div className="section-header-row">
          <div className="overline">SAFETY ENVELOPE & TIMING LOCKS</div>
          <span className="horizon-badge">Operator Authority</span>
        </div>
        <h3>Phase & Movement Locks</h3>
        <p className="drawer-narrative-text">
          Operator locks prevent automated recommendations from altering signal timing on protected phases or movements. Under Story S13, any candidate plan affecting a locked target is immediately refused.
        </p>

        {phases.length > 0 && (
          <div className="locks-subsection">
            <h4 className="locks-subheading">Controlled Phases</h4>
            <div className="locks-list">
              {phases.map((p) => {
                const isLocked = activeLocks.includes(p.id);
                return (
                  <div key={p.id} className={`lock-item-row ${isLocked ? "locked" : ""}`}>
                    <div className="lock-item-info">
                      <div className="lock-item-header">
                        <strong>Phase {p.id}</strong>
                        <span className={`lock-status-chip ${isLocked ? "active-lock" : "unlocked"}`}>
                          {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                          {isLocked ? "LOCKED" : "UNLOCKED"}
                        </span>
                      </div>
                      <span className="lock-item-details">
                        Min: {p.min_green_s}s · Max: {p.max_green_s}s · Amber: {p.amber_s}s · All-Red: {p.all_red_s}s
                      </span>
                    </div>
                    {onToggleLock && (
                      <Button
                        variant={isLocked ? "default" : "outline"}
                        disabled={!canLock}
                        onClick={() => onToggleLock(p.id, !isLocked)}
                        aria-label={`${isLocked ? "Unlock" : "Lock"} phase ${p.id}`}
                      >
                        {isLocked ? <Unlock size={13} /> : <Lock size={13} />}
                        <span>{isLocked ? "Unlock" : "Lock"}</span>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {movements && movements.length > 0 && (
          <div className="locks-subsection">
            <h4 className="locks-subheading">Approaching Movements</h4>
            <div className="locks-list">
              {movements.map((m) => {
                const isLocked = activeLocks.includes(m.movement_id);
                return (
                  <div key={m.movement_id} className={`lock-item-row ${isLocked ? "locked" : ""}`}>
                    <div className="lock-item-info">
                      <div className="lock-item-header">
                        <strong>Movement {m.movement_id}</strong>
                        <span className={`lock-status-chip ${isLocked ? "active-lock" : "unlocked"}`}>
                          {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                          {isLocked ? "LOCKED" : "UNLOCKED"}
                        </span>
                      </div>
                      <span className="lock-item-details">
                        Queue: {m.queue_veh} veh · Storage: {Math.round(m.occupancy_ratio * 100)}%
                      </span>
                    </div>
                    {onToggleLock && (
                      <Button
                        variant={isLocked ? "default" : "outline"}
                        disabled={!canLock}
                        onClick={() => onToggleLock(m.movement_id, !isLocked)}
                        aria-label={`${isLocked ? "Unlock" : "Lock"} movement ${m.movement_id}`}
                      >
                        {isLocked ? <Unlock size={13} /> : <Lock size={13} />}
                        <span>{isLocked ? "Unlock" : "Lock"}</span>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Connected Links and Configuration Details */}
      <section className="drawer-config-section">
        <div className="overline">JUNCTION TOPOLOGY</div>
        <h3>Connected Links</h3>
        <div className="links-summary-list">
          {incomingLinks.map((l) => (
            <div className="link-summary-item" key={l.id}>
              <span className="link-dir">
                INCOMING: {l.from_node} → {l.to_node}
              </span>
              <span className="link-details">
                {l.length_m}m · {l.lanes} lanes · {l.storage_capacity_veh} veh capacity
              </span>
            </div>
          ))}
          {outgoingLinks.map((l) => (
            <div className="link-summary-item" key={l.id}>
              <span className="link-dir">
                OUTGOING: {l.from_node} → {l.to_node}
              </span>
              <span className="link-details">
                {l.length_m}m · {l.lanes} lanes · {l.storage_capacity_veh} veh capacity
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
