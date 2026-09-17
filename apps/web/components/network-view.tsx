"use client";
import { useState } from "react";
import { NetworkCanvas } from "@/components/network-canvas";
import type { Network } from "../../../packages/contracts/typescript/network";
import type { Analysis, ComparisonResult, TrafficState } from "../../../packages/contracts/typescript/events";

export function outcome(base: number, candidate: number) {
  const delta = candidate - base;
  if (delta === 0) return "Unchanged";
  const percent = base === 0 ? "baseline is zero" : `${Math.abs(delta / base * 100).toFixed(1)}%`;
  return `${delta < 0 ? "Improved" : "Worse"}: ${Math.abs(delta).toFixed(2)} (${percent})`;
}
export function ComparisonTable({ comparison }: { comparison: ComparisonResult }) {
  const rows = [
    ["Maximum queue (veh)", comparison.baseline_max_queue_veh, comparison.candidate_max_queue_veh],
    ["Average modeled delay (s)", comparison.baseline_avg_delay_s, comparison.candidate_avg_delay_s],
    ["Spillback (movement-seconds)", comparison.baseline_spillback_s, comparison.candidate_spillback_s],
    ["Modeled stops / vehicle", comparison.baseline_stops_per_vehicle, comparison.candidate_stops_per_vehicle],
  ] as const;
  return <section aria-label="Aggregate comparison result">
    <p>Aggregate conservation simulation · {comparison.model_version} · horizon {comparison.horizon_s}s · initial {comparison.initial_time_s}s · seed {comparison.seed}</p>
    <p>Run <code>{comparison.run_id}</code> · Recommendation <code>{comparison.recommendation_id}</code></p>
    <p>These are equal-state aggregate estimates, not synchronized vehicle trajectories.</p>
    <div className="table-scroll"><table><thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Outcome</th></tr></thead><tbody>
      {rows.map(([label, base, candidate]) => <tr key={label}><th scope="row">{label}</th><td>{base.toFixed(2)}</td><td>{candidate.toFixed(2)}</td><td>{outcome(base, candidate)}</td></tr>)}
    </tbody></table></div>
  </section>;
}
export function NetworkView({ network, frame, analysis, onSelectNode, route = [] }: { network: Network; frame: TrafficState | null; analysis: Analysis | null; onSelectNode: (id: string) => void; route?: string[] }) {
  const [compare, setCompare] = useState(false);
  const [horizon, setHorizon] = useState(0);
  const result = analysis?.comparison;
  const matching = frame && result && result.run_id === frame.run_id && result.recommendation_id === analysis?.recommendation?.id;
  return <div className="network-screen-container" data-testid="network-view">
    <div className="network-screen-controls"><div className="network-mode-toggles">
      <button className="network-tab-btn" aria-pressed={!compare} onClick={() => setCompare(false)}>Full Digital Twin</button>
      <button className="network-tab-btn" aria-pressed={compare} onClick={() => setCompare(true)}>Before vs After · Aggregate comparison</button>
    </div><div className="time-slider-buttons" aria-label="Forecast horizon">
      {[0,30,60,120,300].map(t => <button className="ts-btn" key={t} aria-pressed={horizon===t} onClick={()=>setHorizon(t)}>{t===0?"NOW":`+${t}s`}</button>)}
    </div></div>
    {compare ? <section className="context-panel"><h2>Baseline vs candidate</h2>{matching ? <ComparisonTable comparison={result}/> : <p role="status">No matching comparison available. Start a scenario and request a fresh simulation. No outcome is assumed.</p>}</section> :
      <section className="network-panel"><h2>C1–C6 Network Twin</h2><p>{frame?.replay?"Prerecorded replay":frame?"Live synthetic state":"Configuration only · measurements unavailable"}{horizon===300?" · 5-minute advisory":""}</p>
        <NetworkCanvas network={network} frame={frame} onSelect={onSelectNode} route={route} forecasts={analysis?.forecasts} horizon={horizon}/>
      </section>}
  </div>;
}
