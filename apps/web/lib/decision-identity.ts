import type { Analysis, ComparisonResult, TrafficState } from "../../../packages/contracts/typescript/events";

export function analysisMatchesFrame(analysis: Analysis | null | undefined, frame: TrafficState | null | undefined): boolean {
  if (!analysis || !frame || analysis.run_id !== frame.run_id) return false;
  if (frame.schema_version === "1.0") return true;
  if (analysis.forecasts?.length && frame.demand_source === "video_profile" && ["stale", "missing", "degraded", "invalid"].includes(frame.input_quality || "")) return false;
  const sourceBound = !!frame.input_session_id || (frame.demand_source === "seeded" && frame.input_quality === "synthetic" && !analysis.input_session_id);
  const sameSnapshot = analysis.snapshot_sequence === frame.snapshot_sequence;
  const olderNonAction = !analysis.recommendation && (analysis.outcome === "no_action" || analysis.outcome === "cannot_evaluate") &&
    !!analysis.snapshot_sequence && !!frame.snapshot_sequence && /^\d+$/.test(analysis.snapshot_sequence) && /^\d+$/.test(frame.snapshot_sequence) &&
    BigInt(analysis.snapshot_sequence) <= BigInt(frame.snapshot_sequence);
  return sourceBound && !!frame.snapshot_sequence && !!frame.config_hash && !!frame.metrics_version &&
    analysis.input_session_id === frame.input_session_id &&
    (sameSnapshot || olderNonAction) &&
    analysis.config_hash === frame.config_hash && analysis.metrics_version === frame.metrics_version &&
    (frame.latest_finalized_window_end_source_s == null || analysis.forecast_origin_source_s === frame.latest_finalized_window_end_source_s);
}

export function comparisonMatchesAnalysis(
  comparison: ComparisonResult | null | undefined,
  analysis: Analysis | null | undefined,
  frame: TrafficState | null | undefined,
  recommendationId: string | undefined,
): boolean {
  if (!comparison || !recommendationId || !analysisMatchesFrame(analysis, frame) || !analysis) return false;
  if (comparison.run_id !== analysis.run_id || comparison.recommendation_id !== recommendationId) return false;
  if (frame?.schema_version === "1.0") return true;
  if (analysis.snapshot_sequence !== frame?.snapshot_sequence) return false;
  return comparison.input_session_id === analysis.input_session_id &&
    comparison.snapshot_sequence === analysis.snapshot_sequence &&
    comparison.config_hash === analysis.config_hash &&
    comparison.metrics_version === analysis.metrics_version &&
    comparison.forecast_origin_source_s === analysis.forecast_origin_source_s;
}
