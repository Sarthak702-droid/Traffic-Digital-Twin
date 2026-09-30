import { describe, expect, it } from "vitest";
import { validateResponse } from "./response-schemas";

describe("prototype analysis response", () => {
  it("preserves source identity, quality, horizon availability and comparison identity", () => {
    const result = validateResponse("/analysis", {
      run_id: "run", simulation_time_s: 12, input_session_id: "epoch-1", snapshot_sequence: "9",
      config_hash: "config", model_version: "model", metrics_version: "metrics",
      forecast_origin_source_s: 30, input_quality: "cached_valid", outcome: "recommend",
      outcome_reason: "Safe improvement", horizon_availability: [{ horizon_s: 30, status: "available", reason: "Enough history" }],
      forecasts: [{ id: "f", run_id: "run", movement_id: "m", horizon_s: 30, queue_veh: 0,
        occupancy_ratio: 0, arrivals_veh: 0, risk: "low", model_version: "model", explanation_facts: [],
        method: "ewma", origin_source_s: 30, input_age_s: 2, input_quality: "cached_valid",
        horizon_status: "available", uncertainty_status: "unavailable" }],
      recommendation: null, alternatives: [], comparison: null,
    }) as Record<string, any>;
    expect(result.input_session_id).toBe("epoch-1");
    expect(result.snapshot_sequence).toBe("9");
    expect(result.outcome).toBe("recommend");
    expect(result.horizon_availability[0].status).toBe("available");
    expect(result.forecasts[0].method).toBe("ewma");
    expect(result.forecasts[0].uncertainty_status).toBe("unavailable");
  });
  it("keeps matched-window comparison fields from the Go response", () => {
    const result = validateResponse("/recommendations/rec/simulate", {
      run_id: "run", recommendation_id: "rec", baseline_max_queue_veh: 0, candidate_max_queue_veh: 0,
      baseline_avg_delay_s: 0, candidate_avg_delay_s: 0, initial_time_s: 10, model_version: "model",
      baseline_spillback_s: 0, candidate_spillback_s: 0, baseline_stops_per_vehicle: 0,
      candidate_stops_per_vehicle: 0, horizon_s: 120, seed: 1,
      baseline_queue_delay_veh_s: 4, candidate_queue_delay_veh_s: 5,
      baseline_boundary_throughput_veh: 2, candidate_boundary_throughput_veh: 1,
      baseline_boundary_backlog_veh: 0, candidate_boundary_backlog_veh: 2,
      baseline_worst_service_debt_s: 20, candidate_worst_service_debt_s: 30,
      window_start_simulation_s: 10, window_end_simulation_s: 130,
      input_session_id: "epoch", snapshot_sequence: "5", config_hash: "config", scoring_version: "score-1",
    }) as Record<string, any>;
    expect(result.baseline_queue_delay_veh_s).toBe(4);
    expect(result.baseline_boundary_backlog_veh).toBe(0);
    expect(result.snapshot_sequence).toBe("5");
    expect(result.scoring_version).toBe("score-1");
  });
});

it('preserves virtual plan offsets in recommendations',()=>{
 const result=validateResponse('/recommendations/rec/approve',{id:'rec',run_id:'run',timestamp:'now',priority:'normal',reason:'test',changes:[{node_id:'C1',phase_id:'p',green_s:30,offset_s:7}],safety_status:'validated',status:'pending',explanation_facts:[]}) as any;
 expect(result.changes[0].offset_s).toBe(7);
});
