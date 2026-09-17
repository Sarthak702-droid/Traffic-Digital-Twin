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
          <main className="dgp-slide-body"><p role="note">Explanatory briefing · not live operational evidence. DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL</p>
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
