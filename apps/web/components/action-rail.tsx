"use client";

import { useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Layers,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  TrafficCone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  Analysis,
  ComparisonResult,
  TimingChange,
  TrafficState,
} from "../../../packages/contracts/typescript/events";
import type { Network, Scenario } from "../../../packages/contracts/typescript/network";

const scenarioLabels: Record<string, string> = {
  peak_surge: "Peak demand surge",
  incident_c3: "C3 capacity reduction",
  ambulance_corridor: "Emergency corridor",
};

export function ActionRail({
  network,
  frame,
  analysis,
  scenarioID,
  setScenarioID,
  seed,
  setSeed,
  dbReady,
  liveFresh,
  prepareMutation,
  resetMutation,
  onSimulate,
  onApprove,
  onModify,
  onReject,
  decisionPending,
}: {
  network: Network;
  frame: TrafficState | null;
  analysis: Analysis | null;
  scenarioID: Scenario["id"];
  setScenarioID: (id: Scenario["id"]) => void;
  seed: string;
  setSeed: (seed: string) => void;
  dbReady: boolean;
  liveFresh: boolean;
  prepareMutation: {
    mutate: () => void;
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    isSuccess: boolean;
    reset: () => void;
  };
  resetMutation: {
    mutate: () => void;
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    isSuccess: boolean;
    data?: any;
    reset: () => void;
  };
  onSimulate: () => void;
  onApprove: () => void;
  onModify: (reason: string, changes: TimingChange[]) => void;
  onReject: (reason: string) => void;
  decisionPending: boolean;
}) {
  const [formError, setFormError] = useState("");
  const [modifyOpen, setModifyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [decisionReason, setDecisionReason] = useState("");
  const [edits, setEdits] = useState<Record<string, number>>({});

  const rec = analysis?.recommendation;
  const forecasts = analysis?.forecasts ?? [];

  // Determine highest-priority alert
  let alertSeverity: "critical" | "warning" | "emergency" | "normal" = "normal";
  let alertTitle = "Network Flow Nominal";
  let alertDesc = "All C1–C6 links operating within normal capacity envelopes.";
  let alertIcon = ShieldCheck;

  if (frame?.emergency?.id && frame.emergency.status === "active") {
    alertSeverity = "emergency";
    alertTitle = "Emergency Corridor Active";
    alertDesc = `Ambulance en route (${frame.emergency.route_node_ids.join(" → ")}). Signal pre-clearance engaged.`;
    alertIcon = Siren;
  } else if (frame?.incident?.id && frame.incident.status === "active") {
    alertSeverity = "critical";
    alertTitle = "C3 Incident · 50% Capacity Cut";
    alertDesc = "Lane obstruction active at C3. Metering upstream feeders to prevent spillback.";
    alertIcon = TrafficCone;
  } else {
    const spillback = forecasts.find((f) => f.spillback_eta_s != null && f.spillback_eta_s > 0);
    if (spillback) {
      alertSeverity = "warning";
      alertTitle = `Spillback Risk · ${spillback.movement_id}`;
      alertDesc = `Projected spillback in ${spillback.spillback_eta_s}s. Upstream queue approaching storage limit.`;
      alertIcon = AlertTriangle;
    }
  }

  // Determine next predicted issue
  const nextIssueForecast = forecasts.find(
    (f) => f.risk === "critical" || f.risk === "warning",
  );
  let nextIssueTitle = "No imminent risk";
  let nextIssueEta = "Clean horizon";
  let nextIssueNote = "Next 5 minutes projected stable under current timing.";

  if (nextIssueForecast) {
    nextIssueTitle = `Congestion at ${nextIssueForecast.movement_id}`;
    nextIssueEta = nextIssueForecast.spillback_eta_s
      ? `in ${nextIssueForecast.spillback_eta_s}s`
      : `at +${nextIssueForecast.horizon_s}s`;
    nextIssueNote = nextIssueForecast.explanation_facts[0] || "Elevated queue detected.";
  }

  function handleStart() {
    if (!/^\d+$/.test(seed) || Number(seed) < 1 || Number(seed) > 4294967295) {
      setFormError("Enter an integer seed between 1 and 4294967295.");
      return;
    }
    setFormError("");
    resetMutation.reset();
    prepareMutation.mutate();
  }

  function submitModify() {
    if (!rec) return;
    if (!decisionReason.trim()) {
      setFormError("Reason is required when modifying a recommendation.");
      return;
    }
    const changes: TimingChange[] = rec.changes.map((c) => ({
      ...c,
      green_s: edits[c.phase_id] ?? c.green_s,
    }));
    onModify(decisionReason, changes);
    setModifyOpen(false);
    setDecisionReason("");
  }

  function submitReject() {
    if (!rec) return;
    if (!decisionReason.trim()) {
      setFormError("Reason is required when rejecting a recommendation.");
      return;
    }
    onReject(decisionReason);
    setRejectOpen(false);
    setDecisionReason("");
  }

  return (
    <aside className="action-rail" aria-label="Command center operational action rail">
      {/* 1. HIGHEST-PRIORITY ALERT (PRD §8.1) */}
      <section className={`action-card alert-card ${alertSeverity}`} data-testid="priority-alert">
        <div className="action-card-header">
          <span className="card-badge alert-badge">{alertSeverity.toUpperCase()} ALERT</span>
          {alertSeverity === "normal" ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
        </div>
        <h3>{alertTitle}</h3>
        <p>{alertDesc}</p>
      </section>

      {/* 2. CURRENT RECOMMENDATION CARD (PRD §8.1) */}
      <section className="action-card rec-card" data-testid="current-recommendation">
        <div className="action-card-header">
          <span className="card-badge rec-badge">
            {rec ? `${rec.priority.toUpperCase()} RECOMMENDATION` : "DECISION SUPPORT"}
          </span>
          <Sparkles size={16} className="sparkle-icon" />
        </div>

        {rec && rec.status === "pending" ? (
          <>
            <h3>{rec.reason}</h3>
            <div className="rec-meta-row">
              <span className="safety-pill">
                <Check size={12} /> {rec.safety_status}
              </span>
              <span className="timing-summary">
                {rec.changes.map((c) => `${c.phase_id}: ${c.green_s}s`).join(" · ")}
              </span>
            </div>

            {rec.explanation_facts?.length > 0 && (
              <p className="rec-fact">{rec.explanation_facts[0]}</p>
            )}

            {/* Quick Decision Actions */}
            <div className="rec-actions-grid">
              <Button
                variant="outline"
                className="action-btn"
                onClick={onSimulate}
                disabled={decisionPending}
                title="Simulate before and after rollout in digital twin"
              >
                <Layers size={14} /> Simulate
              </Button>
              <Button
                variant="default"
                className="action-btn approve-btn"
                onClick={onApprove}
                disabled={decisionPending}
                title="Approve candidate plan inside digital twin"
              >
                <Check size={14} /> Approve in Twin
              </Button>
              <Button
                variant="outline"
                className="action-btn"
                onClick={() => {
                  setModifyOpen(!modifyOpen);
                  setRejectOpen(false);
                }}
                disabled={decisionPending}
              >
                Modify
              </Button>
              <Button
                variant="ghost"
                className="action-btn reject-btn"
                onClick={() => {
                  setRejectOpen(!rejectOpen);
                  setModifyOpen(false);
                }}
                disabled={decisionPending}
              >
                Reject
              </Button>
            </div>

            {/* Modify Sub-panel */}
            {modifyOpen && (
              <div className="decision-subpanel modify-subpanel">
                <div className="overline">BOUNDED MODIFICATION</div>
                {rec.changes.map((c) => (
                  <label key={c.phase_id} className="timing-input-label">
                    <span>{c.phase_id} Green (s)</span>
                    <input
                      type="number"
                      min={10}
                      max={60}
                      value={edits[c.phase_id] ?? c.green_s}
                      onChange={(e) =>
                        setEdits({ ...edits, [c.phase_id]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
                <textarea
                  placeholder="Mandatory reason for operator modification..."
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  rows={2}
                />
                <Button variant="default" onClick={submitModify} disabled={decisionPending}>
                  Confirm Modification
                </Button>
              </div>
            )}

            {/* Reject Sub-panel */}
            {rejectOpen && (
              <div className="decision-subpanel reject-subpanel">
                <div className="overline">REJECTION REASON</div>
                <textarea
                  placeholder="Mandatory reason for operator rejection..."
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  rows={2}
                />
                <Button variant="outline" onClick={submitReject} disabled={decisionPending}>
                  Confirm Rejection
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="rec-idle-state">
            <p>
              {liveFresh
                ? "Current traffic is balanced under active signal plans. Next recommendation will appear if congestion rises."
                : "Awaiting active simulation. Start a scenario below to generate real-time recommendations."}
            </p>
          </div>
        )}
      </section>

      {/* 3. NEXT PREDICTED ISSUE (PRD §8.1) */}
      <section className="action-card issue-card" data-testid="next-predicted-issue">
        <div className="action-card-header">
          <span className="card-badge issue-badge">FORWARD HORIZON</span>
          <Clock size={16} />
        </div>
        <div className="issue-row">
          <div>
            <h3>{nextIssueTitle}</h3>
            <p>{nextIssueNote}</p>
          </div>
          <span className="eta-badge">{nextIssueEta}</span>
        </div>
      </section>

      {/* 4. SCENARIO LAUNCHER & RESET */}
      <section className="action-card prepare-card">
        <div className="action-card-header">
          <span className="card-badge">DEMO RUN CONFIGURATION</span>
          <Activity size={16} />
        </div>

        <label htmlFor="scenario-select">Scenario</label>
        <select
          id="scenario-select"
          value={scenarioID}
          onChange={(e) => {
            const id = e.target.value as Scenario["id"];
            setScenarioID(id);
            const s = network.scenarios.find((sc) => sc.id === id);
            if (s) setSeed(String(s.seed));
            setFormError("");
            prepareMutation.reset();
          }}
        >
          {network.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {scenarioLabels[s.id] || s.id}
            </option>
          ))}
        </select>

        <label htmlFor="seed-input">Deterministic Seed</label>
        <input
          id="seed-input"
          inputMode="numeric"
          value={seed}
          onChange={(e) => {
            setSeed(e.target.value);
            prepareMutation.reset();
          }}
        />
        <span className="field-hint">
          Deterministic seed guarantees scientific repeatability.
        </span>

        <Button
          onClick={handleStart}
          disabled={prepareMutation.isPending || resetMutation.isPending || !dbReady}
        >
          {prepareMutation.isPending ? "Starting SUMO…" : "Start simulation"}
          <ArrowRight size={15} />
        </Button>

        <Button
          variant="outline"
          onClick={() => resetMutation.mutate()}
          disabled={!frame || resetMutation.isPending || prepareMutation.isPending || !dbReady}
        >
          {resetMutation.isPending ? "Resetting…" : "Reset same seed"}
          <RefreshCw size={14} />
        </Button>

        {resetMutation.isError && (
          <p role="alert" className="form-error">
            {resetMutation.error?.message}
          </p>
        )}
        {resetMutation.isSuccess && (
          <p role="status" className="form-success">
            Scenario reset. Seed {resetMutation.data?.seed}.
          </p>
        )}
        {(formError || prepareMutation.isError) && (
          <p className="form-error" role="alert">
            {formError || prepareMutation.error?.message}
          </p>
        )}
        {prepareMutation.isSuccess && (
          <p className="form-success" role="status">
            Simulation started. Seed {seed}.
          </p>
        )}
      </section>
    </aside>
  );
}
