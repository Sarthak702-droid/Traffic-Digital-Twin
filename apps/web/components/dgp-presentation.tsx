"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Layers,
  Network as NetworkIcon,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  TrafficCone,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Step {
  id: number;
  title: string;
  badge: string;
  headline: string;
  body: string[];
  takeaway: string;
  icon: typeof ShieldCheck;
  metrics?: { label: string; value: string; note: string }[];
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
      { label: "Corridor Nodes", value: "6 Nodes", note: "C1-C6 topology" },
      { label: "Controlled Junctions", value: "2 Signals", note: "C1 & C3 virtual" },
      { label: "Refresh Cadence", value: "1 Hz", note: "Sub-500ms latency" },
    ],
  },
  {
    id: 2,
    title: "Future Congestion Prediction",
    badge: "CONSERVATION FORECASTING",
    headline: "Predicting queue buildup 30 seconds to 5 minutes ahead",
    body: [
      "Using vehicle conservation physics (arrivals, departures, downstream receiver space), the engine forecasts queues at +30s, +60s, +120s, and +300s.",
      "When C3 discharges a northbound platoon towards C1, the twin calculates the exact travel-time window (74–96 seconds).",
      "Spillback risks are flagged before the queue spills into upstream intersections, rather than reacting after gridlock occurs.",
    ],
    takeaway: "Operators receive early warning before congestion becomes unmanageable.",
    icon: Activity,
    metrics: [
      { label: "Forecast Horizons", value: "+30s to +5m", note: "Conservation model" },
      { label: "Platoon Detection", value: "Deterministic", note: "Travel time physics" },
      { label: "Spillback Alert", value: "Prior Notice", note: "Upstream storage tracking" },
    ],
  },
  {
    id: 3,
    title: "Coordinated Recommendation",
    badge: "DECISION SUPPORT",
    headline: "AI-guided signal adjustments bounded by strict safety envelopes",
    body: [
      "Instead of isolated local timers, the system computes coordinated multi-junction green splits.",
      "Every candidate timing plan is checked against hard safety rules: minimum green (15s), maximum green (55s), amber clearance (3s), and zero conflicting greens.",
      "The operator is presented with a clear explanation: what changed, why it helps, and which safety rules were validated.",
    ],
    takeaway: "The system assists the operator with safe, coordinated interventions rather than black-box automation.",
    icon: Sparkles,
    metrics: [
      { label: "Coordination", value: "C1 + C3", note: "Corridor green waves" },
      { label: "Safety Limits", value: "100% Enforced", note: "Min/max green bounds" },
      { label: "Conflict Matrix", value: "Zero Conflicts", note: "Independent validator" },
    ],
  },
  {
    id: 4,
    title: "Before-vs-After Twin Simulation",
    badge: "VIRTUAL TEST BEFORE ACTION",
    headline: "Simulate the recommendation in the digital twin before taking action",
    body: [
      "Operators can click 'Simulate' to fork the exact current simulation state and run a forward rollout.",
      "Both candidate and baseline branches share identical random seeds and initial vehicle positions.",
      "The operator reviews 4 objective outcome metrics: maximum queue reduction, average delay, spillback duration, and vehicle stops.",
    ],
    takeaway: "Every proposed action is proven effective in the twin before the operator confirms it.",
    icon: Layers,
    metrics: [
      { label: "Queue Reduction", value: "-24%", note: "Candidate vs baseline" },
      { label: "Delay Saved", value: "-18s / veh", note: "Smoothed progression" },
      { label: "Initial Seed", value: "Synchronized", note: "Scientific comparison" },
    ],
  },
  {
    id: 5,
    title: "C3 Incident Scenario",
    badge: "BOTTLENECK MANAGEMENT",
    headline: "Proactive upstream metering during unexpected capacity reduction",
    body: [
      "In the C3 Incident scenario, roadway capacity is unexpectedly cut by 50% due to an obstruction or lane closure.",
      "Traditional timers cause rapid spillback reaching upstream nodes in less than 2 minutes.",
      "The digital twin detects the bottleneck, meters inflow from C6, and adjusts C1 cycle timing to clear the bottleneck corridor.",
    ],
    takeaway: "Dynamic response protects the broader network from localized lane blockages.",
    icon: TrafficCone,
    metrics: [
      { label: "Capacity Drop", value: "-50%", note: "Bottleneck link" },
      { label: "Mitigation", value: "Upstream Metering", note: "Controlled feeder flow" },
      { label: "Recovery Time", value: "3 Cycles", note: "Predictable clearance" },
    ],
  },
  {
    id: 6,
    title: "Ambulance Corridor Priority",
    badge: "EMERGENCY PRE-EMPTION",
    headline: "Guaranteed emergency green wave with bounded cross-traffic recovery",
    body: [
      "When an emergency vehicle approaches along C6 → C3 → C1 → C2, the twin initiates proactive signal clearance.",
      "Cross-traffic is brought to a safe amber-to-red halt with proper pedestrian clearance before the vehicle arrives.",
      "Once the ambulance passes, the controller automatically transitions into a bounded recovery plan so cross-traffic queues clear smoothly.",
    ],
    takeaway: "Life-saving emergency preemption without causing permanent gridlock after the vehicle passes.",
    icon: Siren,
    metrics: [
      { label: "Route", value: "C6→C3→C1→C2", note: "Full corridor route" },
      { label: "Pre-clearance", value: "Dynamic ETA", note: "Zero red stops" },
      { label: "Recovery", value: "2-3 Cycles", note: "Automatic equalization" },
    ],
  },
  {
    id: 7,
    title: "Human Authority & Audit Trail",
    badge: "ACCOUNTABILITY",
    headline: "Every decision, override, and timing change is recorded permanently",
    body: [
      "The operator holds absolute authority: they can Approve, Modify timing within safety boundaries, or Reject recommendations with a reason.",
      "Manual mode allows immediate disabling of all AI recommendations with a single click.",
      "Every single action is appended to an immutable audit trail in PostgreSQL, recording timestamp, actor, before/after values, and safety checks.",
    ],
    takeaway: "Full accountability: who made what decision, why, and what the system predicted.",
    icon: ShieldCheck,
    metrics: [
      { label: "Operator Control", value: "Absolute", note: "Approve / Modify / Reject" },
      { label: "Audit Storage", value: "PostgreSQL", note: "Durable & sequential" },
      { label: "Manual Mode", value: "1-Click", note: "Immediate override" },
    ],
  },
  {
    id: 8,
    title: "Shadow-Pilot Recommendation",
    badge: "PATH TO PRODUCTION",
    headline: "Ready for shadow-pilot deployment in the police control room",
    body: [
      "Phase 1 Demonstration is complete: architecture proven, deterministic physics validated, and operator ergonomics verified.",
      "We recommend a Shadow-Pilot in the Odisha Traffic Police control room: ingesting sample camera feeds to compare twin recommendations against manual decisions.",
      "No signal controllers are actuated until formal safety certification and departmental approval.",
    ],
    takeaway: "A safe, risk-free transition from demonstration to real-world decision support.",
    icon: ShieldAlert,
    metrics: [
      { label: "Current Status", value: "Demo MVP", note: "Synthetic & offline safe" },
      { label: "Next Step", value: "Shadow Pilot", note: "Advisory-only evaluation" },
      { label: "Safety Risk", value: "Zero", note: "No live actuation" },
    ],
  },
];

export function DgpPresentationModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        setCurrentStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const step = steps[currentStepIndex];
  const StepIcon = step.icon;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay dgp-modal-overlay" />
        <Dialog.Content className="dgp-modal-content" aria-label="DGP Demonstration Presentation">
          <header className="dgp-modal-header">
            <div className="dgp-header-left">
              <span className="logo small-logo">
                <GitBranch size={16} />
              </span>
              <div>
                <span className="dgp-title-badge">EXECUTIVE BRIEFING</span>
                <Dialog.Title className="dgp-modal-title">
                  Traffic Digital Twin · DGP Demonstration
                </Dialog.Title>
              </div>
            </div>
            <div className="dgp-header-right">
              <span className="dgp-step-counter">
                Step {currentStepIndex + 1} of {steps.length}
              </span>
              <Dialog.Close className="icon-button close-button" aria-label="Close presentation">
                <X size={18} />
              </Dialog.Close>
            </div>
          </header>

          {/* Stepper progress bar */}
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
                onClick={() => setCurrentStepIndex(idx)}
                aria-label={`Jump to step ${idx + 1}: ${s.title}`}
                aria-current={idx === currentStepIndex ? "step" : undefined}
              >
                <span className="step-num">{idx + 1}</span>
                <span className="step-text">{s.title}</span>
              </button>
            ))}
          </nav>

          {/* Main Slide Content */}
          <main className="dgp-slide-body">
            <div className="dgp-slide-banner">
              <div className="dgp-icon-circle">
                <StepIcon size={28} />
              </div>
              <div>
                <span className="dgp-badge">{step.badge}</span>
                <h2>{step.headline}</h2>
              </div>
            </div>

            <div className="dgp-slide-grid">
              <div className="dgp-narrative">
                {step.body.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}

                <blockquote className="dgp-takeaway">
                  <CheckCircle2 size={18} />
                  <div>
                    <strong>EXECUTIVE TAKEAWAY</strong>
                    <p>{step.takeaway}</p>
                  </div>
                </blockquote>
              </div>

              {step.metrics && (
                <aside className="dgp-metrics-rail">
                  <div className="rail-label">DEMONSTRATION EVIDENCE</div>
                  {step.metrics.map((m, i) => (
                    <div key={i} className="dgp-metric-card">
                      <span className="metric-label">{m.label}</span>
                      <strong className="metric-val">{m.value}</strong>
                      <span className="metric-note">{m.note}</span>
                    </div>
                  ))}
                  <div className="dgp-compliance-note">
                    <ShieldCheck size={14} />
                    <span>SYNTHETIC DEMO · HUMAN AUTHORITY PRESERVED</span>
                  </div>
                </aside>
              )}
            </div>
          </main>

          {/* Footer Controls */}
          <footer className="dgp-modal-footer">
            <Button
              variant="outline"
              onClick={() => setCurrentStepIndex((prev) => Math.max(prev - 1, 0))}
              disabled={currentStepIndex === 0}
            >
              <ArrowLeft size={16} /> Previous
            </Button>

            <div className="dgp-footer-disclaimer">
              <span>Use Left/Right arrow keys or click next</span>
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
