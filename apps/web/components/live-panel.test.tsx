import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LiveSummary, JunctionLive } from "./live-panel";
import { networkSchema } from "@/lib/api";
import config from "../../../packages/scenario-config/c1-c6.json";
import type { TrafficState } from "../../../packages/contracts/typescript/events";

afterEach(cleanup);

const mockNetwork = networkSchema.parse(config);

function sampleState(overrides: Partial<TrafficState> = {}): TrafficState {
  return {
    schema_version: "1.0",
    run_id: "test-run-123",
    timestamp: new Date().toISOString(),
    simulation_time_s: 42,
    source: "synthetic",
    movements: [
      {
        movement_id: "C3-C1-C2",
        queue_veh: 5,
        arrival_rate_vpm: 18.5,
        departure_rate_vpm: 12.0,
        avg_speed_kph: 24.5,
        occupancy_ratio: 0.45,
        downstream_capacity_veh: 75,
        current_phase_id: "C1-FROM-C3",
        waiting_age_s: 14.0,
        vehicle_count: 8,
        arrivals_total: 20,
        departures_total: 12,
        permission: "green",
      },
      {
        movement_id: "C6-C3-C1",
        queue_veh: 2,
        arrival_rate_vpm: 24.0,
        departure_rate_vpm: 20.0,
        avg_speed_kph: 32.0,
        occupancy_ratio: 0.30,
        downstream_capacity_veh: 90,
        current_phase_id: "C3-FROM-C6",
        waiting_age_s: 6.0,
        vehicle_count: 4,
        arrivals_total: 30,
        departures_total: 26,
        permission: "green",
      },
    ],
    signals: [
      {
        node_id: "C1",
        phase_id: "C1-FROM-C3",
        indication: "green",
        remaining_s: 18,
        permitted_movement_ids: ["C3-C1-C2"],
      },
      {
        node_id: "C3",
        phase_id: "C3-FROM-C6",
        indication: "green",
        remaining_s: 22,
        permitted_movement_ids: ["C6-C3-C1"],
      },
    ],
    vehicles_in_network: 12,
    inserted_total: 50,
    arrived_total: 38,
    teleported_total: 0,
    scenario_type: "peak_surge",
    seed: 1101,
    active_plan: [],
    replay: false,
    ...overrides,
  };
}

describe("LiveSummary component", () => {
  it("displays waiting state when no frame has arrived", () => {
    render(
      <LiveSummary
        live={{
          fresh: false,
          frame: null,
          latency: 0,
          connected: true,
        }}
      />,
    );
    expect(screen.getByText("Waiting for a scenario")).toBeInTheDocument();
    expect(screen.getByText("NO FRESH DATA")).toBeInTheDocument();
    expect(
      screen.getByText(/Measurements are hidden until a fresh simulation frame arrives/),
    ).toBeInTheDocument();
  });

  it("displays disconnected indicator when socket is down and no frame is active", () => {
    render(
      <LiveSummary
        live={{
          fresh: false,
          frame: null,
          latency: 0,
          connected: false,
        }}
      />,
    );
    expect(screen.getByText("DISCONNECTED")).toBeInTheDocument();
  });

  it("displays stale indicator when frame is present but not fresh", () => {
    render(
      <LiveSummary
        live={{
          fresh: false,
          frame: sampleState(),
          latency: 12,
          connected: true,
        }}
      />,
    );
    expect(screen.getByText("Stream stale / disconnected")).toBeInTheDocument();
    expect(screen.getByText("NO FRESH DATA")).toBeInTheDocument();
  });

  it("renders live measurements and signal strips when frame is fresh", () => {
    render(
      <LiveSummary
        live={{
          fresh: true,
          frame: sampleState(),
          latency: 15.4,
          connected: true,
        }}
      />,
    );
    expect(screen.getByText("LIVE STATE / SYNTHETIC")).toBeInTheDocument();
    expect(screen.getByText("peak surge · 42s")).toBeInTheDocument();
    expect(screen.getByText("15 ms delivery")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument(); // vehicles in network
    expect(screen.getByText("7")).toBeInTheDocument(); // queued (5 + 2)
    expect(screen.getByText("1101")).toBeInTheDocument(); // seed
    expect(screen.getByText("COMPLETED TRIPS").parentElement).toHaveTextContent(/38\s*of\s*50\s*inserted/); // completed trips
    expect(screen.getByText(/Run test-run-123/)).toBeInTheDocument();
  });

  it("displays golden replay banner when frame has replay enabled", () => {
    render(
      <LiveSummary
        live={{
          fresh: true,
          frame: sampleState({ replay: true }),
          latency: 5,
          connected: true,
        }}
      />,
    );
    expect(screen.getByText("GOLDEN REPLAY / PRERECORDED")).toBeInTheDocument();
  });
});

describe("JunctionLive component", () => {
  it("renders unavailable message when frame is missing", () => {
    render(
      <JunctionLive frame={null} network={mockNetwork} nodeID="C1" />,
    );
    expect(
      screen.getByText("Live measurements unavailable or stale."),
    ).toBeInTheDocument();
  });

  it("renders boundary notice for boundary nodes", () => {
    render(
      <JunctionLive frame={sampleState()} network={mockNetwork} nodeID="C2" />,
    );
    expect(
      screen.getByText("Boundary node: no controlled movements."),
    ).toBeInTheDocument();
  });

  it("renders signal countdown and movement details for controlled junction", () => {
    render(
      <JunctionLive frame={sampleState()} network={mockNetwork} nodeID="C1" />,
    );
    expect(screen.getByText(/18s remaining/)).toBeInTheDocument();
    expect(screen.getByText("C3-C1-C2")).toBeInTheDocument();
    expect(screen.getByText("green")).toBeInTheDocument();
    expect(screen.getByText("5 veh")).toBeInTheDocument();
    expect(screen.getByText("24.5 km/h")).toBeInTheDocument();
    expect(screen.getByText("18.5 / 12 vpm")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
    expect(screen.getByText("75 veh")).toBeInTheDocument();
    expect(screen.getByText("14s")).toBeInTheDocument();
    expect(
      screen.getByText(/Rates are exponentially smoothed arrivals\/departures/),
    ).toBeInTheDocument();
  });
});
