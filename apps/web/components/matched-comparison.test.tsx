import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatchedComparison } from "./matched-comparison";
import type { ComparisonResult } from "../../../packages/contracts/typescript/events";

describe("matched virtual comparison", () => {
  it("shows the declared window and supported metrics without deprecated stop or delay claims", () => {
    const result = { run_id: "run", recommendation_id: "rec", horizon_s: 120,
      window_start_simulation_s: 10, window_end_simulation_s: 130,
      baseline_queue_delay_veh_s: 300, candidate_queue_delay_veh_s: 330,
      baseline_boundary_throughput_veh: 40, candidate_boundary_throughput_veh: 38,
      baseline_boundary_backlog_veh: 4, candidate_boundary_backlog_veh: 8,
      baseline_worst_service_debt_s: 50, candidate_worst_service_debt_s: 70,
      baseline_avg_delay_s: 0, candidate_avg_delay_s: 0,
      baseline_stops_per_vehicle: 0, candidate_stops_per_vehicle: 0,
    } as ComparisonResult;
    render(<MatchedComparison result={result} />);
    expect(screen.getByText(/10\.0–130\.0 s/)).toBeInTheDocument();
    expect(screen.getByText(/Queue delay \(veh·s\)/)).toBeInTheDocument();
    expect(screen.getByText(/Boundary exits \(veh\)/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting to enter \(veh\)/)).toBeInTheDocument();
    expect(screen.getByText(/Worst service debt \(s\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Stops per Vehicle/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Average Delay/)).not.toBeInTheDocument();
  });
});
