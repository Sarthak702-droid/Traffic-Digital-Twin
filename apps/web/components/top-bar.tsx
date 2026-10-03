"use client";

import { useEffect, useState, useRef } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  Clock,
  Gauge,
  LogOut,
  Radio,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
} from "lucide-react";
import {ProductBrand} from "@/components/product-brand";
import { Button } from "@/components/ui/button";
import {inputDisclosure} from "@/lib/input-disclosure";
import type { TrafficState, HealthState } from "../../../packages/contracts/typescript/events";
import { type Session, useLogout } from "./session-panel";

export function TopBar({
  identity,
  health,
  frame,
  manual,
  onToggleManual,
  isPendingManual,
  mode = manual ? "manual" : "recommend",
  onChangeMode,
}: {
  identity?: Session;
  health?: HealthState;
  frame?: TrafficState | null;
  manual: boolean;
  onToggleManual: () => void;
  isPendingManual?: boolean;
  mode?: "recommend" | "observe" | "manual";
  onChangeMode?: (m: "recommend" | "observe" | "manual") => void;
}) {
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
    (c) => coreComponents.has(c.component) && c.status !== "normal" && !c.message.startsWith("No scenario has been started") && !c.message.startsWith("Waiting for an active scenario"),
  );
  const healthKnown=!!health?.timestamp && Date.now()-Date.parse(health.timestamp)<20000 && components.length>0;
  const hasActiveRun = components.find((c) => c.component === "simulation")?.status === "normal";
  const healthStatusText = !healthKnown ? "Unknown" : hasFailure ? "Degraded" : !hasActiveRun ? "Ready to start" : "Normal";

  const logout = useLogout();

  return (
    <header className="product-topbar" aria-label="Command center top bar">
      <div className="topbar-left">
        <div className="topbar-brand">
          <ProductBrand compact />
        </div>

        {/* Environment & Policy Chips */}
        <div className="topbar-chips" aria-label="Operating constraints">
          <span className="chip chip-mode" title="Operating mode">
            DEMONSTRATION MODE
          </span>
          <span className="chip chip-data" title="Traffic data source">
            {inputDisclosure(frame)}
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
                      <strong>{({ simulation: "network model", intelligence: "flow prediction", cctv: "ITD video analytics", signal_controller: "physical signal controller" } as Record<string, string>)[c.component] || c.component.replaceAll("_", " ")}</strong>
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
            <Gauge size={12} />
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
              <SlidersHorizontal size={13} />
              <span>Coordinated Plan</span>
            </>
          )}
        </button>

        {/* Authenticated User Session Profile Widget */}
        {identity ? (
          <div className="topbar-user-profile" aria-label="Authenticated session profile">
            <div className="user-avatar" aria-hidden="true">
              <User size={13} className="user-avatar-icon" />
            </div>
            <div className="user-info">
              <div className="user-primary-row">
                <span className="user-actor">{identity.actor}</span>
                <span className={`role-badge role-${identity.role}`}>
                  <span id="user-role-select">{identity.role} · authenticated role</span>
                </span>
              </div>
              <span className="session-auth-text">Authenticated session</span>
            </div>
            <Button
              variant="outline"
              type="button"
              className="topbar-signout-btn"
              onClick={() => logout.mutate()}
              loading={logout.isPending}
              aria-label="Sign out"
            >
              <LogOut size={12} className="signout-icon" aria-hidden="true" />
              <span>Sign out</span>
            </Button>
            {logout.error && (
              <span role="alert" className="logout-error-tag">Sign-out failed</span>
            )}
          </div>
        ) : (
          <div className="topbar-user-profile signed-out" aria-label="User role profile">
            <User size={13} />
            <span id="user-role-select" className="signed-out-label">Signed out</span>
          </div>
        )}
      </div>
    </header>
  );
}
