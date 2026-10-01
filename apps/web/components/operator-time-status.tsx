import type { Analysis, TrafficState } from "../../../packages/contracts/typescript/events";

const time = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "Unavailable" : `${value.toFixed(1)} s`;
const quality: Record<string, string> = {
  fresh: "Fresh inference", cached_valid: "Cached observations", synthetic: "Synthetic input",
  missing: "Missing input", stale: "Stale input", degraded: "Degraded input",
  out_of_order: "Out of order input", duplicate: "Duplicate input", replay: "Prerecorded replay",
};

export function OperatorTimeStatus({ frame, analysis, displaySourceTimeS }: {
  frame: TrafficState | null;
  analysis: Analysis | null;
  displaySourceTimeS?: number | null;
}) {
  const evidence = frame?.replay ? "replay" : analysis?.input_quality || frame?.input_quality || "missing";
  const horizonStatus = analysis?.horizon_availability?.filter((item) => item.status !== "available") ?? [];
  const ages = (analysis?.forecasts ?? []).map(item => item.input_age_s).filter((age): age is number => typeof age === "number" && Number.isFinite(age) && age >= 0);
  const processingAge = evidence === "synthetic" || evidence === "replay" || ages.length === 0 ? null : Math.max(...ages);
  return <section className="workspace-status operator-clocks" aria-label="Source and model clocks">
    <span>Display video time <strong>{time(displaySourceTimeS)}</strong> <small>display seek only</small></span>
    <span>Latest completed observation window end <strong>{time(frame?.latest_finalized_window_end_source_s)}</strong></span>
    <span>Virtual simulation time <strong>{time(frame?.simulation_time_s)}</strong></span>
    <span>Forecast origin <strong>{time(evidence === "synthetic" || evidence === "replay" ? null : analysis?.forecast_origin_source_s)}</strong></span>
    <span>Data quality <strong>{quality[evidence] || "Unavailable"}</strong></span>
    <span>Processing completion age <strong>{time(processingAge)}</strong> <small>oldest forecast input · wall clock</small></span>
    {horizonStatus.map((item) => <span key={item.horizon_s}>{item.horizon_s} s: {item.status.replaceAll("_", " ")} · {item.reason}</span>)}
  </section>;
}
