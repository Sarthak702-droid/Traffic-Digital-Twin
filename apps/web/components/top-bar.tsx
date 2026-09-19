"use client";

import { useEffect, useState, useRef } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  Clock,
  GitBranch,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace, type UserRole } from "@/lib/state";
import type { HealthState } from "../../../packages/contracts/typescript/events";

export function TopBar({
  health,
  manual,
  onToggleManual,
  isPendingManual,
  mode = manual ? "manual" : "recommend",
  onChangeMode,
}: {
  health?: HealthState;
  manual: boolean;
  onToggleManual: () => void;
  isPendingManual?: boolean;
  mode?: "recommend" | "observe" | "manual";
  onChangeMode?: (m: "recommend" | "observe" | "manual") => void;
}) {
  const { role, setRole, setDgpModalOpen } = useWorkspace();
  const [clock, setClock] = useState("00:00:00");
  const [healthOpen, setHealthOpen] = useState(false);
  const healthButton=useRef<HTMLButtonElement>(null);
  const healthDialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!healthOpen)return;const el=healthDialog.current;el?.querySelector<HTMLButtonElement>("button")?.focus();const keys=(e:KeyboardEvent)=>{if(e.key==="Escape"){setHealthOpen(false);healthButton.current?.focus()}if(e.key==="Tab"){const buttons=el?.querySelectorAll<HTMLButtonElement>("button");if(buttons?.length){e.preventDefault();buttons[0].focus()}}};window.addEventListener("keydown",keys);return()=>window.removeEventListener("keydown",keys)},[healthOpen]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const components = health?.components ?? [];
  const coreComponents = new Set(["api", "database", "simulation", "intelligence"]);
  const hasFailure = components.some(
    (c) => coreComponents.has(c.component) && c.status !== "normal",
  );
  const healthKnown=!!health?.timestamp && Date.now()-Date.parse(health.timestamp)<20000 && components.length>0;
  const healthStatusText = !healthKnown ? "Unknown" : hasFailure ? "Degraded" : "Normal";

  return (
    <header className="product-topbar" aria-label="Command center top bar">
      <div className="topbar-left">
        <div className="topbar-brand">
          <span className="logo small-logo">
            <GitBranch size={16} />
          </span>
          <span className="brand-text">
            TRAFFIC<strong>DIGITAL TWIN</strong>
          </span>
        </div>

        {/* Environment & Policy Chips */}
        <div className="topbar-chips" aria-label="Operating constraints">
          <span className="chip chip-mode" title="Operating mode">
            DEMONSTRATION MODE
          </span>
          <span className="chip chip-data" title="Traffic data source">
            SYNTHETIC DATA
          </span>
          <span className="chip chip-control" title="Signal actuation authority">
            NO LIVE SIGNAL CONTROL
          </span>
        </div>
      </div>

      <div className="topbar-right">
        {/* System Health Popover Button */}
        <div className="health-badge-wrapper">
          <button
            ref={healthButton} aria-expanded={healthOpen} aria-controls="health-details" className="topbar-health-btn"
            onClick={() => setHealthOpen(!healthOpen)}
            aria-label={`System health: ${healthStatusText}`}
            title="Inspect component health"
          >
            <span
              className={`status-dot ${!healthKnown || hasFailure ? "unknown" : "normal"}`}
            />
            <span className="health-label">System: {healthStatusText}</span>
          </button>

          {healthOpen && (
            <div ref={healthDialog} id="health-details" className="health-popover" role="dialog" aria-modal="true" aria-label="Component Health Status">
              <div className="popover-heading">
                <strong>Component Availability</strong>
                <button
                  className="icon-button close-button"
                  onClick={() => {setHealthOpen(false);healthButton.current?.focus()}}
                  aria-label="Close health details"
                >
                  ×
                </button>
              </div>
              <ul className="health-popover-list">
                <li className="health-observed-at">
                  Last checked {healthKnown ? new Date(health!.timestamp).toLocaleTimeString() : "—"}
                </li>
                {components.map((c) => (
                  <li key={c.component}>
                    <span
                      className={`status-dot ${c.status === "normal" ? "normal" : c.status === "simulated" ? "simulated" : "unknown"}`}
                    />
                    <div>
                      <strong>{c.component.replaceAll("_", " ")}</strong>
                      <p>{c.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Live Clock */}
        <div className="topbar-clock" aria-label="Local workstation time">
          <Clock size={13} />
          <span>{clock}</span>
        </div>

        {/* Three-Mode Segmented Control (Story S14 & PRD §22) */}
        <div className="mode-segmented-control" role="group" aria-label="Operational Mode Selection">
          <button
            type="button"
            className={`mode-segment-btn ${mode === "recommend" ? "active" : ""}`}
            onClick={() => (onChangeMode ? onChangeMode("recommend") : manual ? onToggleManual() : undefined)}
            disabled={isPendingManual}
            title="Recommend Mode: Digital twin forecasts + predictive coordinated recommendations"
          >
            <Sparkles size={12} />
            <span>Recommend</span>
          </button>
          <button
            type="button"
            className={`mode-segment-btn ${mode === "observe" ? "active" : ""}`}
            onClick={() => (onChangeMode ? onChangeMode("observe") : !manual ? onToggleManual() : undefined)}
            disabled={isPendingManual}
            title="Observe Mode: Stream forecasts without automated recommendations"
          >
            <Activity size={12} />
            <span>Observe</span>
          </button>
          <button
            type="button"
            className={`mode-segment-btn ${mode === "manual" ? "active manual-highlight" : ""}`}
            onClick={() => (onChangeMode ? onChangeMode("manual") : !manual ? onToggleManual() : undefined)}
            disabled={isPendingManual}
            title="Manual Mode: Recommendations stopped; manual movement timing locks honored"
          >
            <Radio size={12} />
            <span>Manual</span>
          </button>
        </div>

        {/* Manual Mode Toggle Button */}
        <button
          className={`mode-toggle-btn ${manual ? "manual-active" : "recommend-active"}`}
          onClick={onToggleManual}
          disabled={isPendingManual}
          title="Switch between autonomous recommendations and manual observation mode"
        >
          {manual ? (
            <>
              <Radio size={13} />
              <span>Manual / Observe</span>
            </>
          ) : (
            <>
              <Sparkles size={13} />
              <span>Autonomous Recs</span>
            </>
          )}
        </button>

        {/* Role Switcher */}
        <div className="role-switcher" aria-label="User role profile">
          <label htmlFor="user-role-select" className="sr-only">
            Active User Role
          </label>
          <User size={13} />
          <span id="user-role-select">{role} · authenticated role</span>
        </div>

        {/* START DGP DEMONSTRATION Button (PRD §5, §8.1) */}
        <Button
          variant="default"
          className="dgp-launch-button"
          onClick={() => setDgpModalOpen(true)}
          aria-label="Start DGP demonstration briefing"
        >
          <Sparkles size={15} />
          <span>START DGP DEMONSTRATION</span>
        </Button>
      </div>
    </header>
  );
}
