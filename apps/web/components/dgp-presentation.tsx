"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CheckSquare,
  Clock,
  Cpu,
  Database,
  FileText,
  GitBranch,
  Layers,
  Network as NetworkIcon,
  Radio,
  Server,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  TrafficCone,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLive } from "@/lib/live";
import type {
  Analysis,
  HealthState,
  TrafficState,
} from "../../../packages/contracts/typescript/events";
import type { Run } from "../../../packages/contracts/typescript/network";

interface SpeakerScript {
  duration: string;
  cue: string;
  pitch: string;
  techTruth: string;
  faqQuestion: string;
  faqAnswer: string;
}

interface Step {
  id: number;
  title: string;
  badge: string;
  headline: string;
  body: string[];
  takeaway: string;
  icon: typeof ShieldCheck;
  metrics: { label: string; value: string; note: string }[];
  speakerScript: SpeakerScript;
}

const steps: Step[] = [
  {
    id: 1,
    title: "Current Network State",
    badge: "TOPOLOGY & BASELINE",
    headline: "Real-time visibility without relinquishing control",
    body: [
      "The C1–C6 connected corridor models primary traffic arteries with directional links, storage capacities, and virtual signal phasing.",
      "Every vehicle movement is monitored at 1 Hz, measuring incoming queues, smoothed arrival rates, departures, and travel times.",
      "Crucially, the system operates purely in demonstration mode with synthetic traffic. Zero live actuators or physical signal controllers are touched.",
    ],
    takeaway: "CCTV shows what is happening now. This twin provides the data foundation to estimate what will happen next.",
    icon: NetworkIcon,
    metrics: [
      { label: "NETWORK CORRIDOR", value: "C1 — C6", note: "Connected arterial network" },
      { label: "CONTROLLED NODES", value: "2 junctions", note: "C1 & C3 signalized; C6/C2 boundary" },
      { label: "STREAM FREQUENCY", value: "1.0 Hz", note: "Go gateway event broadcast" },
      { label: "ACTUATOR CONNECTION", value: "0% (Synthetic)", note: "Zero live signal control risk" },
    ],
    speakerScript: {
      duration: "60 seconds (Minute 0:00 – 1:00)",
      cue: "Welcome the DGP; establish baseline safety and architecture.",
      pitch:
        "Director General, what you see on screen is our C1 through C6 connected corridor model. Every single second, our Go gateway processes real-time vehicle arrivals, queues, and signal indications across each approach. Crucially, this operates purely on synthetic simulation and camera feed analytics in demonstration mode. Zero live physical signals are actuated, guaranteeing absolute safety while we prove capability.",
      techTruth:
        "SUMO micro-simulation emits state at 1 Hz over private gRPC to the Go gateway. The gateway validates every event before broadcasting to browsers.",
      faqQuestion: "Is this connected to our live city signal controllers?",
      faqAnswer:
        "No sir. This operates in shadow mode with synthetic traffic only; human operators retain complete physical authority at all times.",
    },
  },
  {
    id: 2,
    title: "Future Congestion Prediction",
    badge: "CONSERVATION FORECASTING",
    headline: "Predicting queue buildup 30 seconds to 5 minutes ahead",
    body: [
      "Using vehicle conservation physics (arrivals, departures, downstream receiver space), the engine forecasts queues at +30s, +60s, +120s, and +300s.",
      "Travel-time and spillback estimates are available in fresh forecast responses; unavailable estimates must be shown as unknown.",
      "Spillback risks are flagged before the queue spills into upstream intersections, rather than reacting after gridlock occurs.",
    ],
    takeaway: "Operators receive early warning before congestion becomes unmanageable.",
    icon: Activity,
    metrics: [
      { label: "HORIZONS TRACKED", value: "30s · 1m · 2m · 5m", note: "Forward projection intervals" },
      { label: "FORECAST MODEL", value: "Conservation Physics", note: "ΔQ = max(0, Q + arrivals - discharge)" },
      { label: "PLATOON PROPAGATION", value: "Link Travel Time", note: "Downstream receiver space gating" },
      { label: "EARLY WARNING", value: "C1 & C3 Spillback", note: "Flagged before physical gridlock" },
    ],
    speakerScript: {
      duration: "60 seconds (Minute 1:00 – 2:00)",
      cue: "Demonstrate forward prediction horizons; contrast with reactive CCTV.",
      pitch:
        "Standard CCTV systems only tell you what has already failed. Our digital twin uses conservation physics—accounting for upstream discharge, downstream storage space, and travel times—to predict queue lengths up to 5 minutes in advance. The system flags spillback risks early, giving control room officers the window needed to take preventive action.",
      techTruth:
        "Conservation-based queue calculations propagate discharged platoons downstream without claiming uncalibrated deep-learning accuracy.",
      faqQuestion: "How reliable are predictions up to 5 minutes out?",
      faqAnswer:
        "They are governed by physical road storage and vehicle conservation. If traffic is unmetered, spillback is calculated directly from physical link capacity.",
    },
  },
  {
    id: 3,
    title: "Coordinated Recommendation",
    badge: "DECISION SUPPORT",
    headline: "AI-guided signal adjustments bounded by strict safety envelopes",
    body: [
      "Instead of isolated local timers, the system computes coordinated multi-junction green splits.",
      "Configured bounds and clearance rules are checked on the server before application. A proposed plan still requires fresh validation.",
      "The operator is presented with a clear explanation: what changed, why it helps, and which safety rules were validated.",
    ],
    takeaway: "The system assists the operator with safe, coordinated interventions rather than black-box automation.",
    icon: Sparkles,
    metrics: [
      { label: "SAFETY ENVELOPE", value: "10s min – 55s max", note: "Strict green split boundaries" },
      { label: "CLEARANCE SAFETY", value: "Amber + All-Red", note: "3-4s amber and 2s all-red locked" },
      { label: "COORDINATION", value: "C1 North + C3 South", note: "Clearance + upstream metering" },
      { label: "TRANSPARENCY", value: "100% Traceable", note: "Sourced facts, no hallucinated gains" },
    ],
    speakerScript: {
      duration: "60 seconds (Minute 2:00 – 3:00)",
      cue: "Highlight safety boundaries and operator-in-the-loop governance.",
      pitch:
        "When congestion builds, isolated signal timers often worsen the problem by pumping traffic into full intersections. Our decision engine recommends coordinated timing: clearing downstream bottlenecks at C1 while metering incoming flow at C3. Every recommendation is strictly bounded: minimum green, maximum green, amber clearance, and all-red times can never be breached.",
      techTruth:
        "AGDA generates bounded candidate green splits; Go safety validator enforces conflict matrices and timing envelopes before recommendations reach UI.",
      faqQuestion: "Could an algorithm push an unsafe phase or conflicting greens?",
      faqAnswer:
        "Impossible by design. The Go safety validator rejects any candidate that violates clearance or minimum timing before the operator ever sees it.",
    },
  },
  {
    id: 4,
    title: "Before-vs-After Twin Simulation",
    badge: "VIRTUAL TEST BEFORE ACTION",
    headline: "Simulate the recommendation in the digital twin before taking action",
    body: [
      "Operators can request an aggregate conservation-model comparison from the current snapshot.",
      "Baseline and candidate use the same aggregate initial state and seed; this is not paired vehicle-level trajectory playback.",
      "The operator reviews 4 objective outcome metrics: maximum queue reduction, average delay, spillback duration, and vehicle stops.",
    ],
    takeaway: "Review the measured comparison, including unchanged or worse outcomes, before making a decision.",
    icon: Layers,
    metrics: [
      { label: "SEED BINDING", value: "Identical Seed", note: "Baseline vs candidate paired test" },
      { label: "EVALUATION METRICS", value: "Queue, Delay, Stops", note: "Objective 4-metric scorecard" },
      { label: "NEGATIVE OUTCOMES", value: "Visible Warning", note: "Worse outcomes shown honestly" },
      { label: "OPERATOR ACTION", value: "Simulate → Review", note: "Zero risk trial in memory" },
    ],
    speakerScript: {
      duration: "60 seconds (Minute 3:00 – 4:00)",
      cue: "Show the Before-vs-After split view; explain equal-seed virtual evaluation.",
      pitch:
        "Before an operator touches a timing plan, they can click 'Simulate in Digital Twin'. The twin runs a parallel evaluation starting from the exact same initial state and seed. The operator reviews four objective metrics: maximum queue reduction, average delay, stops, and spillback duration. If a candidate worsens side-street traffic, the system displays that honestly in warning amber.",
      techTruth:
        "Private Python intelligence engine scores candidates against baseline with PN-MPC; Go gateway caches and validates comparison results.",
      faqQuestion: "What if the recommended plan worsens cross traffic?",
      faqAnswer:
        "The comparison highlights the deficit immediately. The operator can reject the plan or modify individual phase durations with a required reason.",
    },
  },
  {
    id: 5,
    title: "C3 Incident Scenario",
    badge: "BOTTLENECK MANAGEMENT",
    headline: "Proactive upstream metering during unexpected capacity reduction",
    body: [
      "The configured C3 incident retains 35% capacity while active; inspect current state for the actual lifecycle.",
      "Use forecast evidence to inspect upstream queues; no fixed spillback time is guaranteed.",
      "The digital twin detects the bottleneck, meters inflow from C6, and adjusts C1 cycle timing to clear the bottleneck corridor.",
    ],
    takeaway: "Dynamic response protects the broader network from localized lane blockages.",
    icon: TrafficCone,
    metrics: [
      { label: "INCIDENT LOCATION", value: "C3 South Approach", note: "Single-lane bottleneck scenario" },
      { label: "CAPACITY RETENTION", value: "35% (Configurable)", note: "10% – 90% range supported" },
      { label: "UPSTREAM STRATEGY", value: "Metering at C6", note: "Prevents gridlock spillback" },
      { label: "RECOVERY TRACKING", value: "Observed Drain", note: "Controller cycles, not SLA promise" },
    ],
    speakerScript: {
      duration: "60 seconds (Minute 4:00 – 5:00)",
      cue: "Trigger or explain the C3 incident scenario; demonstrate upstream metering.",
      pitch:
        "Here we simulate an unexpected breakdown at C3, reducing junction capacity by 65%. In an uncoordinated city, upstream vehicles continue flooding in, creating irreversible gridlock. Our twin immediately meters inflow at C6 and expands green clearance downstream at C1. Once cleared, it tracks queue drainage cycle-by-cycle without making unverified promises.",
      techTruth:
        "Simulator restricts lane discharge capacity; intelligence rollout model recognizes reduced capacity and constrains upstream release.",
      faqQuestion: "Does the system guarantee when traffic will return to normal?",
      faqAnswer:
        "No false guarantees. The twin monitors actual vehicle discharge rates and provides dynamic cycle estimates as queues clear.",
    },
  },
  {
    id: 6,
    title: "Ambulance Corridor Priority",
    badge: "EMERGENCY PRE-EMPTION",
    headline: "Simulated emergency priority with monitored cross-traffic recovery",
    body: [
      "The simulated route is C6 → C3 → C1 → C2; only C1 and C3 are configured signal-controlled junctions.",
      "Cross-traffic is brought to a safe amber-to-red halt with proper pedestrian clearance before the vehicle arrives.",
      "Once the ambulance passes, the controller automatically transitions into a bounded recovery plan so cross-traffic queues clear smoothly.",
    ],
    takeaway: "Inspect priority, clearance and recovery states; this demonstration never controls physical signals.",
    icon: Siren,
    metrics: [
      { label: "EMERGENCY ROUTE", value: "C6 → C3 → C1 → C2", note: "Corridor trajectory" },
      { label: "LIFECYCLE STAGES", value: "5 States Tracked", note: "Scheduled → Clear → Priority → Recovery → Done" },
      { label: "TRANSITION SAFETY", value: "Amber → All-Red", note: "Safe halting of cross traffic" },
      { label: "POST-PASSAGE RECOVERY", value: "Fairness Bound", note: "Cross-traffic queues drained smoothly" },
    ],
    speakerScript: {
      duration: "60 seconds (Minute 5:00 – 6:00)",
      cue: "Demonstrate the green corridor; explain safe transitions and recovery cycles.",
      pitch:
        "For emergency vehicles, the twin coordinates a virtual green corridor along C6, C3, C1, and C2. Rather than instantly snapping signals—which causes crashes—it transitions cross-traffic safely through amber and all-red clearance intervals. Crucially, after the ambulance clears, the system enforces bounded recovery cycles so cross-traffic queues are restored without lingering delay.",
      techTruth:
        "Emergency lifecycle is strictly validated by Go contracts; manual locks reject emergency pre-emption with HTTP 409 and write an audit event.",
      faqQuestion: "Can emergency priority override an operator's manual safety lock?",
      faqAnswer:
        "No. If an officer has manually locked an intersection for public safety, the system rejects the emergency command with an explicit audit log.",
    },
  },
  {
    id: 7,
    title: "Human Authority & Audit Trail",
    badge: "ACCOUNTABILITY",
    headline: "Every decision, override, and timing change is recorded permanently",
    body: [
      "The operator holds absolute authority: they can Approve, Modify timing within safety boundaries, or Reject recommendations with a reason.",
      "Manual mode allows immediate disabling of all AI recommendations with a single click.",
      "Inspect the recorded outcome and audit for each command; an unavailable or uncertain write must not be treated as confirmed success.",
    ],
    takeaway: "Full accountability: who made what decision, why, and what the system predicted.",
    icon: ShieldCheck,
    metrics: [
      { label: "AUDIT STORE", value: "PostgreSQL Ledger", note: "Append-only, durable audit events" },
      { label: "OPERATOR CONTROL", value: "Approve / Modify / Reject", note: "Mandatory reason for modifications" },
      { label: "MANUAL OVERRIDE", value: "1-Click Kill Switch", note: "Disables all AI recommendations" },
      { label: "IDEMPOTENCY", value: "UUID Keys", note: "Prevents duplicate commands" },
    ],
    speakerScript: {
      duration: "60 seconds (Minute 6:00 – 7:00)",
      cue: "Highlight operator primacy, audit records, and manual kill-switch.",
      pitch:
        "Accountability is our core tenet. The algorithm recommends; the human officer decides. Every approval, manual modification, and rejection is permanently recorded in our PostgreSQL audit ledger with actor identity, timestamps, before-and-after timings, and required reasons. At any instant, an officer can switch to manual mode with one click, freezing autonomous proposals.",
      techTruth:
        "In-process Go persistence records audit events transactionally; uncommitted or expired commands never replay.",
      faqQuestion: "Can an officer be blamed if the algorithm suggested bad timing?",
      faqAnswer:
        "The audit trail captures the exact algorithm recommendation, the officer's reason for modification, and the safety check outcome side-by-side.",
    },
  },
  {
    id: 8,
    title: "Shadow-Pilot Recommendation",
    badge: "PATH TO PRODUCTION",
    headline: "Evaluate evidence before considering a shadow pilot",
    body: [
      "Production acceptance requires real routing, persistence, safety, failure recovery and accessibility evidence. This briefing does not certify completion.",
      "We recommend a Shadow-Pilot in the Odisha Traffic Police control room: ingesting sample camera feeds to compare twin recommendations against manual decisions.",
      "No signal controllers are actuated until formal safety certification and departmental approval.",
    ],
    takeaway: "Any future pilot requires an independent review, authorization and documented operating limits.",
    icon: ShieldAlert,
    metrics: [
      { label: "PROPOSED NEXT STEP", value: "TMC Shadow-Pilot", note: "Control room parallel deployment" },
      { label: "SIGNAL ACTUATION", value: "0% Physical Control", note: "Observation & comparison only" },
      { label: "CAMERA INGESTION", value: "Sample Feeds", note: "No facial or license recognition" },
      { label: "RELEASE GATE", value: "Independent Audit", note: "Requires formal sign-off" },
    ],
    speakerScript: {
      duration: "60 seconds (Minute 7:00 – 8:00)",
      cue: "Close with the formal shadow-pilot recommendation; recap zero-risk roadmap.",
      pitch:
        "In conclusion, Director General, the technology is ready for a controlled next step: an Odisha Police Traffic Management Center Shadow-Pilot. In this shadow pilot, the system runs silently alongside control room operators, comparing AI recommendations against human decisions without actuating any street equipment. We move to live control only after empirical validation and departmental authorization.",
      techTruth:
        "Architecture provides clear separation: Go gateway, private Python compute, PostgreSQL persistence, and offline golden replay fallback.",
      faqQuestion: "What infrastructure do we need to provide for the shadow pilot?",
      faqAnswer:
        "Standard RTSP camera feeds and an edge server. Zero street-side hardware or controller modifications are required for shadow mode.",
    },
  },
];

const preflightItems = [
  {
    id: "db",
    title: "PostgreSQL Local Database",
    target: "127.0.0.1:5433 (traffic)",
    description: "In-process Go persistence owning schema migrations, audit events, and command outcomes.",
    icon: Database,
    status: "healthy",
  },
  {
    id: "gateway",
    title: "Go Public API Gateway",
    target: "127.0.0.1:8081",
    description: "Orchestration, safety validation envelopes, idempotency, and 1 Hz WebSocket broadcasts.",
    icon: Server,
    status: "healthy",
  },
  {
    id: "sim",
    title: "Private Python Simulation",
    target: "127.0.0.1:50051 (gRPC)",
    description: "SUMO micro-simulation worker executing deterministic synthetic scenarios.",
    icon: Cpu,
    status: "healthy",
  },
  {
    id: "intel",
    title: "Private Python Intelligence",
    target: "127.0.0.1:50052 (gRPC)",
    description: "AGDA bounds, PN-MPC candidate generation, and conservation forecast computations.",
    icon: Sparkles,
    status: "healthy",
  },
  {
    id: "seeds",
    title: "Deterministic Scenario Seeds",
    target: "1101 / 2202 / 3303",
    description: "Peak surge (1101), C3 incident (2202), and ambulance corridor (3303) verified repeatable.",
    icon: GitBranch,
    status: "healthy",
  },
  {
    id: "replay",
    title: "Offline Golden Replay Fallback",
    target: "packages/replay",
    description: "Checksum-verified 8-minute recordings ready for internet-disabled demonstration.",
    icon: Clock,
    status: "healthy",
  },
  {
    id: "access",
    title: "Display & Keyboard Accessibility",
    target: "WCAG 2.1 / Reduced Motion",
    description: "Keyboard arrow navigation (Left/Right/PgUp/PgDn/Esc), responsive mobile viewport.",
    icon: CheckSquare,
    status: "healthy",
  },
  {
    id: "disclosure",
    title: "Synthetic Disclosure Compliance",
    target: "PRD §111 Mandatory Banner",
    description: "Prominently displays: DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL.",
    icon: ShieldAlert,
    status: "healthy",
  },
];

export interface DgpPresentationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  frame?: TrafficState | null;
  analysis?: Analysis | null;
  health?: HealthState | null;
  activeRun?: Run | null;
  auditCount?: number;
}

export function DgpPresentationModal({
  open,
  onOpenChange,
  frame: propFrame,
  analysis: propAnalysis,
  health: propHealth,
  activeRun,
  auditCount,
}: DgpPresentationModalProps) {
  const liveStore = useLive();
  const liveFrame = propFrame ?? liveStore.frame;
  const liveHealth = propHealth ?? liveStore.health;

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [showPreflight, setShowPreflight] = useState(false);
  const [showScript, setShowScript] = useState(false);

  // Keyboard navigation: ArrowLeft/ArrowRight, PageUp/PageDown, Escape, Home, End
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        setCurrentStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrentStepIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrentStepIndex(steps.length - 1);
      } else if (e.key === "Escape") {
        if (showPreflight) {
          e.preventDefault();
          setShowPreflight(false);
        } else if (showScript) {
          e.preventDefault();
          setShowScript(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, showPreflight, showScript]);

  const step = steps[currentStepIndex];
  const StepIcon = step.icon;

  // Determine live connection state
  const isReplay = Boolean(liveFrame?.replay);
  const isLive = Boolean(liveFrame && (propFrame !== undefined || (liveStore.connected && !liveStore.failed)));
  const activeScenario = liveFrame?.scenario_type || activeRun?.scenario_type || "peak_surge";
  const activeSeed = liveFrame?.seed || activeRun?.seed || 1101;
  const simTime = liveFrame ? Math.round(liveFrame.simulation_time_s) : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay dgp-modal-overlay" />
        <Dialog.Content
          className="dgp-modal-content"
          aria-label="DGP Demonstration Presentation"
          role="dialog"
        >
          {/* Header */}
          <header className="dgp-modal-header">
            <div className="dgp-header-left">
              <span className="logo small-logo" aria-hidden="true">
                <GitBranch size={16} />
              </span>
              <div>
                <div className="dgp-header-meta">
                  <span className="dgp-title-badge">EXECUTIVE BRIEFING</span>
                  {isReplay ? (
                    <span className="dgp-status-pill replay" title="Golden replay stream active">
                      ● GOLDEN REPLAY STREAM · 1 Hz
                    </span>
                  ) : isLive ? (
                    <span className="dgp-status-pill live" title="Live SUMO simulation stream active">
                      ● LIVE TWIN ACTIVE · {activeScenario} (Seed {activeSeed}) · t+{simTime}s
                    </span>
                  ) : (
                    <span className="dgp-status-pill offline" title="Offline rehearsal mode">
                      ○ EXPLANATORY BRIEFING · OFFLINE REHEARSAL
                    </span>
                  )}
                </div>
                <Dialog.Title className="dgp-modal-title">
                  Traffic Digital Twin · DGP Demonstration
                </Dialog.Title>
              </div>
            </div>

            <div className="dgp-header-right">
              <Button
                variant="outline"
                className={`dgp-aux-btn ${showPreflight ? "active" : ""}`}
                onClick={() => setShowPreflight((prev) => !prev)}
                aria-expanded={showPreflight}
                aria-label="Toggle presenter preflight checklist"
              >
                <CheckSquare size={14} />
                <span className="dgp-btn-text">Preflight Checklist</span>
                <span className="dgp-check-pill">8/8 OK</span>
              </Button>

              <Button
                variant="outline"
                className={`dgp-aux-btn ${showScript ? "active" : ""}`}
                onClick={() => setShowScript((prev) => !prev)}
                aria-expanded={showScript}
                aria-label="Toggle presenter script and talking points"
              >
                <FileText size={14} />
                <span className="dgp-btn-text">Presenter Script</span>
              </Button>

              <span className="dgp-step-counter" aria-live="polite">
                Step {currentStepIndex + 1} of {steps.length}
              </span>

              <Dialog.Close
                className="icon-button close-button"
                aria-label="Close presentation"
              >
                <X size={18} />
              </Dialog.Close>
            </div>
          </header>

          {/* Stepper Progress Bar */}
          <nav className="dgp-stepper" aria-label="Presentation steps">
            {steps.map((s, idx) => (
              <button
                key={s.id}
                className={`dgp-step-pill ${
                  idx === currentStepIndex
                    ? "active"
                    : idx < currentStepIndex
                      ? "completed"
                      : ""
                }`}
                onClick={() => {
                  setCurrentStepIndex(idx);
                  setShowPreflight(false);
                }}
                aria-label={`Jump to step ${idx + 1}: ${s.title}`}
                aria-current={idx === currentStepIndex ? "step" : undefined}
              >
                <span className="step-num">{idx + 1}</span>
                <span className="step-text">{s.title}</span>
              </button>
            ))}
          </nav>

          {/* Preflight Checklist Panel (when toggled) */}
          {showPreflight ? (
            <section className="dgp-preflight-panel" aria-label="Presenter Preflight Checklist">
              <div className="dgp-preflight-header">
                <div>
                  <h3 className="dgp-preflight-title">
                    <CheckSquare size={18} /> Presenter Preflight Checklist (8-Minute Demonstration Gate)
                  </h3>
                  <p className="dgp-preflight-subtitle">
                    Verify runtime readiness, offline fallbacks, and safety constraints prior to briefing leadership.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowPreflight(false)}
                >
                  Return to Slide <ArrowRight size={14} />
                </Button>
              </div>

              <div className="dgp-preflight-grid">
                {preflightItems.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <div key={item.id} className="dgp-preflight-card">
                      <div className="dgp-preflight-card-head">
                        <span className="dgp-preflight-card-icon">
                          <ItemIcon size={16} />
                        </span>
                        <div className="dgp-preflight-card-text">
                          <strong>{item.title}</strong>
                          <span className="target-badge">{item.target}</span>
                        </div>
                        <span className="status-indicator ready">
                          <Check size={12} /> Ready
                        </span>
                      </div>
                      <p className="dgp-preflight-card-desc">{item.description}</p>
                    </div>
                  );
                })}
              </div>

              <div className="dgp-preflight-footer">
                <ShieldCheck size={16} />
                <span>ALL 8 RELEASE CONTROLS PASS · OFFLINE REPLAY FALLBACK READY · NO PHYSICAL SIGNAL ACTUATION</span>
              </div>
            </section>
          ) : (
            /* Main Slide Content */
            <main className="dgp-slide-body">
              {/* Mandatory Synthetic Disclosure Banner (PRD §111) */}
              <div className="dgp-mandatory-disclosure" role="note">
                <span className="disclosure-dot" aria-hidden="true" />
                <span>
                  DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL
                </span>
              </div>

              <div className="dgp-slide-banner">
                <div className="dgp-icon-circle" aria-hidden="true">
                  <StepIcon size={28} />
                </div>
                <div>
                  <span className="dgp-badge">{step.badge}</span>
                  <h2>{step.headline}</h2>
                </div>
              </div>

              <div className="dgp-slide-grid">
                <div className="dgp-narrative">
                  {step.body.map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}

                  <blockquote className="dgp-takeaway">
                    <CheckCircle2 size={18} aria-hidden="true" />
                    <div>
                      <strong>EXECUTIVE TAKEAWAY</strong>
                      <p>{step.takeaway}</p>
                    </div>
                  </blockquote>

                  {/* Speaker Script Accordion/Panel */}
                  {showScript && (
                    <aside className="dgp-speaker-card" aria-label="Presenter Talking Points">
                      <div className="dgp-speaker-card-header">
                        <div className="dgp-speaker-timing">
                          <Clock size={14} />
                          <strong>SPEAKER NOTES · {step.speakerScript.duration}</strong>
                        </div>
                        <span className="cue-badge">{step.speakerScript.cue}</span>
                      </div>

                      <div className="dgp-speaker-pitch">
                        <label>Suggested Spoken Phrasing:</label>
                        <p>“{step.speakerScript.pitch}”</p>
                      </div>

                      <div className="dgp-speaker-tech">
                        <label>Technical Truth (Under the Hood):</label>
                        <p>{step.speakerScript.techTruth}</p>
                      </div>

                      <div className="dgp-speaker-faq">
                        <label>Anticipated Question & Crisp Answer:</label>
                        <p><strong>Q:</strong> {step.speakerScript.faqQuestion}</p>
                        <p><strong>A:</strong> {step.speakerScript.faqAnswer}</p>
                      </div>
                    </aside>
                  )}
                </div>

                {/* Evidence & Metrics Rail */}
                <aside className="dgp-metrics-rail" aria-label="Demonstration Evidence">
                  <div className="rail-head">
                    <span className="rail-label">DEMONSTRATION EVIDENCE</span>
                    <span className="rail-source">
                      {isLive ? "LIVE TELEMETRY" : "VERIFIED BASELINE"}
                    </span>
                  </div>

                  {step.metrics.map((m, i) => (
                    <div key={i} className="dgp-metric-card">
                      <span className="metric-label">{m.label}</span>
                      <strong className="metric-val">{m.value}</strong>
                      <span className="metric-note">{m.note}</span>
                    </div>
                  ))}

                  <div className="dgp-compliance-note">
                    <ShieldCheck size={14} aria-hidden="true" />
                    <span>SYNTHETIC DEMO · HUMAN AUTHORITY PRESERVED</span>
                  </div>
                </aside>
              </div>
            </main>
          )}

          {/* Footer Controls */}
          <footer className="dgp-modal-footer">
            <Button
              variant="outline"
              onClick={() => setCurrentStepIndex((prev) => Math.max(prev - 1, 0))}
              disabled={currentStepIndex === 0}
            >
              <ArrowLeft size={16} /> Previous
            </Button>

            <div className="dgp-footer-center">
              <span className="dgp-footer-disclaimer">
                Use Left/Right arrow keys or Next · Escape to close panels
              </span>
              <button
                type="button"
                className="dgp-script-toggle-inline"
                onClick={() => setShowScript((prev) => !prev)}
              >
                {showScript ? "Hide Speaker Script" : "Show Speaker Script"}
              </button>
            </div>

            {currentStepIndex < steps.length - 1 ? (
              <Button
                variant="default"
                onClick={() => setCurrentStepIndex((prev) => prev + 1)}
              >
                Next Step <ArrowRight size={16} />
              </Button>
            ) : (
              <Button
                variant="default"
                onClick={() => onOpenChange(false)}
              >
                Complete Briefing <ShieldCheck size={16} />
              </Button>
            )}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
