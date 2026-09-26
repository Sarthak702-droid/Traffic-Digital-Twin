import { describe, expect, it } from "vitest";
import { analysisMatchesFrame, comparisonMatchesAnalysis } from "./decision-identity";
import type { Analysis, ComparisonResult, TrafficState } from "../../../packages/contracts/typescript/events";

const frame = { schema_version: "1.1", run_id: "run", input_session_id: "epoch-1", snapshot_sequence: "9", config_hash: "config-1", metrics_version: "metrics-1", latest_finalized_window_end_source_s: 30 } as TrafficState;
const analysis = { run_id: "run", input_session_id: "epoch-1", snapshot_sequence: "9", config_hash: "config-1", metrics_version: "metrics-1", forecast_origin_source_s: 30, outcome: "recommend" } as Analysis;
const comparison = { run_id: "run", input_session_id: "epoch-1", snapshot_sequence: "9", config_hash: "config-1", metrics_version: "metrics-1", forecast_origin_source_s: 30, recommendation_id: "rec" } as ComparisonResult;

describe("operator decision identity", () => {
  it("accepts only the current analysis source, snapshot, versions and finalized origin", () => {
    expect(analysisMatchesFrame(analysis, frame)).toBe(true);
    expect(analysisMatchesFrame(analysis, { ...frame, config_hash: undefined })).toBe(false);
    expect(analysisMatchesFrame({ ...analysis, snapshot_sequence: undefined }, frame)).toBe(false);
    expect(analysisMatchesFrame({ ...analysis, config_hash: undefined }, { ...frame, config_hash: undefined })).toBe(false);
    for (const change of [
      { input_session_id: "epoch-2" }, { snapshot_sequence: "10" },
      { config_hash: "config-2" }, { metrics_version: "metrics-2" },
      { latest_finalized_window_end_source_s: 35 },
    ]) expect(analysisMatchesFrame(analysis, { ...frame, ...change })).toBe(false);
  });

  it("does not show a comparison after source or candidate identity changes", () => {
    expect(comparisonMatchesAnalysis(comparison, analysis, frame, "rec")).toBe(true);
    expect(comparisonMatchesAnalysis(comparison, analysis, frame, "other")).toBe(false);
    expect(comparisonMatchesAnalysis(comparison, analysis, { ...frame, input_session_id: "epoch-2" }, "rec")).toBe(false);
    expect(comparisonMatchesAnalysis({ ...comparison, snapshot_sequence: "8" }, analysis, frame, "rec")).toBe(false);
  });

  it("accepts a seeded synthetic run without a recorded source session", () => {
    const seededFrame = { ...frame, demand_source: "seeded", input_quality: "synthetic" as const, input_session_id: "" };
    const seededAnalysis = { ...analysis, input_session_id: "", input_quality: "synthetic" as const };
    expect(analysisMatchesFrame(seededAnalysis, seededFrame)).toBe(true);
    expect(analysisMatchesFrame(seededAnalysis, { ...seededFrame, demand_source: "video_profile" })).toBe(false);
  });

  it("keeps a recent non-action forecast visible while disabling an older recommendation", () => {
    const later = { ...frame, snapshot_sequence: "10" };
    expect(analysisMatchesFrame({ ...analysis, outcome: "no_action", recommendation: null }, later)).toBe(true);
    expect(analysisMatchesFrame(analysis, later)).toBe(false);
  });
});
