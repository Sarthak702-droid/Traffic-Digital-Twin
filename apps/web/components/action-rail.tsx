"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Info,
  Layers,
  Network as NetworkIcon,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  TrafficCone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  Analysis,
  ComparisonResult,
  Recommendation,
  TimingChange,
  TrafficState,
} from "../../../packages/contracts/typescript/events";
import type { Network, Scenario } from "../../../packages/contracts/typescript/network";

const scenarioLabels: Record<string, string> = {
  peak_surge: "Peak demand surge",
  incident_c3: "C3 capacity reduction",
  ambulance_corridor: "Emergency corridor",
};

export const MANDATORY_REASONS = [
  "Field observation",
  "Accident/obstruction",
  "Pedestrian crowd",
  "Procession/festival",
  "VIP movement",
  "Emergency vehicle",
  "Camera/sensor issue",
  "Signal malfunction",
  "Other",
] as const;

export type MandatoryReason = (typeof MANDATORY_REASONS)[number];

export function isEmergencyProtectionActive(frame: TrafficState | null): boolean {
  return !!frame?.emergency?.id && ["pre_clearance", "priority", "active"].includes(frame.emergency.status);
}

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
  onSelectAlternative,
  decisionPending,
  comparisonResult,
  onClearComparison,
  manualMode,
  canAct = true,
  onDirty,
  draftOwner = "local-demo",
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
  onModify: (reason: string, changes: TimingChange[]) => void | Promise<unknown>;
  onReject: (reason: string) => void | Promise<unknown>;
  onSelectAlternative?: (alt: Recommendation | null) => void;
  decisionPending: boolean;
  comparisonResult?: ComparisonResult | null;
  onClearComparison?: () => void;
  manualMode?: boolean;
  canAct?: boolean;
  onDirty?: (dirty:boolean)=>void;
  draftOwner?: string;
}) {
  const [selectedAltId, setSelectedAltId] = useState<string | null>(null);
  const [showAllFacts, setShowAllFacts] = useState(false);

  useEffect(() => {
    setSelectedAltId(null);
  }, [analysis?.run_id, analysis?.recommendation?.id]);

  const primaryRec = analysis?.recommendation;
  const activeRec = (selectedAltId && analysis?.alternatives?.find((a) => a.id === selectedAltId)) || primaryRec;
  const isAltSelected = !!(selectedAltId && activeRec && activeRec.id !== primaryRec?.id);
  const rec = activeRec;

  const recId = rec?.id;
  const runId = analysis?.run_id || frame?.run_id || "active";
  const draftKey = recId ? `twin-draft:${draftOwner}:${runId}:${recId}` : null;
  const [savedDraft] = useState(()=>{
    if (!draftKey) return null;
    try {const value=JSON.parse(sessionStorage.getItem(draftKey)||"null");
      if(value && typeof value.notes==="string" && (value.reason===""||MANDATORY_REASONS.includes(value.reason)) && value.edits && typeof value.edits==="object" && Object.values(value.edits).every(x=>typeof x==="number"&&Number.isFinite(x)))return value;
    }catch{};return null;
  });
  const [formError, setFormError] = useState("");
  const [modifyOpen, setModifyOpen] = useState(!!savedDraft?.modify);
  const [rejectOpen, setRejectOpen] = useState(!!savedDraft?.reject);
  const [reasonCategory, setReasonCategory] = useState<MandatoryReason | "">(savedDraft?.reason || "");
  const [decisionReason, setDecisionReason] = useState<string>(savedDraft?.notes || "");
  const [edits, setEdits] = useState<Record<string, number>>(savedDraft?.edits || {});

  useEffect(()=>{
    if (!draftKey) return;
    try{
      if(modifyOpen||rejectOpen)sessionStorage.setItem(draftKey,JSON.stringify({modify:modifyOpen,reject:rejectOpen,reason:reasonCategory,notes:decisionReason,edits}));
      else sessionStorage.removeItem(draftKey)
    }catch{}
  },[draftKey,modifyOpen,rejectOpen,reasonCategory,decisionReason,edits]);
  useEffect(()=>{onDirty?.(modifyOpen||rejectOpen)},[modifyOpen,rejectOpen,onDirty]);
  const forecasts = analysis?.forecasts ?? [];
  const emergencyProtected = isEmergencyProtectionActive(frame);

  const getPhaseBounds = (phaseId: string) => {
    const p = network.phases.find((item) => item.id === phaseId);
    return { min: p?.min_green_s ?? 10, max: p?.max_green_s ?? 55 };
  };

  const hasOutOfBounds = rec?.changes.some((c) => {
    const val = edits[c.phase_id] ?? c.green_s;
    const { min, max } = getPhaseBounds(c.phase_id);
    return val < min || val > max || !Number.isInteger(val);
  });

  // Determine highest-priority alert
  let alertSeverity: "critical" | "warning" | "emergency" | "normal" = "normal";
  let alertTitle = liveFresh && analysis ? "No modeled alert" : "Traffic status unavailable";
  let alertDesc = liveFresh && analysis ? "No elevated risk in this fresh analysis." : "Fresh traffic and intelligence are required before assessing risk.";
  let alertIcon = ShieldCheck;

  if (frame?.emergency?.id && ["pre_clearance", "priority"].includes(frame.emergency.status)) {
    alertSeverity = "emergency";
    alertTitle = "Emergency Corridor Active";
    alertDesc = `Ambulance en route (${frame.emergency.route_node_ids.join(" → ")}). Signal pre-clearance engaged.`;
    alertIcon = Siren;
  } else if (frame?.incident?.id && frame.incident.status === "active") {
    alertSeverity = "critical";
    alertTitle = `C3 Incident · ${Math.round(frame.incident.capacity_ratio*100)}% remaining capacity`;
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
  let nextIssueTitle = analysis ? "No elevated forecast risk" : "Forecast unavailable";
  let nextIssueEta = analysis ? "Evaluated horizon" : "Unknown";
  let nextIssueNote = analysis ? "No warning in the returned forecast. This is a model estimate." : "No stability or safety conclusion is inferred.";

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
    if(frame && !window.confirm("Replace the active run? Unsent changes will be discarded.")) return;
    prepareMutation.mutate();
  }

  async function submitModify() {
    if (!rec || !canAct || decisionPending) return;
    const fullReason = decisionReason.trim()
      ? `${reasonCategory}: ${decisionReason.trim()}`
      : reasonCategory;
    if (!reasonCategory || !fullReason.trim()) {
      setFormError("Reason is required when modifying a recommendation.");
      return;
    }
    const changes: TimingChange[] = rec.changes.map((c) => ({
      ...c,
      green_s: edits[c.phase_id] ?? c.green_s,
    }));
    try {await onModify(fullReason, changes);setModifyOpen(false);setDecisionReason("");setEdits({});setFormError("")} catch(error){setFormError(error instanceof Error ? error.message : "Modification not confirmed; notes retained.")}
  }

  async function submitReject() {
    if (!rec || !canAct || decisionPending) return;
    const fullReason = decisionReason.trim()
      ? `${reasonCategory}: ${decisionReason.trim()}`
      : reasonCategory;
    if (!reasonCategory || !fullReason.trim()) {
      setFormError("Reason is required when rejecting a recommendation.");
      return;
    }
    try {await onReject(fullReason);setRejectOpen(false);setDecisionReason("");setFormError("")} catch(error){setFormError(error instanceof Error ? error.message : "Rejection not confirmed; notes retained.")}
  }

  return (
    <aside className="action-rail" aria-label="Command center operational action rail">
      {/* 1. HIGHEST-PRIORITY ALERT */}
      <section className={`action-card alert-card ${alertSeverity}`} data-testid="priority-alert">
        <div className="action-card-header">
          <span className="card-badge alert-badge">{alertSeverity.toUpperCase()} ALERT</span>
          {alertSeverity === "normal" ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
        </div>
        <h3>{alertTitle}</h3>
        <p>{alertDesc}</p>
      </section>

      {/* 2. CURRENT RECOMMENDATION CARD */}
      <section className="action-card rec-card" data-testid="current-recommendation">
        <div className="action-card-header">
          <span className="card-badge rec-badge">
            {manualMode
              ? "MANUAL AUTHORITY"
              : isAltSelected
                ? "ALTERNATIVE CANDIDATE PLAN"
                : rec
                  ? `${rec.priority.toUpperCase()} RECOMMENDATION`
                  : "DECISION SUPPORT"}
          </span>
          <SlidersHorizontal size={15} className="rec-header-icon" />
        </div>

        {isAltSelected && (
          <div className="selected-alt-banner" role="status">
            <span>Inspecting Alternative Candidate</span>
            <button
              type="button"
              onClick={() => {
                setSelectedAltId(null);
                onSelectAlternative?.(null);
              }}
            >
              Revert to Recommended Plan
            </button>
          </div>
        )}

        {manualMode ? (
          <div className="rec-idle-state manual-mode-banner" role="status">
            <Radio size={18} />
            <div>
              <strong>MANUAL MODE ACTIVE</strong>
              <p>Autonomous recommendations suspended. Operator movement locks and manual authority engaged.</p>
            </div>
          </div>
        ) : rec && rec.status === "pending" ? (
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

            {/* S17: Coordinated Network Intervention (C1 + C3) */}
            {(() => {
              const c1Changes = rec.changes.filter((c) => c.node_id === "C1");
              const c3Changes = rec.changes.filter((c) => c.node_id === "C3");
              if (c1Changes.length > 0 && c3Changes.length > 0) {
                return (
                  <div className="coordinated-corridor-card" data-testid="coordinated-corridor-card">
                    <div className="coordinated-header">
                      <NetworkIcon size={14} />
                      <span>COORDINATED NETWORK PLAN (C1 + C3)</span>
                    </div>
                    <div className="junction-action-grid">
                      <div className="junction-action-item">
                        <strong>C1 Downstream Clearance</strong>
                        <span>{c1Changes.map((c) => `${c.phase_id}: ${c.green_s}s`).join(" · ")}</span>
                        <p>Clears accumulating queue before spillback reaches storage limit.</p>
                      </div>
                      <div className="junction-action-item">
                        <strong>C3 Upstream Metering</strong>
                        <span>{c3Changes.map((c) => `${c.phase_id}: ${c.green_s}s`).join(" · ")}</span>
                        <p>Gates upstream release to match downstream corridor capacity.</p>
                      </div>
                    </div>
                    <div className="corridor-transit-note">
                      <Clock size={12} /> Platoon corridor transit delay ~22s (300m @ 50 km/h)
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {rec.explanation_facts?.length > 0 && (
              <p className="rec-fact">{rec.explanation_facts[0]}</p>
            )}

            {/* S19: Structured Explanation Facts */}
            {rec.explanation_facts && rec.explanation_facts.length > 1 && (
              <div className="explanation-facts-section" data-testid="explanation-facts-section">
                <button
                  type="button"
                  className="facts-toggle-btn"
                  onClick={() => setShowAllFacts(!showAllFacts)}
                  aria-expanded={showAllFacts}
                >
                  <Info size={13} />
                  <span>
                    {showAllFacts
                      ? "Hide Explanation Breakdown"
                      : `View Structured Explanation (${rec.explanation_facts.length} facts)`}
                  </span>
                </button>
                {showAllFacts && (
                  <div className="structured-facts-list">
                    {rec.explanation_facts.map((fact, fIdx) => (
                      <div key={fIdx} className="structured-fact-item">
                        <span className="fact-bullet">•</span>
                        <span>{fact}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {emergencyProtected && (
              <p className="emergency-protection-note" role="status">
                <ShieldAlert size={14} /> Emergency signal protection is controlling this corridor. Simulation, approval and modification resume automatically when priority clears; the operator may still reject this recommendation.
              </p>
            )}

            {/* Quick Decision Actions */}
            <div className="rec-actions-grid">
              <Button
                variant="outline"
                className="action-btn simulate-btn"
                onClick={onSimulate}
                disabled={decisionPending || !canAct || emergencyProtected}
                title={emergencyProtected ? "Unavailable while emergency signal protection is active" : "Simulate before and after rollout in digital twin"}
              >
                <Layers size={14} /> Simulate
              </Button>
              <Button
                variant="default"
                className="action-btn approve-btn"
                onClick={onApprove}
                disabled={decisionPending || !canAct || emergencyProtected}
                title={emergencyProtected ? "Approval resumes after emergency priority clears" : "Approve candidate plan inside digital twin"}
              >
                <Check size={14} /> Approve in Twin
              </Button>
              <Button
                variant="outline"
                className="action-btn modify-btn"
                onClick={() => {
                  if(!modifyOpen)setReasonCategory("");
                  setModifyOpen(!modifyOpen);
                  setRejectOpen(false);
                }}
                disabled={decisionPending || !canAct || emergencyProtected}
              >
                Modify
              </Button>
              <Button
                variant="ghost"
                className="action-btn reject-btn"
                onClick={() => {
                  if(!rejectOpen)setReasonCategory("");
                  setRejectOpen(!rejectOpen);
                  setModifyOpen(false);
                }}
                disabled={decisionPending || !canAct}
              >
                Reject
              </Button>
            </div>

            {/* Modify Sub-panel (PRD §8.3 & S15) */}
            {modifyOpen && (
              <div className="decision-subpanel modify-subpanel" role="region" aria-label="Bounded Plan Modification">
                <div className="overline">BOUNDED MODIFICATION</div>
                <div className="timing-inputs-list">
                  {rec.changes.map((c) => {
                    const bounds = getPhaseBounds(c.phase_id);
                    const currentVal = edits[c.phase_id] ?? c.green_s;
                    const isOut = currentVal < bounds.min || currentVal > bounds.max;
                    return (
                      <div key={c.phase_id} className="timing-input-row">
                        <label htmlFor={`edit-${c.phase_id}`} className="timing-input-label">
                          <div className="phase-id-block">
                            <strong>{c.phase_id}</strong>
                            <span className="phase-bounds-chip">Bounds: {bounds.min}s–{bounds.max}s</span>
                          </div>
                          <div className="input-group">
                            <input
                              id={`edit-${c.phase_id}`}
                              type="number"
                              min={bounds.min}
                              max={bounds.max}
                              value={currentVal}
                              className={isOut ? "input-invalid" : ""}
                              aria-label={`Green seconds ${c.phase_id}`}
                              onChange={(e) =>
                                setEdits({ ...edits, [c.phase_id]: Number(e.target.value) })
                              }
                            />
                            <span className="unit-label">sec</span>
                          </div>
                        </label>
                        {isOut && (
                          <span className="bound-warning-text" role="alert">
                            Must be between {bounds.min}s and {bounds.max}s
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="reason-field-group">
                  <label htmlFor="modify-reason-category">Mandatory Reason</label>
                  <select
                    id="modify-reason-category"
                    aria-label="Modification reason category"
                    value={reasonCategory}
                    onChange={(e) => setReasonCategory(e.target.value as MandatoryReason)}
                  >
                    <option value="" disabled>Select a reason</option>
                    {MANDATORY_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="reason-details-group">
                  <label htmlFor="modify-reason-text">Field Notes & Justification</label>
                  <textarea
                    id="modify-reason-text"
                    aria-label="Modification details and justification"
                    placeholder="Provide operational justification for timing adjustments..."
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    rows={2}
                  />
                </div>

                {/* Safety Envelope Checklist */}
                <div className="safety-checklist" aria-label="Safety Envelope Verification">
                  <div className="safety-checklist-header">
                    <ShieldCheck size={13} />
                    <span>Safety Envelope Verification</span>
                  </div>
                  <ul>
                    <li className={!hasOutOfBounds ? "valid" : "invalid"}>
                      <Check size={11} /> Configured min/max boundaries satisfied
                    </li>
                    <li>Conflict matrix requires fresh server validation</li>
                    <li className="valid">
                      Downstream capacity requires fresh server validation
                    </li>
                    <li className="valid">
                      Clearance constraints require fresh server validation
                    </li>
                  </ul>
                </div>

                <Button
                  variant="default"
                  className="submit-modify-btn"
                  onClick={submitModify}
                  disabled={decisionPending || !canAct || hasOutOfBounds || !reasonCategory}
                >
                  <CheckCircle2 size={14} /> Confirm Modification & Apply
                </Button>
              </div>
            )}

            {/* Reject Sub-panel (PRD §8.3 & S15) */}
            {rejectOpen && (
              <div className="decision-subpanel reject-subpanel" role="region" aria-label="Recommendation Rejection">
                <div className="overline">REJECTION REASON</div>
                <div className="reason-field-group">
                  <label htmlFor="reject-reason-category">Reason Category</label>
                  <select
                    id="reject-reason-category"
                    aria-label="Rejection reason category"
                    value={reasonCategory}
                    onChange={(e) => setReasonCategory(e.target.value as MandatoryReason)}
                  >
                    <option value="" disabled>Select a reason</option>
                    {MANDATORY_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="reason-details-group">
                  <label htmlFor="reject-reason-text">Operator Justification</label>
                  <textarea
                    id="reject-reason-text"
                    aria-label="Rejection justification"
                    placeholder="Mandatory reason for operator rejection..."
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    rows={2}
                  />
                </div>
                <Button
                  variant="outline"
                  className="reject-confirm-btn"
                  onClick={submitReject}
                  disabled={decisionPending || !canAct || !reasonCategory}
                >
                  <AlertOctagon size={14} /> Confirm Rejection
                </Button>
              </div>
            )}

            {/* Feasible Candidate Alternatives (Story S18) */}
            {analysis?.alternatives && analysis.alternatives.length > 0 && (
              <div className="alternatives-section" data-testid="feasible-alternatives">
                <div className="overline">FEASIBLE CANDIDATE ALTERNATIVES ({analysis.alternatives.length})</div>
                {analysis.alternatives.map((alt, idx) => {
                  const isCurrent = alt.id === rec.id;
                  return (
                    <div key={alt.id} className={`alt-candidate-card ${isCurrent ? "active-alt" : ""}`}>
                      <div className="alt-candidate-header">
                        <span className="alt-rank-badge">Alternative #{idx + 1}</span>
                        <button
                          type="button"
                          className="alt-select-btn"
                          onClick={() => {
                            const next = isCurrent ? null : alt;
                            setSelectedAltId(next ? next.id : null);
                            onSelectAlternative?.(next);
                          }}
                          disabled={decisionPending || !canAct}
                        >
                          {isCurrent ? "Deselect" : "Inspect Alternative"}
                        </button>
                      </div>
                      <div className="alt-timing-row">
                        {alt.changes.map((c) => `${c.phase_id}: ${c.green_s}s`).join(" · ")}
                      </div>
                    </div>
                  );
                })}
                {analysis.alternatives.length < 2 && (
                  <p className="fewer-alts-note">
                    Fewer alternatives: only {analysis.alternatives.length} candidate met configured bounds and safety constraints.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="rec-idle-state">
            <p>
              {liveFresh
                ? "No actionable recommendation is available. Check operating mode, freshness and service health."
                : "Awaiting active simulation. Start a scenario below to generate real-time recommendations."}
            </p>
          </div>
        )}

        {/* 4 Outcome Metrics Simulated Comparison */}
        {comparisonResult && (
          <div className="simulation-comparison-card" role="region" aria-label="Simulated Comparison Outcome">
            <div className="comparison-header">
              <div>
                <strong>SIMULATED ROLLOUT COMPARISON</strong>
                <p>Horizon: {comparisonResult.horizon_s}s · Seed: {comparisonResult.seed} · Initial: {comparisonResult.initial_time_s}s</p>
              </div>
              {onClearComparison && (
                <button className="icon-button close-button" onClick={onClearComparison} aria-label="Dismiss comparison">
                  ×
                </button>
              )}
            </div>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Baseline</th>
                  <th>Candidate</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Max Queue (veh)</td>
                  <td>{comparisonResult.baseline_max_queue_veh.toFixed(1)}</td>
                  <td>{comparisonResult.candidate_max_queue_veh.toFixed(1)}</td>
                  <td className={comparisonResult.candidate_max_queue_veh <= comparisonResult.baseline_max_queue_veh ? "improved" : "worse"}>
                    {(comparisonResult.candidate_max_queue_veh - comparisonResult.baseline_max_queue_veh).toFixed(1)}
                  </td>
                </tr>
                <tr>
                  <td>Average Delay (s)</td>
                  <td>{comparisonResult.baseline_avg_delay_s.toFixed(1)}</td>
                  <td>{comparisonResult.candidate_avg_delay_s.toFixed(1)}</td>
                  <td className={comparisonResult.candidate_avg_delay_s <= comparisonResult.baseline_avg_delay_s ? "improved" : "worse"}>
                    {(comparisonResult.candidate_avg_delay_s - comparisonResult.baseline_avg_delay_s).toFixed(1)}
                  </td>
                </tr>
                <tr>
                  <td>Spillback Duration (s)</td>
                  <td>{comparisonResult.baseline_spillback_s.toFixed(0)}</td>
                  <td>{comparisonResult.candidate_spillback_s.toFixed(0)}</td>
                  <td className={comparisonResult.candidate_spillback_s <= comparisonResult.baseline_spillback_s ? "improved" : "worse"}>
                    {(comparisonResult.candidate_spillback_s - comparisonResult.baseline_spillback_s).toFixed(0)}s
                  </td>
                </tr>
                <tr>
                  <td>Stops per Vehicle</td>
                  <td>{comparisonResult.baseline_stops_per_vehicle.toFixed(2)}</td>
                  <td>{comparisonResult.candidate_stops_per_vehicle.toFixed(2)}</td>
                  <td className={comparisonResult.candidate_stops_per_vehicle <= comparisonResult.baseline_stops_per_vehicle ? "improved" : "worse"}>
                    {(comparisonResult.candidate_stops_per_vehicle - comparisonResult.baseline_stops_per_vehicle).toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. NEXT PREDICTED ISSUE */}
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
          {prepareMutation.isPending ? "Starting aggregate flow…" : "Start simulation"}
          <ArrowRight size={15} />
        </Button>

        <Button
          variant="outline"
          onClick={() => {if(window.confirm("Reset this scenario to its seed? This creates a new run."))resetMutation.mutate()}}
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
            Simulation start acknowledged. Inspect the live run and seed below.
          </p>
        )}
      </section>
    </aside>
  );
}
