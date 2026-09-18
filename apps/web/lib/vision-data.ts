import aggregatesJson from "./c3_vision_aggregates.json";

export interface VisionTrack {
  track_id: string;
  class: "bike" | "car" | "auto" | "bus" | "truck";
  bbox: [number, number, number, number]; // [x, y, w, h]
  lane: string;
  speed_kph: number;
  is_queued: boolean;
  crossed: boolean;
}

export interface VisionFrame {
  frame_index: number;
  timestamp_s: number;
  active_vehicles: number;
  total_crossed: number;
  queue_vehicles: number;
  occupancy_ratio: number;
  average_speed_kph: number;
  speed_label: string;
  lane_counts: Record<string, number>;
  tracks: VisionTrack[];
  c1_impact: {
    expected_30s: number;
    expected_60s: number;
    expected_120s: number;
    eta_range_s: [number, number];
    risk_level: "low" | "moderate" | "high";
  };
}

export interface VisionLaneMetric {
  lane_id: string;
  label: string;
  current_flow_vpm: number;
  current_queue: number;
  occupancy: number;
}

export interface VisionSummaryMetrics {
  total_vehicles_observed: number;
  total_crossed_line: number;
  current_queue_estimate: number;
  current_occupancy_ratio: number;
  average_speed_kph: number;
  speed_label: string;
  class_breakdown: {
    bike: number;
    car: number;
    auto: number;
    bus: number;
    truck: number;
  };
  lane_metrics: VisionLaneMetric[];
}

export interface VisionUpstreamImpact {
  expected_30s: number;
  expected_60s: number;
  expected_120s: number;
  eta_range_s: [number, number];
  risk_level: "low" | "moderate" | "high";
  risk_narrative?: string;
}

export interface VisionAggregatePayload {
  available: boolean;
  status: "active" | "unavailable" | "error";
  camera_id: string;
  junction_id: string;
  target_junction_id: string;
  sample_video_label: string;
  sample_provenance: string;
  privacy_disclosure: string;
  is_calibrated: boolean;
  speed_disclaimer: string;
  total_frames: number;
  fps: number;
  summary_metrics: VisionSummaryMetrics;
  upstream_c1_impact: VisionUpstreamImpact;
  frames: VisionFrame[];
  message?: string;
  error?: string;
}

export const c3VisionFallbackData: VisionAggregatePayload = aggregatesJson as unknown as VisionAggregatePayload;

export function getVisionFrame(data: VisionAggregatePayload, frameIndex: number): VisionFrame | null {
  if (!data.frames || data.frames.length === 0) return null;
  const idx = Math.max(0, Math.min(frameIndex, data.frames.length - 1));
  return data.frames[idx] ?? null;
}
