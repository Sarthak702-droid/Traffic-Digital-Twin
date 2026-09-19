> **Architecture alignment notice — 2026-09-18:** This historical UI evidence is now governed by the supplied Go-control-plane and private-Python-compute specifications. It does not authorize a Python public gateway or separate DB writer.

# Epic 3 Delivery Status: Command Center & Junction Intelligence

**Epic ID:** `E03`  
**Stories:** `S08`, `S09`, `S10`  
**Status:** `Completed`  
**Date:** September 17, 2026  
**Author:** Principal Frontend Engineer & Control-Room UI/UX Architect  
**Branch:** `epic3`  

---

## Executive Summary

Epic 3 delivers the production-grade **Command Center & Junction Intelligence** interface for the Predictive Traffic Digital Twin. Designed specifically to control-room standards (PRD §§5–8.4), the interface maintains a calm, dark neutral theme (`#070B14`, `#0E1524`, `#1D2A3B`) with restrained status semantics, ensuring operators, supervisors, and executive leadership (DGP) can understand real-time traffic conditions, predict congestion up to 5 minutes in advance, and review multi-junction signal recommendations without dense walls of confusing charts.

Every visual element and metric is strictly data-driven from configuration, preserving strict human-in-the-loop authority and highlighting the non-negotiable operational disclosure:
> **DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL**

---

## Story-by-Story Verification Evidence

### 1. Story S08: Build the product shell and disclosure (`P0`)

- **User Story:** *As an executive viewer, I want a calm and honest operational interface, so that demo outputs cannot be mistaken for live control.*
- **Acceptance Criteria Verification:**
  1. **Primary Navigation Restricted to Exactly 6 Items:**
     - `Command Center` (`command`)
     - `Network` (`network`)
     - `Vision Analytics` (`vision`)
     - `Incidents` (`incidents`)
     - `Emergency` (`emergency`)
     - `Audit & Health` (`audit`)
     - Junction intelligence and recommendation details open in a modal drawer from Command Center / Network without polluting navigation (PRD §5).
  2. **Mandatory Operating Policy Disclosure:**
     - Prominently displayed across all views: `DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL`.
     - Top bar chips for operating mode (`DEMONSTRATION MODE`), data source (`SYNTHETIC DATA`), and signal actuation authority (`NO LIVE SIGNAL CONTROL`).
  3. **Visual Design System & Multi-Role Adaptation:**
     - Dark control-room theme with Geist/Inter typography and 12-column grid.
     - Accessible role switcher supporting:
       - **Operator**: Hands-on controls (simulate, approve, modify timing within safety bounds, reject, start/reset).
       - **Supervisor**: Oversight banner with verified safety bounds (min green 15s, max green 55s, yellow/all-red clearance, conflict matrix).
       - **Executive Viewer (DGP)**: High-level outcome narrative, human authority guarantee, and direct launcher for the 8-step guided briefing.
  4. **Guided 8-Step DGP Demonstration Presentation Mode:**
     - High-visibility top bar button: `START DGP DEMONSTRATION`.
     - Interactive modal dialog walking senior stakeholders through:
       1. *Current Network State* (C1–C6 connected corridor)
       2. *Future Congestion Prediction* (Conservation forward horizons)
       3. *Coordinated Recommendation* (Multi-junction green-split optimization)
       4. *Before-vs-After Twin Simulation* (Synchronized seed comparison)
       5. *C3 Incident Scenario* (Upstream feeder metering)
       6. *Ambulance Corridor Priority* (Pre-cleared green wave and bounded recovery)
       7. *Human Authority & Audit Trail* (PostgreSQL sequential logging)
       8. *Shadow-Pilot Recommendation* (Risk-free advisory evaluation for Odisha Police)

---

### 2. Story S09: Render the data-driven animated twin (`P0`)

- **User Story:** *As an operator, I want moving traffic and signal state on C1–C6, so that I can see how connected traffic evolves.*
- **Acceptance Criteria Verification:**
  1. **Dynamic Configuration Loading (Never Hardcoded):**
     - Loads network topology from `packages/scenario-config/c1-c6.json` through the Go API (`/config/network`).
     - SVG canvas coordinates, directional links, storage capacities, and movement maps are entirely data-driven.
  2. **Real-time Overlays & Smooth 1 Hz Vehicle Animation:**
     - **Direction:** Clear roadway centerlines and flow direction arrow markers.
     - **Queue Overlays:** Visual queue accumulation lines along incoming stop-lines with queue badges (`Q: 8 veh`), dynamically color-coded (green <5 veh, amber 5–15 veh, red >15 veh).
     - **Speed Overlays:** Link speed badges (e.g. `24.5 km/h`), colored based on congestion relative to free-flow.
     - **Signal Overlays:** Signal indicator heads at controlled junctions (C1, C3) displaying indication colors (`green`, `amber`, `red`) and countdown countdown pill (e.g. `14s remaining`).
     - **Smooth Particle Motion:** Scaled velocity particles traversing links proportional to measured average speed.
  3. **Exactly Five Summary KPIs (PRD §8.1):**
     - `Vehicles in modeled network` (`veh`)
     - `Avg speed` (`km/h`)
     - `Avg queue` (`veh / approach`)
     - `Critical nodes` (congested junction count)
     - `Predicted spillback ETA` (earliest forward spillback countdown)
  4. **Command Center Action Rail (4-Column Rail):**
     - **Highest-Priority Alert**: Real-time detection of critical conditions (Spillback risk, C3 incident capacity cut, ambulance corridor, or nominal flow).
     - **Current Recommendation Card**: Priority, target phase adjustments, safety verification chip, and 1-click `Simulate`, `Approve in Twin`, `Modify`, or `Reject`.
     - **Next Predicted Issue**: Forward countdown to next projected congestion event.
     - **Scenario Launcher**: Seed input, scenario selector, Start and Reset triggers.

---

### 3. Story S10: Inspect junction state and future horizons (`P0`)

- **User Story:** *As an operator, I want a junction drawer and forecast selector, so that I can trace a predicted risk to its cause.*
- **Acceptance Criteria Verification:**
  1. **Junction Intelligence Drawer (`Sheet`):**
     - Click or keyboard-inspect (`Enter`/`Space`) C1 or C3 to open detailed side drawer.
     - Inspect approach queues (`queue_veh`), arrivals (`arrival_rate_vpm`), departures (`departure_rate_vpm`), speed (`avg_speed_kph`), occupancy ratio (`occupancy_ratio` %), downstream receiving storage (`downstream_capacity_veh`), signal phase, and countdown remaining time (`remaining_s`).
  2. **Five Forward Horizons (`NOW`, `+30s`, `+1m`, `+2m`, `+5m`):**
     - Tabbed selector switching between current measured state and predictive horizons.
     - Subtitle badges clearly distinguishing `simulation forecast` from `5-minute output advisory` (for +5m).
     - Explicit disclaimer: `Deterministic conservation forecast · No invented confidence bands`.
  3. **Deterministic Plain-Language Cause Analysis:**
     - Traces upstream causes (e.g. *"C3 is expected to discharge a northbound platoon towards C1. Based on current travel time (74–96s), C1 storage is forecast to exceed 80%"*).
     - Explicit spillback ETA alert box (`Spillback ETA: 82 seconds if unmitigated`).
  4. **Recommendation Impact & Safety Checklist:**
     - Shows proposed phase adjustments for the selected junction.
     - Quantified expected impact (e.g. `Queue reduction: ~24% projected`).
     - Safety checklist verifying:
       - `✓ Min green (15s) guaranteed`
       - `✓ Max green (55s) respected`
       - `✓ Clearance intervals preserved`
       - `✓ Zero conflicting greens`

---

### 4. Network Screen & Before-vs-After Split Comparison (PRD §8.4)

- **Full-width Digital Twin:** Expanded operational canvas with horizon slider (`NOW`, `+30s`, `+1m`, `+2m`, `+5m`).
- **Before-vs-After Split Screen:**
  - Synchronized initial state ($t_0$) and deterministic random seed.
  - Side-by-side comparison: **Baseline Fixed-Time Strategy** vs **Predictive Recommendation Plan**.
  - Exactly 4 objective simulated outcome metrics:
    1. **Maximum Queue** ($16.4 \to 11.2\text{ veh}$, $-28\%$)
    2. **Average Modeled Delay** ($34.8 \to 21.6\text{ s}$, $-38\%$)
    3. **Spillback Occurrence** ($48 \to 0\text{ s}$, $100\%$ eliminated)
    4. **Modeled Stops / Vehicle** ($1.45 \to 0.88\text{ stops/veh}$, $-39\%$)
  - All values explicitly labeled as simulated estimates.

---

## Test Verification Output

### Vitest Unit & Component Suite
```
 RUN  v5.0.1 apps/web
 ✓ components/network.test.tsx (3 tests)
 ✓ lib/live.test.tsx (2 tests)
 ✓ components/live-panel.test.tsx (8 tests)
 ✓ components/epic3.test.tsx (8 tests)

 Test Files  4 passed (4)
      Tests  21 passed (21)
```

### Playwright End-to-End Verification (`scripts/verify-epic3.mjs`)
```
Starting Next.js test server on port 3105...
Ready in 241ms
Navigating to Command Center...
Verifying S08 Product Shell & Disclosure...
Verifying Role Switcher (Operator, Supervisor, Executive)...
Verifying Guided 8-Step DGP Presentation Modal...
Verifying 5 Summary KPIs Strip...
Verifying Action Rail cards...
Verifying S10 Junction Intelligence Drawer & Forward Horizons...
Verifying Network Screen Before-vs-After Comparison...
Capturing desktop and mobile screenshot evidence...
===============================================================
PASS verify-epic3: All S08, S09, S10, and PRD §8 requirements verified cleanly!
Screenshots: test-results/epic3-desktop.png, test-results/epic3-mobile.png
===============================================================
```

### Visual Evidence Artifacts
- Desktop Command Center & Twin: `test-results/epic3-desktop.png`
- Mobile Responsive Shell: `test-results/epic3-mobile.png`
