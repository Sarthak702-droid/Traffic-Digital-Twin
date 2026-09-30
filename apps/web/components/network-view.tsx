"use client";

import React, { useState } from "react";
import { comparisonMatchesAnalysis } from "@/lib/decision-identity";
import { MatchedComparison } from "@/components/matched-comparison";
import { NetworkCanvas } from "@/components/network-canvas";
import { Clock, ShieldCheck, Sparkles } from "lucide-react";
import type { Network } from "../../../packages/contracts/typescript/network";
import type {
  Analysis,
  ComparisonResult,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

export function outcome(base: number, candidate: number) {
  const delta = candidate - base;
  if (delta === 0) return "Unchanged";
  const percent =
    base === 0 ? "baseline is zero" : `${Math.abs((delta / base) * 100).toFixed(1)}%`;
  return `${delta < 0 ? "Improved" : "Worse"}: ${Math.abs(delta).toFixed(2)} (${percent})`;
}

export function ComparisonTable({ comparison }: { comparison: ComparisonResult }) {
  return <MatchedComparison result={comparison} />;
}

export function NetworkView({
  network,
  frame,
  analysis,
  comparisonResult,
  onSelectNode,
  onSimulate,
  isSimulating = false,
  onStartScenario,
  isStartingScenario = false,
  route = [],
}: {
  network: Network;
  frame: TrafficState | null;
  analysis: Analysis | null;
  comparisonResult?: ComparisonResult | null;
  onSelectNode: (id: string) => void;
  onSimulate?: () => void;
  isSimulating?: boolean;
  /** Starts the seeded aggregate scenario needed before any comparison exists. */
  onStartScenario?: () => void;
  isStartingScenario?: boolean;
  route?: string[];
}) {
  const [compare, setCompare] = useState(false);
  const [horizon, setHorizon] = useState(0);

  // Active result resolution: prioritizes explicit comparisonResult prop, then analysis.comparison
  const result = comparisonResult || analysis?.comparison || null;

  // S21/S22: Verification that comparison belongs to the active run and recommendation
  const recId = analysis?.recommendation?.id;
  const matching = comparisonMatchesAnalysis(result,analysis,frame,recId);

  // Candidate outcomes are read from the server comparison result below.

  return (
    <div className="network-screen-container" data-testid="network-view">
      <div className="network-screen-controls">
        <div className="network-mode-toggles">
          <button
            className={`network-tab-btn ${!compare ? "active" : ""}`}
            aria-pressed={!compare}
            onClick={() => setCompare(false)}
          >
            Full Digital Twin
          </button>
          <button
            className={`network-tab-btn ${compare ? "active" : ""}`}
            aria-pressed={compare}
            onClick={() => setCompare(true)}
          >
            Before vs After · Aggregate comparison
          </button>
        </div>

        <div className="time-slider-buttons" aria-label="Forecast horizon">
          {[0, 30, 60, 120, 300].map((t) => (
            <button
              className={`ts-btn ${horizon === t ? "active" : ""}`}
              key={t}
              aria-pressed={horizon === t}
              onClick={() => setHorizon(t)}
            >
              {t === 0 ? "NOW" : `+${t}s`}
            </button>
          ))}
        </div>
      </div>

      {!frame && onStartScenario && !compare && <div className="panel-message"><p>No virtual run is active. Start the configured scenario to see road-cell stock, flows and signal countdowns.</p><button onClick={onStartScenario} disabled={isStartingScenario}>{isStartingScenario?"Starting simulation…":"Start simulation"}</button></div>}
      {compare ? (
        <section className="context-panel" data-testid="split-comparison-view">
          <div className="split-header">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                Baseline vs Candidate Coordinated Recommendation
              </h2>
              <p>
                Synchronized aggregate rollout from an identical snapshot (seed #{matching ? result?.seed : frame?.seed ?? "synthetic"}, t = {frame?.simulation_time_s ?? 0}s) over a 120-second horizon.
              </p>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
              SIMULATED
            </span>
          </div>

          {matching && result ? (
            <div className="flex flex-col gap-5">
              {/* Dual-Canvas Split View (PRD §8.4) */}
              <div className="split-canvases-grid">
                {/* Left: Baseline Strategy */}
                <div className="split-canvas-column" data-testid="baseline-canvas-column">
                  <div className="split-column-title">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      BASELINE STRATEGY (CURRENT TIMING)
                    </span>
                    <span className="column-pill baseline-pill">BASELINE</span>
                  </div>
                  <NetworkCanvas
                    network={network}
                    frame={frame}
                    onSelect={onSelectNode}
                    route={route}
                    forecasts={analysis?.forecasts}
                    horizon={horizon}
                  />
                </div>

                {/* Right: Predictive Recommendation */}
                <div className="split-canvas-column" data-testid="candidate-canvas-column">
                  <div className="split-column-title">
                    <span className="text-xs font-semibold text-emerald-300 flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                      CANDIDATE PLAN · SAME INITIAL STATE
                    </span>
                    <span className="column-pill candidate-pill">CANDIDATE</span>
                  </div>
                  <NetworkCanvas
                    network={network}
                    frame={frame}
                    onSelect={onSelectNode}
                    route={route}
                    forecasts={[]}
                    horizon={0}
                  />
                  <p className="disclaimer-note">Per-link candidate forecasts are unavailable. The table below contains the model&apos;s evaluated network-wide candidate outcomes.</p>
                </div>
              </div>

              {/* 4 Outcome Metrics Table Card */}
              <MatchedComparison result={result} />
            </div>
          ) : (
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 text-center flex flex-col items-center gap-3">
              <p role="status" className="text-sm text-slate-400 max-w-md">
                {!frame
                  ? "No aggregate scenario is running. Start a scenario with the selected demand source; the intelligence service will then produce a recommendation and comparison."
                  : !analysis
                    ? "Aggregate state is running; waiting for a fresh causal intelligence result before a comparison can be requested."
                    : "No matching comparison available. Request a fresh simulation. No outcome is assumed."}
              </p>
              {!frame && onStartScenario && (
                <button
                  type="button"
                  onClick={onStartScenario}
                  disabled={isStartingScenario}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-md transition disabled:opacity-50 flex items-center gap-2"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {isStartingScenario ? "Starting aggregate scenario..." : "Start peak-surge aggregate demo"}
                </button>
              )}
              {analysis?.recommendation && onSimulate && (
                <button
                  type="button"
                  onClick={onSimulate}
                  disabled={isSimulating}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-md transition disabled:opacity-50 flex items-center gap-2"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {isSimulating ? "Simulating in Digital Twin..." : "Simulate in Digital Twin (120s Rollout)"}
                </button>
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="network-panel">
          <div className="panel-heading">
            <div>
              <h2>{network.name} · Virtual simulation</h2>
              <span>
                {frame?.replay
                  ? "Prerecorded replay"
                  : frame
                  ? "Live synthetic state"
                  : "Configuration only · measurements unavailable"}
                {horizon === 300 ? " · 5-minute advisory" : ""}
              </span>
            </div>
            <span className="quiet-badge">
              {frame?.replay ? "REPLAY" : frame ? "LIVE" : "UNAVAILABLE"}
            </span>
          </div>
          <NetworkCanvas
            network={network}
            frame={frame}
            onSelect={onSelectNode}
            route={route}
            forecasts={analysis?.forecasts}
            horizon={horizon}
          />
          <div className="network-flow-table-wrap" role="region" aria-label="Turning movement detection and prediction">
            <h3>{network.movements.length} configured turning movements</h3>
            <p>Current queues and departures come from the virtual network. Future queues use the causal forecast for the selected horizon.</p>
            <table><thead><tr><th>Movement</th><th>Signal</th><th>Current queue</th><th>Departure flow</th><th>Predicted queue</th></tr></thead>
              <tbody>{network.movements.map((movement) => {
                const current = frame?.movements.find((item) => item.movement_id === movement.id);
                const future = analysis?.forecasts.find((item) => item.movement_id === movement.id && item.horizon_s === (horizon || 30));
                return <tr key={movement.id}><th scope="row">{movement.incoming_link_id} → {movement.outgoing_link_id}</th><td>{current?.permission ?? "—"}</td><td>{current ? `${current.queue_veh.toFixed(1)} veh` : "—"}</td><td>{current ? `${current.departure_rate_vpm.toFixed(1)} veh/min` : "—"}</td><td>{future ? `${future.queue_veh.toFixed(1)} veh (+${future.horizon_s}s)` : "—"}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
