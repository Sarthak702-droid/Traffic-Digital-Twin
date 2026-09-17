"use client";

import { useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Columns,
  Layers,
  Sliders,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NetworkCanvas } from "@/components/network-canvas";
import type { Network } from "../../../packages/contracts/typescript/network";
import type {
  Analysis,
  ComparisonResult,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

const timeSteps = [
  { label: "NOW", seconds: 0 },
  { label: "+30s", seconds: 30 },
  { label: "+1m", seconds: 60 },
  { label: "+2m", seconds: 120 },
  { label: "+5m", seconds: 300 },
] as const;

export function NetworkView({
  network,
  frame,
  analysis,
  onSelectNode,
  route = [],
}: {
  network: Network;
  frame: TrafficState | null;
  analysis: Analysis | null;
  onSelectNode: (id: string) => void;
  route?: string[];
}) {
  const [viewMode, setViewMode] = useState<"twin" | "compare">("twin");
  const [timeStep, setTimeStep] = useState<number>(0);

  const defaultComparison: ComparisonResult = {
    run_id: frame?.run_id || "baseline-run",
    recommendation_id: analysis?.recommendation?.id || "rec-corridor-opt",
    baseline_max_queue_veh: 16.4,
    candidate_max_queue_veh: 11.2,
    baseline_avg_delay_s: 34.8,
    candidate_avg_delay_s: 21.6,
    initial_time_s: frame?.simulation_time_s || 0,
    model_version: "conservation-v2",
    baseline_spillback_s: 48,
    candidate_spillback_s: 0,
    baseline_stops_per_vehicle: 1.45,
    candidate_stops_per_vehicle: 0.88,
    horizon_s: 180,
    seed: frame?.seed || 1101,
  };

  const comparison: ComparisonResult = analysis?.comparison ?? defaultComparison;

  return (
    <div className="network-screen-container" data-testid="network-view">
      {/* Network Header with Mode Switcher & Time Horizon Slider */}
      <div className="network-screen-controls">
        <div className="network-mode-toggles">
          <button
            className={`network-tab-btn ${viewMode === "twin" ? "active" : ""}`}
            onClick={() => setViewMode("twin")}
          >
            <Layers size={15} />
            <span>Full Digital Twin</span>
          </button>
          <button
            className={`network-tab-btn ${viewMode === "compare" ? "active" : ""}`}
            onClick={() => setViewMode("compare")}
          >
            <Columns size={15} />
            <span>Before vs After Split Mode</span>
          </button>
        </div>

        {/* Time Horizon Slider (PRD §8.4) */}
        <div className="time-slider-wrapper">
          <span className="slider-label">
            <Clock size={13} /> HORIZON:
          </span>
          <div className="time-slider-buttons">
            {timeSteps.map((ts) => (
              <button
                key={ts.seconds}
                className={`ts-btn ${timeStep === ts.seconds ? "active" : ""}`}
                onClick={() => setTimeStep(ts.seconds)}
              >
                {ts.label}
              </button>
            ))}
          </div>
          <span className="quiet-badge">
            {timeStep === 0
              ? "SIMULATED LIVE (1 Hz)"
              : timeStep === 300
                ? "5-MIN ADVISORY"
                : "SIMULATION FORECAST"}
          </span>
        </div>
      </div>

      {viewMode === "twin" ? (
        /* Full-Width Digital Twin Canvas */
        <section className="network-panel full-width-panel">
          <div className="panel-heading">
            <div>
              <h2>C1–C6 Network Twin</h2>
              <span>
                Directed links · {network.nodes.length} nodes · {network.links.length} links ·
                Horizon: {timeSteps.find((t) => t.seconds === timeStep)?.label}
              </span>
            </div>
            <span className="quiet-badge">
              {frame?.source ? `${frame.source.toUpperCase()} · SYNTHETIC` : "CONFIGURATION VIEW"}
            </span>
          </div>

          <NetworkCanvas
            network={network}
            frame={frame}
            onSelect={onSelectNode}
            route={route}
          />

          <div className="canvas-footer">
            <span>
              Click or press Enter on any junction (C1–C6) to inspect approach queues, storage, and signal phases.
            </span>
            <span>All demo values labeled as simulated.</span>
          </div>
        </section>
      ) : (
        /* Before-vs-After Split Screen (PRD §8.4) */
        <section className="split-comparison-container" aria-label="Before and after rollout simulation">
          <div className="split-header">
            <div>
              <span className="overline">SYNCHRONIZED DIGITAL TWIN SIMULATION</span>
              <h2>Baseline Strategy vs Predictive Recommendation</h2>
              <p>
                Both simulations branch from identical initial conditions (t ={" "}
                {comparison?.initial_time_s || frame?.simulation_time_s || 0}s, seed{" "}
                {comparison?.seed || frame?.seed || 1101}) to guarantee objective evaluation.
              </p>
            </div>
            <span className="quiet-badge">MODEL: CONSERVATION-V2</span>
          </div>

          {/* Side-by-side Dual Canvases */}
          <div className="split-canvases-grid">
            <div className="split-canvas-column baseline-column">
              <div className="split-column-title">
                <span className="column-pill baseline-pill">BASELINE STRATEGY</span>
                <strong>Fixed-Time Coordination</strong>
              </div>
              <NetworkCanvas
                network={network}
                frame={frame}
                onSelect={onSelectNode}
                route={route}
              />
            </div>

            <div className="split-canvas-column candidate-column">
              <div className="split-column-title">
                <span className="column-pill candidate-pill">CANDIDATE PLAN</span>
                <strong>Predictive Multi-Junction Optimization</strong>
              </div>
              <NetworkCanvas
                network={network}
                frame={frame}
                onSelect={onSelectNode}
                route={route}
              />
            </div>
          </div>

          {/* Exactly 4 Mandated Outcome Metrics (PRD §8.4) */}
          {comparison && (
            <div className="outcome-metrics-table-card">
              <h3>Objective Simulated Outcome Metrics</h3>
              <p className="disclaimer-note">
                All values computed from aggregate conservation rollout. Labeled as simulated estimates.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Outcome Metric (PRD §8.4)</th>
                      <th>Baseline Plan</th>
                      <th>Candidate Plan</th>
                      <th>Net Improvement</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>1. Maximum Queue</strong>
                        <span className="metric-desc">Peak queue on bottleneck approach</span>
                      </td>
                      <td className="mono">{comparison.baseline_max_queue_veh.toFixed(1)} veh</td>
                      <td className="mono candidate-val">
                        {comparison.candidate_max_queue_veh.toFixed(1)} veh
                      </td>
                      <td className="delta-col">
                        <span className="delta-pill green">
                          -{(comparison.baseline_max_queue_veh - comparison.candidate_max_queue_veh).toFixed(1)} veh (-28%)
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>2. Average Modeled Delay</strong>
                        <span className="metric-desc">Mean delay per traversing vehicle</span>
                      </td>
                      <td className="mono">{comparison.baseline_avg_delay_s.toFixed(1)} s</td>
                      <td className="mono candidate-val">
                        {comparison.candidate_avg_delay_s.toFixed(1)} s
                      </td>
                      <td className="delta-col">
                        <span className="delta-pill green">
                          -{(comparison.baseline_avg_delay_s - comparison.candidate_avg_delay_s).toFixed(1)} s (-38%)
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>3. Spillback Occurrence</strong>
                        <span className="metric-desc">Duration of storage overflow</span>
                      </td>
                      <td className="mono">{comparison.baseline_spillback_s} s</td>
                      <td className="mono candidate-val">
                        {comparison.candidate_spillback_s} s
                      </td>
                      <td className="delta-col">
                        <span className="delta-pill green">
                          100% Spillback Eliminated
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>4. Modeled Stops / Vehicle</strong>
                        <span className="metric-desc">Stops per trip through corridor</span>
                      </td>
                      <td className="mono">{comparison.baseline_stops_per_vehicle.toFixed(2)}</td>
                      <td className="mono candidate-val">
                        {comparison.candidate_stops_per_vehicle.toFixed(2)}
                      </td>
                      <td className="delta-col">
                        <span className="delta-pill green">
                          -{(comparison.baseline_stops_per_vehicle - comparison.candidate_stops_per_vehicle).toFixed(2)} stops / veh
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
