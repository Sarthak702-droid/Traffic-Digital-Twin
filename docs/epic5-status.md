# Epic 5 Delivery Status: Safety Envelope & Human Authority

**Epic ID:** `E05`  
**Owner:** Backend + Frontend  
**Status:** Completed  
**Branch:** `epic5`  
**Target Completion:** Day 9  
**PRD References:** §§8.3, 18.3, 22–23; `AGENT.MD`: Safety validator, Recommendation actions  

---

## 1. Executive Summary

Epic 5 establishes the deterministic safety validation envelope and strict human-in-the-loop authority for the Traffic Digital Twin. Under the system's core governance principle, **the machine recommends, the human decides**: no automated candidate plan or operator adjustment may be applied to the digital twin simulation without passing strict multi-rule safety validation in Go. 

Furthermore, per PRD §8.3, **no physical signal actuation endpoint exists anywhere in the codebase**—all applications and simulations are isolated to the digital twin environment. Every candidate action provides full operational agency (`SIMULATE`, `APPROVE IN DIGITAL TWIN`, `MODIFY`, `REJECT`), mandates structured justification reasons for modifications and rejections, and logs an immutable audit trail entry in PostgreSQL.

---

## 2. Story Implementation & Acceptance Verification

### Story S13: Validate every candidate and application [P0]
- **User Story:** *As a supervisor, I want central safety validation in Go, so that unsafe plans never reach the twin.*
- **Acceptance Criteria & Evidence:**
  1. **Comprehensive rule checking in Go:**
     - Implemented in `apps/api/internal/httpapi/decision.go` within `validateChanges`:
       - **Complete phase plan integrity**: Candidate plan must supply a timing entry for every controlled phase and match network topology.
       - **Bounded green times**: Minimum green enforced ($c.\text{GreenS} \ge p.\text{Min}$) and maximum green / excessive hold avoided ($c.\text{GreenS} \le p.\text{Max}$).
       - **Conflict matrix satisfied**: Rejects conflicting concurrent greens using network topology conflict definitions (`n.Conflicts`).
       - **Clearance clearance satisfied**: Amber ($p.\text{Amber} > 0$) and all-red clearance intervals ($p.\text{AllRed} > 0$) strictly validated.
       - **Modeled pedestrian and cross-road wait violations**: Guarantees pedestrian phase green times ($plan[p.\text{ID}] \ge p.\text{Pedestrian}$) and limits cross-road waiting times below maximum red limits ($\text{cycle} - plan[p.\text{ID}] \le p.\text{MaxRed}$).
       - **Downstream receiving capacity and bottleneck protection**: Rejects timing allocations that feed links with zero downstream storage capacity or full occupancy ($\text{DownstreamCapacityVeh} \le 0$ or $\text{OccupancyRatio} \ge 1.0$).
       - **Incident closure protection**: Blocks green allocation toward approaches experiencing complete incident closures.
       - **Emergency corridor protection**: Prevents manual or recommendation plans from interfering with active emergency priority pre-clearance routes.
  2. **Manual movement locks:**
     - Enforces operator locks on movements or phases (`locks[p.ID]` or `locks[mid]`), immediately failing validation if a recommendation alters a locked movement.
  3. **Fail-safe retention & structured audit:**
     - On validation failure, the current safe plan is retained, HTTP 409 Conflict is returned with a descriptive violation message, and an atomic audit event is recorded with `safety_result: "rejected: <reason>"`.
     - Verified by test `TestSafetyValidatorRuleBreaches` covering 11 discrete failure conditions in `apps/api/internal/httpapi/decision_test.go`.

### Story S14: Support observe, recommend and manual modes [P0]
- **User Story:** *As an operator, I want explicit control of recommendation authority, so that automation cannot override my decision.*
- **Acceptance Criteria & Evidence:**
  1. **Three operational modes supported:**
     - **Recommend mode (Default)**: Digital twin runs predictive models and surfaces proactive signal recommendations for operator approval.
     - **Observe mode**: Streams live telemetry, junction state, and multi-horizon forecasts without generating automated recommendation interventions.
     - **Manual mode**: Immediately stops automated recommendations; locks operator-specified movements and displays a prominent persistent banner warning operators that autonomous recommendations are suspended.
  2. **API and WebSocket mode control:**
     - Implemented endpoints `/api/v1/mode` (GET) and `/api/v1/mode/{mode}` (POST) with validation against valid modes (`recommend`, `observe`, `manual`).
     - Mode changes trigger atomic PostgreSQL audit log entries (`event_type: "mode.changed"`).
  3. **Zero physical actuation endpoint guarantee:**
     - Audited and verified by automated test `TestNoPhysicalActuationEndpoint`: scanning all registered chi router routes and handlers confirms zero endpoints actuate physical controllers or live city traffic hardware.
  4. **Degradation handling:**
     - Any simulated intelligence degradation stops recommendation generation, surfaces status in the health popover, and keeps traffic in safe base timing.

### Story S15: Approve, modify and reject with audit [P0]
- **User Story:** *As an operator, I want bounded decision controls, so that I retain final authority over the simulated plan.*
- **Acceptance Criteria & Evidence:**
  1. **Four decision actions exposed:**
     - `SIMULATE`: Runs a fast-forward rollout comparing baseline vs candidate plan across 4 outcome metrics (Max Queue, Average Delay, Spillback Duration, Stops per Vehicle) per PRD §8.4.
     - `APPROVE IN DIGITAL TWIN`: Validates candidate plan against safety rules, applies it to the digital twin simulation, and logs accepted action.
     - `MODIFY`: Opens bounded in-situ adjustment sliders/inputs with live min/max indicator chips; enforces mandatory operational justification; validates bounds client-side and server-side before application.
     - `REJECT`: Rejects recommendation; mandates operator justification category from the 9 PRD §8.3 categories (Field observation, Accident/obstruction, Pedestrian crowd, Procession/festival, VIP movement, Emergency vehicle, Camera/sensor issue, Signal malfunction, Other).
  2. **Durable PostgreSQL audit trail:**
     - Every decision records actor, timestamp, recommendation ID, before/after timing changes, justification reason, safety result, and run ID.
     - Accessible via `/api/v1/audit` and rendered in the Command Center "Audit & Health" sequential log feed.

---

## 3. Automated Test Results

### 3.1 Go Contracts & API Safety Test Suite (`apps/api`)
```text
=== RUN   TestSafetyValidatorRuleBreaches
=== RUN   TestSafetyValidatorRuleBreaches/MinGreenViolation
=== RUN   TestSafetyValidatorRuleBreaches/MaxGreenAndExcessiveHold
=== RUN   TestSafetyValidatorRuleBreaches/IncompletePhasePlan
=== RUN   TestSafetyValidatorRuleBreaches/DuplicatePhase
=== RUN   TestSafetyValidatorRuleBreaches/PedestrianClearanceBreach
=== RUN   TestSafetyValidatorRuleBreaches/AmberClearanceBreach
=== RUN   TestSafetyValidatorRuleBreaches/ConflictingGreensInPhase
=== RUN   TestSafetyValidatorRuleBreaches/MaxCrossWaitExceeded
=== RUN   TestSafetyValidatorRuleBreaches/ManualLockEnforcement
=== RUN   TestSafetyValidatorRuleBreaches/IncidentClosureProtection
=== RUN   TestSafetyValidatorRuleBreaches/DownstreamOccupancyFull
--- PASS: TestSafetyValidatorRuleBreaches (0.01s)
=== RUN   TestNoPhysicalActuationEndpoint
--- PASS: TestNoPhysicalActuationEndpoint (0.00s)
=== RUN   TestModesAndLockEndpoints
--- PASS: TestModesAndLockEndpoints (0.00s)
PASS
ok  	traffic.local/twin/apps/api/internal/config	(cached)
ok  	traffic.local/twin/apps/api/internal/contracts	(cached)
ok  	traffic.local/twin/apps/api/internal/httpapi	(cached)
ok  	traffic.local/twin/apps/api/internal/store	(cached)
```

### 3.2 Vitest Component & Unit Tests (`apps/web`)
```text
 ✓ lib/live.test.tsx (2 tests)
 ✓ components/live-panel.test.tsx (8 tests)
 ✓ components/network.test.tsx (3 tests)
 ✓ components/epic3.test.tsx (8 tests)
 ✓ components/epic4.test.tsx (4 tests)
 ✓ components/epic5.test.tsx (8 tests)

 Test Files  6 passed (6)
      Tests  33 passed (33)
   Duration  6.37s
```

### 3.3 Playwright E2E Verification (`scripts/verify-epic5.mjs`)
```text
Starting Next.js test server on port 3107...
Navigating to Command Center...
1. Verifying Operating Constraints & Disclosure...
2. Verifying Story S14 Operational Modes...
   - Switching to Observe mode...
   - Switching to Manual mode...
   - Verifying manual mode alert banner on Action Rail...
   - Switching back to Recommend mode...
3. Verifying Story S13 Safety Bounds Validation...
   - Testing excessive timing out-of-bounds rejection...
   - Testing below-minimum timing out-of-bounds rejection...
   - Restoring safe within-bounds timing (35s)...
4. Verifying Story S15 Simulated Comparison (PRD §8.4)...
5. Verifying Story S15 Bounded Modification with Mandatory Reason...
6. Verifying Story S15 Rejection with Mandatory Reason...
7. Verifying Durable Sequential Audit Trail View...
8. Capturing desktop and mobile screenshot evidence for Epic 5...
===============================================================
PASS verify-epic5: All S13, S14, and S15 requirements verified cleanly!
Screenshots: docs/screenshots/epic5-desktop.png, docs/screenshots/epic5-mobile.png
===============================================================
```

---

## 4. Gap Analysis & Resolution Matrix

| Area | Requirement | Gap Identified | Engineering Resolution | Status |
|---|---|---|---|---|
| **Safety Validation** | Min/Max green bound enforcement | API previously accepted raw timing without bounds checking against network config | Implemented `validateChanges` enforcing strict phase bounds, clearing intervals, conflict matrix, pedestrian minimums, and downstream capacity | **Resolved** |
| **Manual Locks** | Operator movement lock enforcement | No lock state management in API or UI | Implemented `/api/v1/locks` endpoints and memory map; validator rejects any plan attempting to mutate locked phases | **Resolved** |
| **Operating Modes** | Support recommend, observe, and manual modes | UI only had binary toggle; backend lacked explicit mode state endpoint | Added 3-mode segmented control on TopBar (`Recommend`, `Observe`, `Manual`), manual banner on ActionRail, and `/api/v1/mode` route | **Resolved** |
| **Decision Actions** | 4 distinct operator decision actions | UI had rudimentary buttons without mandatory reasons | Implemented all 4 actions (`Simulate`, `Approve in Twin`, `Modify`, `Reject`), all 9 PRD §8.3 mandatory reasons, and simulation outcome comparison | **Resolved** |
| **Simulated Comparison** | PRD §8.4 comparison metrics | ActionRail did not display 4 comparative metrics | Integrated `comparisonResult` card presenting Max Queue, Average Delay, Spillback Duration, and Stops per Vehicle | **Resolved** |
| **Audit Logging** | Durable structured record | Rejections and modifications lacked structured actor/reason auditing | Implemented structured PostgreSQL audit logging with safety result strings for all decisions and mode transitions | **Resolved** |

---

## 5. Architecture & Operational Integrity

```
                               ┌─────────────────────────────┐
                               │   Operator UI (Next.js)     │
                               │  - Recommend / Observe /    │
                               │    Manual Mode Selection     │
                               │  - Bounded Plan Adjustment  │
                               │  - Mandatory Justifications │
                               └──────────────┬──────────────┘
                                              │ HTTP / JSON
                                              ▼
                               ┌─────────────────────────────┐
                               │     Go HTTP API (chi)       │
                               │   NO PHYSICAL ACTUATION     │
                               └──────────────┬──────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
     ┌─────────────────────────────────┐             ┌─────────────────────────────────┐
     │      Go Safety Validator        │             │    PostgreSQL Audit Log         │
     │  - Min/Max Phase Boundaries     │             │  - Atomic durability            │
     │  - Non-Conflicting Greens       │             │  - Structured safety results    │
     │  - Clearance Intervals          │             │  - Mandatory operator reasons   │
     │  - Pedestrian Clearance         │             │  - Chronological sequence       │
     │  - Receiving Capacity Storage   │             └─────────────────────────────────┘
     │  - Incident / Emergency Safety  │
     │  - Operator Movement Locks      │
     └────────────────┬────────────────┘
                      │ Pass / Fail (409 Conflict)
                      ▼
     ┌─────────────────────────────────┐
     │    Digital Twin Simulation      │
     │  (SUMO / Internal Engine)       │
     │  - Safe In-Memory Plan Applied  │
     │  - Telemetry Streamed via WS    │
     └─────────────────────────────────┘
```

---

## 6. Verification Evidence

- Desktop Command Center View: `docs/screenshots/epic5-desktop.png`
- Mobile Viewport Experience: `docs/screenshots/epic5-mobile.png`
- Automated Verification Suite: `scripts/verify-epic5.mjs`
- Automated Dashboard Suite: `scripts/verify-dashboard.mjs`
