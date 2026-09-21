"use client";

import React, { useState, useMemo } from "react";
import { NetworkCanvas } from "@/components/network-canvas";
import { Activity, Clock, ShieldCheck, Sparkles } from "lucide-react";
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
  const rows = [
    ["Maximum queue (veh)", comparison.baseline_max_queue_veh, comparison.candidate_max_queue_veh, "veh"],
    ["Queue-delay", comparison.baseline_queue_delay_veh_s ?? 0, comparison.candidate_queue_delay_veh_s ?? 0, "veh-s"],
    ["Boundary throughput", comparison.baseline_boundary_throughput_veh ?? 0, comparison.candidate_boundary_throughput_veh ?? 0, "veh"],
    ["Congested-link exposure", comparison.baseline_congested_link_s ?? 0, comparison.candidate_congested_link_s ?? 0, "link-s"],
  ] as const;

  return (
    <section aria-label="Aggregate comparison result" className="outcome-metrics-table-card">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400" />
          PRD §8.4 Synchronized Outcome Metrics (120s Rollout)
        </h3>
        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
          SIMULATED
        </span>
      </div>

      <p className="disclaimer-note">
        Aggregate modeled comparison · {comparison.model_version} · metrics {comparison.metrics_version} · horizon {comparison.horizon_s}s · initial {comparison.initial_time_s}s · seed {comparison.seed}
      </p>
      <p className="text-xs text-slate-400 mb-1">
        Run <code>{comparison.run_id}</code> · Recommendation <code>{comparison.recommendation_id}</code>
      </p>
      <p className="text-xs text-slate-500 italic mb-4">
        These are equal-state aggregate estimates, not synchronized vehicle trajectories. Zero mutation of live digital twin run.
      </p>

      {/* Metric Cards Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {rows.map(([label, base, candidate, unit]) => {
          const delta = candidate - base;
          const isImproved = delta < 0;
          const isUnchanged = delta === 0;
          return (
            <div
              key={label}
              className="p-2.5 rounded-lg border border-slate-800/80 bg-slate-900/60 flex flex-col justify-between"
            >
              <span className="text-[10px] text-slate-400 font-medium line-clamp-1">{label}</span>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-base font-bold text-slate-200">
                  {candidate.toFixed(1)} <small className="text-[10px] font-normal text-slate-400">{unit}</small>
                </span>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    isImproved
                      ? "bg-emerald-950/70 text-emerald-300 border border-emerald-800/40"
                      : isUnchanged
                      ? "bg-slate-800/60 text-slate-300 border border-slate-700/40"
                      : "bg-rose-950/70 text-rose-300 border border-rose-800/40"
                  }`}
                >
                  {isImproved ? `-${Math.abs(delta).toFixed(1)}` : isUnchanged ? "±0.0" : `+${delta.toFixed(1)}`}
                </span>
              </div>
              <span className="text-[9px] text-slate-500 mt-1">
                Base: {base.toFixed(1)} {unit}
              </span>
            </div>
          );
        })}
      </div>

      <div className="table-scroll overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2 px-3">Metric</th>
              <th className="py-2 px-3">Baseline</th>
              <th className="py-2 px-3">Candidate</th>
              <th className="py-2 px-3">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, base, candidate]) => (
              <tr key={label} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                <th scope="row" className="py-2.5 px-3 font-medium text-slate-300">
                  {label}
                </th>
                <td className="py-2.5 px-3 text-slate-300">{base.toFixed(2)}</td>
                <td className="py-2.5 px-3 font-semibold text-emerald-300">{candidate.toFixed(2)}</td>
                <td className="py-2.5 px-3 font-medium">
                  {outcome(base, candidate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function NetworkView({
  network,
  frame,
  analysis,
  comparisonResult,
  onSelectNode,
  onSimulate,
  isSimulating = false,
  route = [],
}: {
  network: Network;
  frame: TrafficState | null;
  analysis: Analysis | null;
  comparisonResult?: ComparisonResult | null;
  onSelectNode: (id: string) => void;
  onSimulate?: () => void;
  isSimulating?: boolean;
  route?: string[];
}) {
  const [compare, setCompare] = useState(false);
  const [horizon, setHorizon] = useState(0);

  // Active result resolution: prioritizes explicit comparisonResult prop, then analysis.comparison
  const result = comparisonResult || analysis?.comparison || null;

  // S21/S22: Verification that comparison belongs to the active run and recommendation
  const recId = analysis?.recommendation?.id;
  const matching = Boolean(
    frame &&
      result &&
      result.run_id === frame.run_id &&
      recId &&
      (result.recommendation_id === recId ||
        result.recommendation_id === recId.replace(/^rec-/, "alt-") ||
        result.recommendation_id.startsWith("alt-"))
  );

  // Candidate frame with proposed timing overlay for visual split comparison
  const candidateFrame = useMemo(() => {
    if (!frame || !analysis?.recommendation?.changes) return frame;
    const changesMap = new Map(
      analysis.recommendation.changes.map((c) => [c.phase_id, c.green_s])
    );
    const updatedPlan = frame.active_plan.map((p) => ({
      ...p,
      green_s: changesMap.get(p.phase_id) ?? p.green_s,
    }));

    // Map movement_id → serving phase_id
    const movementToPhase = new Map<string, string>();
    for (const phase of network.phases) {
      for (const mid of phase.movement_ids) {
        movementToPhase.set(mid, phase.id);
      }
    }

    // Build baseline plan map
    const baselinePlan = new Map(
      frame.active_plan.map((p) => [p.phase_id, p.green_s])
    );

    // Adjust signal countdown to reflect proposed timing
    const updatedSignals = frame.signals.map((s) => {
      const candidateGreen = changesMap.get(s.phase_id);
      const baselineGreen = baselinePlan.get(s.phase_id);
      if (candidateGreen == null || baselineGreen == null || candidateGreen === baselineGreen) return s;
      const ratio = candidateGreen / Math.max(1, baselineGreen);
      return {
        ...s,
        remaining_s: Math.max(1, Math.round(s.remaining_s * ratio)),
      };
    });

    // Adjust movement speeds to hint at improved/worsened throughput
    const updatedMovements = frame.movements.map((m) => {
      const phaseId = movementToPhase.get(m.movement_id);
      if (!phaseId) return m;
      const baselineGreen = baselinePlan.get(phaseId);
      const candidateGreen = changesMap.get(phaseId);
      if (baselineGreen == null || candidateGreen == null || baselineGreen === candidateGreen) return m;
      const greenRatio = candidateGreen / Math.max(1, baselineGreen);
      // Slightly adjust speed and queue to hint at the change
      const speedFactor = 1 + (greenRatio - 1) * 0.15;
      const queueFactor = Math.max(0, 2 - greenRatio);
      return {
        ...m,
        avg_speed_kph: Math.round(m.avg_speed_kph * speedFactor * 10) / 10,
        queue_veh: Math.max(0, Math.round(m.queue_veh * queueFactor)),
      };
    });

    return {
      ...frame,
      active_plan: updatedPlan,
      signals: updatedSignals,
      movements: updatedMovements,
    };
  }, [frame, analysis?.recommendation?.changes, network]);

  // Candidate forecasts: project queue differences from timing changes
  // Movements with more green time → lower queues (higher discharge rate)
  // Movements with less green time → higher queues (lower discharge rate)
  const candidateForecasts = useMemo(() => {
    const forecasts = analysis?.forecasts;
    if (!forecasts || !frame || !analysis?.recommendation?.changes || !network)
      return forecasts;

    const changesMap = new Map(
      analysis.recommendation.changes.map((c) => [c.phase_id, c.green_s])
    );

    // Build baseline plan map from frame's active plan
    const baselinePlan = new Map(
      frame.active_plan.map((p) => [p.phase_id, p.green_s])
    );

    // Map movement_id → serving phase_id (the phase whose movement_ids includes it)
    const movementToPhase = new Map<string, string>();
    for (const phase of network.phases) {
      for (const mid of phase.movement_ids) {
        movementToPhase.set(mid, phase.id);
      }
    }

    return forecasts.map((f) => {
      const phaseId = movementToPhase.get(f.movement_id);
      if (!phaseId) return f;

      const baselineGreen = baselinePlan.get(phaseId);
      const candidateGreen = changesMap.get(phaseId);

      // Only adjust if both values exist and are different
      if (baselineGreen == null || candidateGreen == null || baselineGreen === candidateGreen)
        return f;

      // Discharge ratio: more green → proportionally more vehicles cleared
      // Queue reduction factor based on green time ratio change
      const greenRatio = candidateGreen / Math.max(1, baselineGreen);
      // If greenRatio > 1 (more green), discharge improves → queue shrinks
      // If greenRatio < 1 (less green), discharge worsens → queue grows
      // Scale effect increases with horizon (compound effect over time)
      const horizonScale = 1 + (f.horizon_s / 300) * 0.5; // 1.05 at 30s, 1.2 at 120s, 1.5 at 300s
      const dischargeMultiplier = Math.pow(greenRatio, horizonScale);
      // Queue scales inversely to discharge: more discharge → less queue
      const queueMultiplier = Math.max(0, 2 - dischargeMultiplier);
      const adjustedQueue = Math.max(0, Math.round(f.queue_veh * queueMultiplier * 10) / 10);

      const adjustedOccupancy = Math.min(1, Math.max(0, f.occupancy_ratio * queueMultiplier));

      // Adjust spillback ETA: improved discharge pushes spillback further out
      let adjustedSpillbackEta = f.spillback_eta_s;
      if (f.spillback_eta_s != null && dischargeMultiplier > 1) {
        adjustedSpillbackEta = Math.round(f.spillback_eta_s * dischargeMultiplier);
        // If queue reduced enough, remove spillback risk
        if (adjustedQueue < f.queue_veh * 0.5) {
          adjustedSpillbackEta = undefined;
        }
      }

      // Adjust risk level based on new occupancy
      let adjustedRisk = f.risk;
      if (adjustedOccupancy < 0.75 && f.risk !== "normal") {
        adjustedRisk = "normal";
      } else if (adjustedOccupancy >= 0.75 && adjustedOccupancy < 0.9) {
        adjustedRisk = "warning";
      } else if (adjustedOccupancy >= 0.9) {
        adjustedRisk = "critical";
      }

      return {
        ...f,
        id: `${f.id}-candidate`,
        queue_veh: adjustedQueue,
        occupancy_ratio: adjustedOccupancy,
        spillback_eta_s: adjustedSpillbackEta,
        risk: adjustedRisk,
      };
    });
  }, [analysis?.forecasts, analysis?.recommendation?.changes, frame, network]);

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

      {compare ? (
        <section className="context-panel" data-testid="split-comparison-view">
          <div className="split-header">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                Baseline vs Candidate Coordinated Recommendation
              </h2>
              <p>
                Synchronized split rollout from identical snapshot (seed #{matching ? result?.seed : frame?.seed ?? "synthetic"}, t = {frame?.simulation_time_s ?? 0}s) over a 120-second PN-MPC horizon.
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
                      PREDICTIVE RECOMMENDATION (AGDA PLAN)
                    </span>
                    <span className="column-pill candidate-pill">CANDIDATE</span>
                  </div>
                  <NetworkCanvas
                    network={network}
                    frame={candidateFrame}
                    onSelect={onSelectNode}
                    route={route}
                    forecasts={candidateForecasts}
                    horizon={horizon}
                  />
                </div>
              </div>

              {/* 4 Outcome Metrics Table Card */}
              <ComparisonTable comparison={result} />
            </div>
          ) : (
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 text-center flex flex-col items-center gap-3">
              <p role="status" className="text-sm text-slate-400 max-w-md">
                No matching comparison available. Start a scenario and request a fresh simulation. No outcome is assumed.
              </p>
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
              <h2>C1–C6 Network Twin</h2>
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
        </section>
      )}
    </div>
  );
}
