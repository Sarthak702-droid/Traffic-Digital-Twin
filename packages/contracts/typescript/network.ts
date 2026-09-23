export interface Node {
  id: string;
  label: string;
  kind: "controlled" | "boundary";
  x: number;
  y: number;
}
export interface Link {
  id: string;
  from_node: string;
  to_node: string;
  length_m: number;
  lanes: number;
  storage_capacity_veh: number;
  free_flow_speed_kph: number;
}
export interface Movement {
  id: string;
  node_id: string;
  incoming_link_id: string;
  outgoing_link_id: string;
  turning_ratio: number;
}
export interface SignalPhase {
  id: string;
  node_id: string;
  movement_ids: string[];
  min_green_s: number;
  max_green_s: number;
  amber_s: number;
  all_red_s: number;
}
export interface Scenario {
  id: "peak_surge" | "incident_c3" | "ambulance_corridor";
  seed: number;
  route_node_ids: string[];
  capacity_ratio: number;
}
export interface Network {
  schema_version: "1.0";
  id: string;
  name: string;
  units: Record<string, string>;
  nodes: Node[];
  links: Link[];
  movements: Movement[];
  phases: SignalPhase[];
  conflicts: [string, string][];
  scenarios: Scenario[];
}
export interface Run {
  id: string;
  config_id: string;
  scenario_type: Scenario["id"];
  seed: number;
  demand_source?: "seeded" | "video_profile";
  mode: "observe" | "recommend";
  status: "prepared" | "running" | "ended";
  started_at: string;
  ended_at: string | null;
}
export interface AuditRecord {
  sequence: number;
  id: string;
  run_id: string | null;
  recommendation_id: string | null;
  actor: string;
  event_type: string;
  before_values: unknown;
  after_values: unknown;
  reason: string;
  safety_result: string;
  created_at: string;
}
