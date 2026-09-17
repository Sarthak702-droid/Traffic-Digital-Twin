"use client";

import type { TrafficState, Analysis } from "../../../packages/contracts/typescript/events";

export function KpiStrip({
  frame,
  analysis,
}: {
  frame: TrafficState | null;
  analysis: Analysis | null;
}) {
  const f = frame;
  const movements = f?.movements ?? [];

  // 1. Vehicles in modeled network
  const inNetwork = f ? f.vehicles_in_network : 0;
  const completedTrips = f ? f.arrived_total : 0;

  // 2. Average network speed
  const avgSpeed =
    movements.length > 0
      ? movements.reduce((sum, m) => sum + m.avg_speed_kph, 0) / movements.length
      : 0;

  // 3. Average queue length
  const totalQueue = movements.reduce((sum, m) => sum + m.queue_veh, 0);
  const avgQueue = movements.length > 0 ? totalQueue / movements.length : 0;

  // 4. Critical nodes (occupancy >= 70% or queue >= 10)
  const criticalNodesSet = new Set<string>();
  for (const m of movements) {
    if (m.occupancy_ratio >= 0.7 || m.queue_veh >= 10) {
      // movement_id is typically "FROM-NODE-TO" or similar, or movement has node_id
      const parts = m.movement_id.split("-");
      if (parts.length >= 2) {
        criticalNodesSet.add(parts[1] || parts[0]);
      } else {
        criticalNodesSet.add(m.movement_id);
      }
    }
  }
  const criticalNodesCount = criticalNodesSet.size;

  // 5. Predicted spillback ETA from forecasts
  const spillbackForecasts = (analysis?.forecasts ?? []).filter(
    (fc) => fc.spillback_eta_s != null && fc.spillback_eta_s > 0,
  );
  let spillbackEtaText = "None predicted";
  let spillbackRisk = "normal";
  if (spillbackForecasts.length > 0) {
    spillbackForecasts.sort(
      (a, b) => (a.spillback_eta_s ?? 999) - (b.spillback_eta_s ?? 999),
    );
    const earliest = spillbackForecasts[0];
    spillbackEtaText = `${earliest.movement_id}: ${earliest.spillback_eta_s}s`;
    spillbackRisk = earliest.risk || "critical";
  }

  return (
    <section
      className="kpi-strip"
      aria-label="Network summary key performance indicators"
      data-testid="kpi-strip"
    >
      <div className="kpi-card">
        <span className="kpi-label">VEHICLES IN NETWORK</span>
        <strong className="kpi-value">
          {f ? inNetwork : "—"}
          <small className="kpi-unit">veh</small>
        </strong>
        <span className="kpi-subtext">
          {f ? `${completedTrips} completed trips` : "Awaiting scenario start"}
        </span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">AVG SPEED</span>
        <strong
          className={`kpi-value ${
            avgSpeed > 30 ? "healthy" : avgSpeed > 15 ? "warning" : avgSpeed > 0 ? "critical" : ""
          }`}
        >
          {f ? avgSpeed.toFixed(1) : "—"}
          <small className="kpi-unit">km/h</small>
        </strong>
        <span className="kpi-subtext">
          {f ? "Across modeled links" : "Baseline free-flow"}
        </span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">AVG QUEUE</span>
        <strong className="kpi-value">
          {f ? avgQueue.toFixed(1) : "—"}
          <small className="kpi-unit">veh / approach</small>
        </strong>
        <span className="kpi-subtext">
          {f ? `${totalQueue} total queued` : "No queue buildup"}
        </span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">CRITICAL NODES</span>
        <strong
          className={`kpi-value ${criticalNodesCount > 0 ? "warning" : "healthy"}`}
        >
          {f ? criticalNodesCount : "0"}
          <small className="kpi-unit">of 2 controlled</small>
        </strong>
        <span className="kpi-subtext">
          {criticalNodesCount > 0
            ? Array.from(criticalNodesSet).join(", ") + " congested"
            : "All junctions nominal"}
        </span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">PREDICTED SPILLBACK ETA</span>
        <strong
          className={`kpi-value ${
            spillbackRisk === "critical"
              ? "critical"
              : spillbackRisk === "warning"
                ? "warning"
                : "healthy"
          }`}
        >
          {f ? spillbackEtaText : "—"}
        </strong>
        <span className="kpi-subtext">
          {spillbackForecasts.length > 0
            ? "Upstream storage overflow risk"
            : "No spillback in horizon"}
        </span>
      </div>
    </section>
  );
}
