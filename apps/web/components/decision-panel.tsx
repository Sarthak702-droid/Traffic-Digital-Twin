"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/lib/api";
import type {
  Analysis,
  ComparisonResult,
  TimingChange,
  TrafficState,
} from "../../../packages/contracts/typescript/events";

export function DecisionPanel({ frame }: { frame: TrafficState | null }) {
  const client = useQueryClient();
  const [horizon, setHorizon] = useState(30);
  const [reason, setReason] = useState("");
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [manual, setManual] = useState(false);
  const analysis = useQuery({
    queryKey: ["analysis", frame?.run_id],
    queryFn: () => request<Analysis>("/analysis"),
    enabled: !!frame,
    refetchInterval: 2000,
    retry: false,
  });
  const a = analysis.data?.run_id === frame?.run_id ? analysis.data : null;
  const rec = a?.recommendation;
  const decision = useMutation({
    mutationFn: async (action: string) => {
      if (!rec) throw Error("No active recommendation");
      const changes: TimingChange[] = rec.changes.map((c) => ({
        ...c,
        green_s: edits[c.phase_id] ?? c.green_s,
      }));
      return {
        action,
        result: await request<ComparisonResult>(
          `/recommendations/${rec.id}/${action}`,
          {
            method: "POST",
            body: JSON.stringify({
              reason,
              ...(action === "modify" ? { changes } : {}),
            }),
          },
        ),
      };
    },
    onSuccess: ({ action, result }) => {
      if (action === "simulate") setComparison(result);
      else setComparison(null);
      client.invalidateQueries({ queryKey: ["analysis"] });
      client.invalidateQueries({ queryKey: ["audit"] });
    },
  });
  const mode = useMutation({
    mutationFn: () =>
      request(`/mode/${manual ? "recommendation" : "manual"}`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      setManual(!manual);
      client.invalidateQueries({ queryKey: ["analysis"] });
    },
  });
  const replay = useMutation({
    mutationFn: () =>
      request(`/replay/${frame?.scenario_type || "peak_surge"}`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      setManual(true);
      setComparison(null);
      client.invalidateQueries();
    },
  });
  return (
    <section
      className="decision-panel"
      aria-label="Prediction and operator decisions"
    >
      <div className="panel-heading">
        <div>
          <span className="overline">PREDICTIVE DECISION SUPPORT</span>
          <h2>Forecast & virtual signal plan</h2>
        </div>
        <button
          onClick={() => mode.mutate()}
          disabled={!frame || frame.replay || mode.isPending}
        >
          {manual ? "Enable recommendations" : "Manual / observe"}
        </button>
      </div>
      {frame?.replay && (
        <p role="status">
          <strong>GOLDEN REPLAY · PRERECORDED SYNTHETIC TRAFFIC</strong>
        </p>
      )}
      <p className="field-hint">
        Conservation-model estimates · synthetic traffic · +5 minute output is
        advisory.
      </p>
      <label>
        Forecast horizon{" "}
        <select
          aria-label="Forecast horizon"
          value={horizon}
          onChange={(e) => setHorizon(Number(e.target.value))}
        >
          {[30, 60, 120, 300].map((h) => (
            <option key={h} value={h}>
              +{h} seconds
            </option>
          ))}
        </select>
      </label>
      {analysis.isError ? (
        <p role="status">
          Fresh forecasts unavailable. Signal decisions are disabled.
        </p>
      ) : (
        <div className="forecast-grid">
          {a?.forecasts
            .filter((f) => f.horizon_s === horizon)
            .map((f) => (
              <div key={f.id} className={`forecast-item ${f.risk}`}>
                <strong>{f.movement_id}</strong>
                <span>
                  {f.queue_veh.toFixed(1)} queued ·{" "}
                  {Math.round(f.occupancy_ratio * 100)}% storage
                </span>
                <span>
                  {f.risk}
                  {f.spillback_eta_s != null
                    ? ` · spillback ETA ${f.spillback_eta_s}s`
                    : ""}
                </span>
                <small>{f.explanation_facts[0]}</small>
              </div>
            ))}
        </div>
      )}
      {frame?.incident?.id && (
        <p role="status">
          C3 incident: {frame.incident.status} · capacity{" "}
          {Math.round(frame.incident.capacity_ratio * 100)}% · recovery estimate{" "}
          {frame.incident.recovery_cycles} cycles
        </p>
      )}
      {frame?.emergency?.id && (
        <p role="status">
          Emergency: {frame.emergency.status} ·{" "}
          {frame.emergency.route_node_ids
            .map(
              (n, i) => `${n}: ${Math.round(frame.emergency?.eta_s[i] || 0)}s`,
            )
            .join(" → ")}{" "}
          · recovery {frame.emergency.recovery_cycles_remaining} cycles
        </p>
      )}
      {rec && !manual && !frame?.replay && !analysis.isError ? (
        <>
          <h3>{rec.reason}</h3>
          <p>
            Status: {rec.status} · {rec.safety_status}
          </p>
          <ul>
            {rec.explanation_facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <div className="timing-grid">
            {rec.changes.map((c) => (
              <label key={c.phase_id}>
                {c.phase_id}
                <input
                  type="number"
                  aria-label={`Green seconds ${c.phase_id}`}
                  value={edits[c.phase_id] ?? c.green_s}
                  onChange={(e) =>
                    setEdits({ ...edits, [c.phase_id]: Number(e.target.value) })
                  }
                />
                <small>seconds of green</small>
              </label>
            ))}
          </div>
          <label>
            Decision reason
            <textarea
              aria-label="Decision reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Required for modify or reject"
            />
          </label>
          <div className="decision-actions">
            {["simulate", "approve", "modify", "reject"].map((action) => (
              <button
                key={action}
                disabled={
                  decision.isPending ||
                  rec.status !== "pending" ||
                  ((action === "modify" || action === "reject") &&
                    !reason.trim())
                }
                onClick={() => decision.mutate(action)}
              >
                {action === "approve"
                  ? "Approve in digital twin"
                  : action[0].toUpperCase() + action.slice(1)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p>
          No actionable recommendation. Start a scenario in Recommend mode or
          wait for the next analysis.
        </p>
      )}
      {comparison && comparison.run_id === frame?.run_id && (
        <div className="comparison" aria-label="Before and after comparison">
          <h3>
            Same initial state · {comparison.initial_time_s}s · seed{" "}
            {comparison.seed}
          </h3>
          <p>
            {comparison.model_version} · {comparison.horizon_s}s aggregate
            simulation · estimates
          </p>
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Baseline</th>
                <th>Candidate</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Maximum queue (veh)</td>
                <td>{comparison.baseline_max_queue_veh.toFixed(1)}</td>
                <td>{comparison.candidate_max_queue_veh.toFixed(1)}</td>
              </tr>
              <tr>
                <td>Average modeled delay (s)</td>
                <td>{comparison.baseline_avg_delay_s.toFixed(1)}</td>
                <td>{comparison.candidate_avg_delay_s.toFixed(1)}</td>
              </tr>
              <tr>
                <td>Spillback movement-seconds</td>
                <td>{comparison.baseline_spillback_s}</td>
                <td>{comparison.candidate_spillback_s}</td>
              </tr>
              <tr>
                <td>Modeled stops / vehicle</td>
                <td>{comparison.baseline_stops_per_vehicle.toFixed(2)}</td>
                <td>{comparison.candidate_stops_per_vehicle.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {(decision.error || mode.error || replay.error) && (
        <p role="alert">
          {(decision.error || mode.error || replay.error)?.message}
        </p>
      )}
      {decision.isSuccess && (
        <p role="status">{decision.data.action} completed and audited.</p>
      )}
      <details>
        <summary>Demo fallback</summary>
        <p>
          Golden replay uses prerecorded synthetic traffic. Operator signal
          changes are disabled. Start a live scenario to return.
        </p>
        <button onClick={() => replay.mutate()} disabled={replay.isPending}>
          Start golden replay
        </button>
        {replay.isSuccess && <strong>GOLDEN REPLAY · PRERECORDED</strong>}
      </details>
    </section>
  );
}
