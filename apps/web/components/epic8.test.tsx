import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TopBar } from "./top-bar";
import type { HealthState } from "../../../packages/contracts/typescript/events";

afterEach(cleanup);

const health: HealthState = {
  timestamp: new Date().toISOString(),
  components: [
    { component: "api", status: "normal", message: "Go API connected" },
    { component: "database", status: "normal", message: "PostgreSQL connected" },
    { component: "simulation", status: "normal", message: "SUMO/TraCI stream connected at 1 Hz" },
    { component: "intelligence", status: "normal", message: "Conservation forecasts available" },
    { component: "signal_controller", status: "unavailable", message: "NOT CONNECTED · synthetic signal plans only" },
    { component: "cctv", status: "unavailable", message: "DEMO/SAMPLE · no camera feed or CV pipeline configured" },
    { component: "emergency_api", status: "simulated", message: "SIMULATED · no live emergency dispatch integration" },
  ],
};

describe("Epic 8: audit, health and replay resilience", () => {
  it("shows explicit optional-integration limits without degrading healthy core services", () => {
    render(<TopBar health={health} manual={false} onToggleManual={() => {}} />);

    expect(screen.getByText("System: Normal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /system health/i }));
    expect(screen.getByText(/NOT CONNECTED/)).toBeInTheDocument();
    expect(screen.getByText(/DEMO\/SAMPLE/)).toBeInTheDocument();
    expect(screen.getByText(/SIMULATED/)).toBeInTheDocument();
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
  });

  it("marks the system degraded when a core dependency is unavailable", () => {
    render(
      <TopBar
        health={{ ...health, components: health.components.map((component) => component.component === "intelligence" ? { ...component, status: "unavailable" } : component) }}
        manual={false}
        onToggleManual={() => {}}
      />,
    );

    expect(screen.getByText("System: Degraded")).toBeInTheDocument();
  });
});
