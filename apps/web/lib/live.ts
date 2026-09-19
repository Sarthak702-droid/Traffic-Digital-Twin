"use client";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { z } from "zod";
import type { HealthState, TrafficState } from "../../../packages/contracts/typescript/events";
const nonnegative = z.number().finite().nonnegative();
const movement = z.object({
  movement_id: z.string(),
  queue_veh: nonnegative,
  arrival_rate_vpm: nonnegative,
  departure_rate_vpm: nonnegative,
  avg_speed_kph: nonnegative,
  occupancy_ratio: nonnegative.max(1),
  downstream_capacity_veh: nonnegative,
  current_phase_id: z.string(),
  waiting_age_s: nonnegative,
  vehicle_count: nonnegative.int(),
  arrivals_total: nonnegative.int(),
  departures_total: nonnegative.int(),
  permission: z.enum(["green", "amber", "red"]),
});
export const liveSchema = z.object({
  schema_version: z.literal("1.0"),
  run_id: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  simulation_time_s: nonnegative,
  source: z.literal("synthetic"),
  replay: z.boolean().default(false),
  movements: z.array(movement),
  signals: z.array(
    z.object({
      node_id: z.string(),
      phase_id: z.string(),
      indication: z.enum(["green", "amber", "all_red"]),
      remaining_s: nonnegative,
      permitted_movement_ids: z.array(z.string()),
    }),
  ),
  vehicles_in_network: nonnegative.int(),
  inserted_total: nonnegative.int(),
  arrived_total: nonnegative.int(),
  teleported_total: nonnegative.int(),
  scenario_type: z.string(),
  seed: nonnegative.int(),
  incident: z
    .object({
      id: z.string(),
      run_id: z.string(),
      node_id: z.string(),
      kind: z.string(),
      capacity_ratio: nonnegative.max(1),
      status: z.string(),
      recovery_cycles: nonnegative.int(),
    })
    .nullish(),
  emergency: z
    .object({
      id: z.string(),
      run_id: z.string(),
      route_node_ids: z.array(z.string()),
      status: z.string(),
      eta_s: z.array(nonnegative),
      recovery_cycles_remaining: nonnegative.int(),
      vehicle_id: z.string(),
    })
    .nullish(),
  active_plan: z
    .array(
      z.object({
        node_id: z.string(),
        phase_id: z.string(),
        green_s: nonnegative,
      }),
    )
    .default([]),
});
export const useLiveStore = create<{
  frame: TrafficState | null;
  received: number;
  connected: boolean;
  failed: boolean;
  latency: number;
  health: HealthState | null;
  set: (
    value: Partial<{
      frame: TrafficState | null;
      received: number;
      connected: boolean;
      failed: boolean;
      latency: number;
      health: HealthState | null;
    }>,
  ) => void;
}>((set) => ({
  frame: null,
  received: 0,
  connected: false,
  failed: false,
  latency: 0,
  health: null,
  set,
}));
export function useLive() {
  const store = useLiveStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
 let attempts=0;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/v1/live`,
      );
      socket.onopen = () => { attempts=0;useLiveStore.getState().set({ connected: true, failed: false }); };
      socket.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data);
          if (envelope.schema_version !== "1.0")
            throw Error("Unsupported event");
          if (envelope.type === "network.state") {
            const frame = liveSchema.parse(envelope.payload);
 const previous=useLiveStore.getState().frame;
 if(previous?.run_id===frame.run_id && previous.simulation_time_s>frame.simulation_time_s)return;
            const latency = Math.max(
              0,
              Date.now() - Date.parse(frame.timestamp),
            );
            useLiveStore
              .getState()
              .set({ frame, received: Date.now(), latency, failed: false });
          } else if(envelope.type==="audit.appended"){window.dispatchEvent(new Event("audit-updated"));
          } else if (envelope.type === "health.updated") {
            const simulation = envelope.payload.components?.find(
              (c: { component: string }) => c.component === "simulation",
            );
            const timestamp = envelope.payload.timestamp;
            if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp))) {
              throw Error("Invalid health timestamp");
            }
            useLiveStore.getState().set({
              health: envelope.payload as HealthState,
              failed: simulation?.status === "unavailable",
            });
          }
        } catch {
          useLiveStore.getState().set({ failed: true });
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        useLiveStore.getState().set({ connected: false });
        if (!disposed) timer = setTimeout(connect, Math.min(30000,1000*2**attempts++)+Math.random()*500);
      };
    };
    connect();
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(interval);
      socket.close();
    };
  }, []);
  return {
    ...store,
    fresh:
      store.connected &&
      !store.failed &&
      !!store.frame &&
      now - store.received < 2500,
  };
}
