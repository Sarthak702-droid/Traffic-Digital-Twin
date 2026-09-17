"use client";

import React, { useId } from "react";
import type { Network } from "../../../packages/contracts/typescript/network";
import type {
  Forecast,
  MovementState,
  SignalState,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

export function NetworkCanvas({
  network,
  onSelect,
  route = [],
  frame,
  forecasts = [],
  horizon = 0,
}: {
  network: Network;
  onSelect: (id: string) => void;
  route?: string[];
  frame?: TrafficState | null;
  forecasts?: Forecast[];
  horizon?: number;
}) {
  const uniqueId = useId().replace(/:/g, "");
  const maxX = Math.max(...network.nodes.map((n) => n.x)) + 140;
  const maxY = Math.max(...network.nodes.map((n) => n.y)) + 90;
  const nodes = new Map(network.nodes.map((n) => [n.id, n]));

  // Index movements and signals by incoming link and node for quick overlay lookup
  const movementsByLink = new Map<string, MovementState[]>();
  if (frame?.movements) {
    for (const m of frame.movements) {
      const configMove = network.movements.find((c) => c.id === m.movement_id);
      if (configMove) {
        const linkId = configMove.incoming_link_id;
        const list = movementsByLink.get(linkId) ?? [];
        list.push(m);
        movementsByLink.set(linkId, list);
      }
    }
  }

  const signalsByNode = new Map<string, SignalState>();
  if (frame?.signals) {
    for (const s of frame.signals) {
      signalsByNode.set(s.node_id, s);
    }
  }

  return (
    <div className="network-canvas-container">
      <svg
        className="network-svg"
        viewBox={`0 0 ${maxX} ${maxY}`}
        role="group"
        aria-label="Configured demonstration network; select a junction to inspect it"
      >
        <defs>
          <pattern
            id={`grid-${uniqueId}`}
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1.5" cy="1.5" r="1" fill="#1c2b36" />
          </pattern>
          <marker
            id={`arrow-${uniqueId}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#627785" />
          </marker>
          <marker
            id={`arrow-active-${uniqueId}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#8ec7ad" />
          </marker>
          <marker
            id={`arrow-route-${uniqueId}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#c0abed" />
          </marker>
        </defs>

        {/* Background coordinate grid */}
        <rect
          width="100%"
          height="100%"
          fill={`url(#grid-${uniqueId})`}
          pointerEvents="none"
        />

        {/* Render Directional Links with Queue, Flow & Speed Overlays */}
        {network.links.map((link) => {
          const from = nodes.get(link.from_node);
          const to = nodes.get(link.to_node);
          if (!from || !to) return null;

          const length = Math.hypot(to.x - from.x, to.y - from.y);
          const dx = (to.x - from.x) / length;
          const dy = (to.y - from.y) / length;
          const offset = 11; // separation between opposing directional lanes

          const x1 = from.x + dx * 36 - dy * offset;
          const y1 = from.y + dy * 36 + dx * offset;
          const x2 = to.x - dx * 40 - dy * offset;
          const y2 = to.y - dy * 40 + dx * offset;

          const isRoute = route.some(
            (id, i) => id === from.id && route[i + 1] === to.id,
          );

          // Find live movements on this incoming link
          const linkMovements = movementsByLink.get(link.id) ?? [];
          const linkConfigMoves = network.movements.filter((m) => m.incoming_link_id === link.id);
          const horizonForecasts =
            horizon > 0
              ? forecasts.filter(
                  (f) =>
                    f.horizon_s === horizon &&
                    linkConfigMoves.some((m) => m.id === f.movement_id),
                )
              : [];
          const linkSpillback = forecasts.find(
            (f) =>
              linkConfigMoves.some((m) => m.id === f.movement_id) &&
              f.spillback_eta_s != null &&
              f.spillback_eta_s > 0,
          );

          const liveLinkQueue = linkMovements.reduce((sum, m) => sum + m.queue_veh, 0);
          const linkQueue =
            horizonForecasts.length > 0
              ? horizonForecasts.reduce((sum, f) => sum + f.queue_veh, 0)
              : liveLinkQueue;

          const linkFlow = linkMovements.reduce((sum, m) => sum + m.arrival_rate_vpm, 0);
          const avgLinkSpeed =
            linkMovements.length > 0
              ? linkMovements.reduce((sum, m) => sum + m.avg_speed_kph, 0) /
                linkMovements.length
              : link.free_flow_speed_kph;
          const totalVehicles = linkMovements.reduce(
            (sum, m) => sum + m.vehicle_count,
            0,
          );

          // Queue ratio relative to storage capacity
          const queueRatio = Math.min(
            1,
            linkQueue / Math.max(1, link.storage_capacity_veh),
          );
          const queueColor =
            queueRatio > 0.65 ? "#e8a4a0" : queueRatio > 0.3 ? "#e4b967" : "#83b7a0";

          // Calculate midpoint for badges
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          // Perpendicular offset for text positioning
          const labelShift = 14;
          const lx = midX - dy * labelShift;
          const ly = midY + dx * labelShift;

          // Animation speed duration (faster when speed is high)
          const animSpeed = Math.max(1.5, Math.min(6, 60 / Math.max(10, avgLinkSpeed)));

          return (
            <g key={link.id} className="network-link-group">
              <title>
                {link.id}: {link.from_node} → {link.to_node} ({link.length_m}m,{" "}
                {link.storage_capacity_veh} veh storage)
                {frame ? ` · Queue: ${linkQueue} veh · Speed: ${avgLinkSpeed.toFixed(1)} km/h` : ""}
              </title>

              {/* Roadway Base Track */}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isRoute ? "#35244f" : "#14212a"}
                strokeWidth="18"
                strokeLinecap="round"
              />

              {/* Visual Queue Buildup Overlay on incoming stop-line */}
              {frame && linkQueue > 0 && (
                <line
                  x1={x2 - dx * Math.min(length * 0.75, linkQueue * 6)}
                  y1={y2 - dy * Math.min(length * 0.75, linkQueue * 6)}
                  x2={x2}
                  y2={y2}
                  stroke={queueColor}
                  strokeWidth="14"
                  strokeOpacity="0.45"
                  strokeLinecap="round"
                />
              )}

              {/* Directional Centerline & Flow Direction Arrow */}
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isRoute ? "#bea8e7" : totalVehicles > 0 ? "#435d6a" : "#263945"}
                strokeWidth={isRoute ? "2.2" : "1.5"}
                strokeDasharray={totalVehicles > 0 ? "4 6" : "2 5"}
                markerEnd={
                  isRoute
                    ? `url(#arrow-route-${uniqueId})`
                    : totalVehicles > 0
                      ? `url(#arrow-active-${uniqueId})`
                      : `url(#arrow-${uniqueId})`
                }
              />

              {/* Data-driven animated vehicle particles (Story S09) */}
              {frame && totalVehicles > 0 && (
                <>
                  <circle r="3.2" fill={isRoute ? "#d1bbfb" : "#94d3b6"} className="flow-marker">
                    <animateMotion
                      dur={`${animSpeed.toFixed(1)}s`}
                      repeatCount="indefinite"
                      path={`M ${x1} ${y1} L ${x2} ${y2}`}
                    />
                  </circle>
                  {totalVehicles > 3 && (
                    <circle
                      r="2.8"
                      fill={isRoute ? "#b99bf2" : "#71b899"}
                      className="flow-marker"
                    >
                      <animateMotion
                        dur={`${animSpeed.toFixed(1)}s`}
                        begin={`${(animSpeed * 0.45).toFixed(1)}s`}
                        repeatCount="indefinite"
                        path={`M ${x1} ${y1} L ${x2} ${y2}`}
                      />
                    </circle>
                  )}
                </>
              )}

              {/* Overlay Badges: Speed & Queue Indicators (Story S09) */}
              {frame && (
                <g className="link-metrics-overlay">
                  {/* Link Speed Tag */}
                  <rect
                    x={lx - 22}
                    y={ly - 8}
                    width="44"
                    height="15"
                    rx="3"
                    fill="#0d1720ee"
                    stroke="#273844"
                    strokeWidth="0.8"
                  />
                  <text
                    x={lx}
                    y={ly + 3}
                    textAnchor="middle"
                    className="canvas-metric-text"
                    fill={
                      avgLinkSpeed > 30 ? "#8fc7ad" : avgLinkSpeed > 15 ? "#dfb677" : "#e8a4a0"
                    }
                  >
                    {avgLinkSpeed.toFixed(0)} km/h
                  </text>

                  {/* Spillback ETA Alert Badge (Story S12) */}
                  {linkSpillback && linkSpillback.spillback_eta_s != null && (
                    <g
                      className="canvas-spillback-badge"
                      transform={`translate(${lx}, ${ly - 20})`}
                    >
                      <rect
                        x="-38"
                        y="-8"
                        width="76"
                        height="16"
                        rx="3"
                        fill="#381010ee"
                        stroke="#ef4444"
                        strokeWidth="1.2"
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        fill="#fca5a5"
                        fontSize="8.5"
                        fontWeight="700"
                        fontFamily="monospace"
                      >
                        ⚠ SPILL {linkSpillback.spillback_eta_s}s
                      </text>
                    </g>
                  )}

                  {/* If queue is present, display Queue Pill near stop line */}
                  {linkQueue > 0 && (
                    <g
                      transform={`translate(${x2 - dx * 28 - dy * 12}, ${y2 - dy * 28 + dx * 12})`}
                    >
                      <rect
                        x="-14"
                        y="-7"
                        width="28"
                        height="14"
                        rx="3"
                        fill="#15212add"
                        stroke={queueColor}
                        strokeWidth="1"
                      />
                      <text
                        x="0"
                        y="3"
                        textAnchor="middle"
                        className="canvas-queue-text"
                        fill={queueColor}
                      >
                        Q:{linkQueue}
                      </text>
                    </g>
                  )}
                </g>
              )}

              {/* Static distance label if simulation is not streaming */}
              {!frame && link.from_node < link.to_node && (
                <text
                  x={(from.x + to.x) / 2 + (dx === 0 ? 38 : 0)}
                  y={(from.y + to.y) / 2 + (dy === 0 ? -32 : 0)}
                  className="link-label"
                  textAnchor="middle"
                >
                  {link.length_m} m
                </text>
              )}
            </g>
          );
        })}

        {/* Render Network Nodes with Signal Overlays & Countdown (Story S09) */}
        {network.nodes.map((node) => {
          const isControlled = node.kind === "controlled";
          const inRoute = route.includes(node.id);
          const signal = signalsByNode.get(node.id);

          const signalIndication = signal?.indication ?? "unknown";
          const signalColor =
            signalIndication === "green"
              ? "#83b7a0"
              : signalIndication === "amber"
                ? "#e4b967"
                : signalIndication === "all_red" || signalIndication === "red"
                  ? "#ce7975"
                  : isControlled
                    ? "#3f5660"
                    : "#2b3b45";

          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${node.id}, ${node.label}`}
              onClick={() => onSelect(node.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(node.id);
                }
              }}
              className="map-node"
            >
              {/* Outer Signal Glow / Ring for Controlled Junctions */}
              {isControlled && (
                <>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="44"
                    fill="none"
                    stroke={signalColor}
                    strokeWidth="1.8"
                    strokeDasharray={signalIndication === "green" ? "none" : "4 4"}
                    strokeOpacity={frame ? "0.85" : "0.3"}
                  />
                  {/* Real-time Remaining Seconds Pill overlay */}
                  {signal && (
                    <g transform={`translate(${node.x}, ${node.y - 48})`}>
                      <rect
                        x="-20"
                        y="-8"
                        width="40"
                        height="16"
                        rx="4"
                        fill="#0c161fe6"
                        stroke={signalColor}
                        strokeWidth="1"
                      />
                      <text
                        x="0"
                        y="4"
                        textAnchor="middle"
                        className="canvas-signal-countdown"
                        fill={signalColor}
                      >
                        {signal.remaining_s}s
                      </text>
                    </g>
                  )}
                </>
              )}

              {/* Main Node Disc */}
              <circle
                cx={node.x}
                cy={node.y}
                r="34"
                fill="#0f1922"
                stroke={inRoute ? "#c0abed" : isControlled ? "#475c68" : "#2f3f4a"}
                strokeWidth={inRoute ? "2.2" : "1.6"}
              />

              {/* Signal Status Center Pip */}
              {isControlled && (
                <circle
                  cx={node.x}
                  cy={node.y - 18}
                  r="4.5"
                  fill={signalColor}
                />
              )}

              {/* Node ID label */}
              <text
                x={node.x}
                y={node.y + (isControlled ? 8 : 6)}
                textAnchor="middle"
                className="node-label"
              >
                {node.id}
              </text>

              {/* Node Type Description */}
              <text
                x={node.x + (isControlled ? 56 : 0)}
                y={node.y + (isControlled ? 4 : 54)}
                textAnchor={isControlled ? "start" : "middle"}
                className="node-kind"
              >
                {isControlled ? "Controlled junction" : "Boundary"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
