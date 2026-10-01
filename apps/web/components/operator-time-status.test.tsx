import React from "react";
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OperatorTimeStatus } from "./operator-time-status";
import type { Analysis, TrafficState } from "../../../packages/contracts/typescript/events";

describe("operator time and evidence status", () => {
  it("keeps display video, finalized observation, simulation and forecast clocks distinct", () => {
    const frame = { schema_version: "1.1", simulation_time_s: 50, latest_finalized_window_end_source_s: 30, input_quality: "cached_valid" } as TrafficState;
    const analysis = { forecasts:[{input_age_s:12},{input_age_s:27}], forecast_origin_source_s: 30, input_quality: "cached_valid", horizon_availability: [{ horizon_s: 300, status: "insufficient_history", reason: "Clip too short" }] } as Analysis;
    render(<OperatorTimeStatus frame={frame} analysis={analysis} displaySourceTimeS={8} />);
    expect(screen.getByText("8.0 s", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByText("30.0 s", { selector: "strong" })).toHaveLength(2);
    expect(screen.getByText("50.0 s", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/300 s: insufficient history/)).toBeInTheDocument();
    expect(screen.getByText(/Cached observations/)).toBeInTheDocument();
    expect(screen.getByText(/Processing completion age/).querySelector("strong")?.textContent).toBe("27.0 s");
  });
  it("does not invent a source-time forecast origin for seeded demand", () => {
    cleanup();
    render(<OperatorTimeStatus frame={{ input_quality: "synthetic", demand_source: "seeded" } as TrafficState} analysis={{ forecast_origin_source_s: 0 } as Analysis} />);
    expect(screen.getByText(/Forecast origin/).querySelector("strong")?.textContent).toBe("Unavailable");
    expect(screen.getByText(/Processing completion age/).querySelector("strong")?.textContent).toBe("Unavailable");
  });
});
