import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { liveSchema, useLive, useLiveStore } from "./live";
class FakeSocket {
  static sockets: FakeSocket[] = [];
  onopen = () => {};
  onclose = () => {};
  onerror = () => {};
  onmessage = (_e: { data: string }) => {};
  constructor(_url: string) {
    FakeSocket.sockets.push(this);
  }
  close() {
    this.onclose();
  }
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSocket.sockets = [];
  useLiveStore.setState({
    frame: null,
    connected: false,
    failed: false,
    received: 0,
    health: null,
  });
});
describe("live reconnection", () => {
  it("retains aggregate links, road cells and conservation metrics used by the twin", () => {
    const frame = liveSchema.parse({
      schema_version: "1.1", run_id: "run", timestamp: new Date().toISOString(),
      simulation_time_s: 10, source: "synthetic", movements: [], signals: [],
      vehicles_in_network: 4, inserted_total: 6, arrived_total: 2, teleported_total: 0,
      scenario_type: "peak_surge", seed: 1, engine_kind: "aggregate_ctm",
      links: [{link_id:"C2-C1",stock_veh:4,queued_veh_estimate:2,density_veh_per_km_lane:3,
        storage_utilization_ratio:0.1,receiving_storage_veh:76,inflow_vpm:10,outflow_vpm:2,
        flow_window_s:10,speed_method:"model",speed_status:"unavailable",mean_speed_kph:null,
        queue_length_m_estimate:10,receiving_blocked:false}],
      cells:[{link_id:"C2-C1",stock_veh:[1,3]}], boundary_backlog_veh:2,
      cumulative_demand_veh:8, cumulative_admitted_veh:6, cumulative_boundary_exits_veh:2,
      boundary_demand:[{link_id:"C2-C1",backlog_veh:2,offered_rate_vpm:10}],
    });
    expect(frame).toMatchObject({engine_kind:"aggregate_ctm",links:[{stock_veh:4}],
      cells:[{stock_veh:[1,3]}],boundary_backlog_veh:2,cumulative_demand_veh:8});
    const averaged = liveSchema.parse({...frame,boundary_demand:[{link_id:"C2-C1",backlog_veh:2,offered_rate_vpm:10,offered_window_s:60}]});
    expect(averaged.boundary_demand?.[0].offered_window_s).toBe(60);
    expect(() => liveSchema.parse({...frame,boundary_demand:[{link_id:"C2-C1",backlog_veh:2,offered_rate_vpm:10,offered_window_s:61}]})).toThrow();
    expect(() => liveSchema.parse({...frame,cells:[{link_id:"C2-C1",stock_veh:[-1]}]})).toThrow();
  });
  it("accepts current 1.1 state identity and finalized source time", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    const { result } = renderHook(() => useLive());
    act(() => vi.advanceTimersByTime(0));
    act(() => FakeSocket.sockets[0].onopen());
    act(() => FakeSocket.sockets[0].onmessage({ data: JSON.stringify({
      schema_version: "1.0",
      type: "network.state",
      payload: {
        schema_version: "1.1", run_id: "run", timestamp: new Date().toISOString(),
        simulation_time_s: 12, source: "synthetic", movements: [], signals: [],
        vehicles_in_network: 0, inserted_total: 0, arrived_total: 0, teleported_total: 0,
        scenario_type: "peak_surge", seed: 1, input_session_id: "session-1",
        snapshot_sequence: "12", latest_finalized_window_end_source_s: 30,
        config_hash: "config-1", metrics_version: "metrics-1", model_version: "aggregate-v1",
        input_quality: "cached_valid", observation_history: [],
      },
    }) }));
    expect(result.current.fresh).toBe(true);
    expect(result.current.frame?.input_session_id).toBe("session-1");
    expect(result.current.frame?.latest_finalized_window_end_source_s).toBe(30);
    expect(result.current.frame?.config_hash).toBe("config-1");
    expect(result.current.frame?.metrics_version).toBe("metrics-1");
  });
  it("reconnects after close, hides stale values and stops on unmount", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    const { result, unmount } = renderHook(() => useLive());
    act(() => vi.advanceTimersByTime(0));
    const socket = FakeSocket.sockets[0];
    act(() => socket.onopen());
    expect(result.current.connected).toBe(true);
    act(() =>
      socket.onmessage({
        data: JSON.stringify({
          schema_version: "1.0",
          type: "network.state",
          payload: {
            schema_version: "1.0",
            run_id: "run",
            timestamp: new Date().toISOString(),
            simulation_time_s: 1,
            source: "synthetic",
            movements: [],
            signals: [],
            vehicles_in_network: 0,
            inserted_total: 0,
            arrived_total: 0,
            teleported_total: 0,
            scenario_type: "peak_surge",
            seed: 1,
          },
        }),
      }),
    );
    expect(result.current.fresh).toBe(true);
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.fresh).toBe(false);
    act(() => socket.close());
    expect(result.current.connected).toBe(false);
    act(() => vi.advanceTimersByTime(1500));
    expect(FakeSocket.sockets).toHaveLength(2);
    unmount();
    act(() => vi.advanceTimersByTime(2000));
    expect(FakeSocket.sockets).toHaveLength(2);
  });
  it("marks malformed frames unavailable", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    const { result } = renderHook(() => useLive());
    act(() => vi.advanceTimersByTime(0));
    act(() => FakeSocket.sockets[0].onmessage({ data: "invalid" }));
    expect(result.current.failed).toBe(true);
  });
  it("retains the latest health report and stops treating an unavailable simulator as fresh", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    const { result } = renderHook(() => useLive());
    act(() => vi.advanceTimersByTime(0));
    act(() => FakeSocket.sockets[0].onmessage({
      data: JSON.stringify({
        schema_version: "1.0",
        type: "health.updated",
        payload: {
          timestamp: new Date().toISOString(),
          components: [{ component: "simulation", status: "unavailable", message: "Simulator state is stale" }],
        },
      }),
    }));
    expect(result.current.health?.components[0].message).toBe("Simulator state is stale");
    expect(result.current.failed).toBe(true);
  });
});
