import type { ComparisonResult } from "../../../packages/contracts/typescript/events";

const shown = (value: number | undefined, unit = "") =>
  value == null || !Number.isFinite(value) ? "Unavailable" : `${value.toFixed(1)}${unit}`;

export function MatchedComparison({ result }: { result: ComparisonResult }) {
  const rows = [
    ["Queue delay (veh·s)", result.baseline_queue_delay_veh_s, result.candidate_queue_delay_veh_s],
    ["Boundary exits (veh)", result.baseline_boundary_throughput_veh, result.candidate_boundary_throughput_veh],
    ["Waiting to enter (veh)", result.baseline_boundary_backlog_veh, result.candidate_boundary_backlog_veh],
    ["Worst service debt (s)", result.baseline_worst_service_debt_s, result.candidate_worst_service_debt_s],
    ["Boundary wait (veh·s)", result.baseline_boundary_wait_veh_s, result.candidate_boundary_wait_veh_s],
    ["Congested link time (s)", result.baseline_congested_link_s, result.candidate_congested_link_s],
  ] as const;
  return <div className="simulation-comparison-card" role="region" aria-label="Matched virtual comparison">
    <strong>MODELED VIRTUAL PLAN COMPARISON</strong>
    <p>Same initial snapshot and demand assumptions · {shown(result.window_start_simulation_s, "")}–{shown(result.window_end_simulation_s, " s")} · {result.horizon_s}s horizon</p>
    <p>Scoring: {result.scoring_version || "Unavailable"} · Individual stops and journey time unavailable</p>
    <table className="comparison-table"><thead><tr><th>Metric</th><th>Current plan</th><th>Candidate</th></tr></thead>
      <tbody>{rows.map(([label, baseline, candidate]) => <tr key={label}><td>{label}</td><td>{shown(baseline)}</td><td>{shown(candidate)}</td></tr>)}</tbody>
    </table>
  </div>;
}
