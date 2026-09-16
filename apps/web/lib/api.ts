import { z } from "zod";
export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const error = await response.json();
      if (typeof error.message === "string") message = error.message;
    } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
const positive = z.number().finite().positive();
const node = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["controlled", "boundary"]),
  x: z.number().finite(),
  y: z.number().finite(),
});
const link = z.object({
  id: z.string(),
  from_node: z.string(),
  to_node: z.string(),
  length_m: positive,
  lanes: positive.int(),
  storage_capacity_veh: positive.int(),
  free_flow_speed_kph: positive,
});
const movement = z.object({
  id: z.string(),
  node_id: z.string(),
  incoming_link_id: z.string(),
  outgoing_link_id: z.string(),
  turning_ratio: positive.max(1),
});
const phase = z.object({
  id: z.string(),
  node_id: z.string(),
  movement_ids: z.array(z.string()),
  min_green_s: positive,
  max_green_s: positive,
  amber_s: positive,
  all_red_s: positive,
});
export const networkSchema = z.object({
  schema_version: z.literal("1.0"),
  id: z.string(),
  name: z.string(),
  units: z.record(z.string(), z.string()),
  nodes: z.array(node).min(2),
  links: z.array(link),
  movements: z.array(movement),
  phases: z.array(phase),
  conflicts: z.array(z.tuple([z.string(), z.string()])),
  scenarios: z.array(
    z.object({
      id: z.enum(["peak_surge", "incident_c3", "ambulance_corridor"]),
      seed: positive.int(),
      route_node_ids: z.array(z.string()),
      capacity_ratio: z.number().min(0).max(1),
    }),
  ),
});
export async function getNetwork() {
  return networkSchema.parse(await request<unknown>("/network"));
}
