> **Architecture alignment notice — 2026-09-18:** This historical forecasting evidence is now governed by the supplied Go-control-plane and private-Python-compute specifications. It does not authorize a Python public gateway or separate DB writer.

# Epic 4 Delivery Status: Forecasts, Platoons & Spillback

**Epic ID:** `E04`  
**Owner:** Intelligence + Frontend  
**Status:** Completed  
**Branch:** `epic4`  
**Target Completion:** Day 5  
**PRD References:** §§16–17, 20–21; `AGENT.MD`: Forecasting  

---

## 1. Executive Summary

Epic 4 implements the deterministic, conservation-based forecasting engine, platoon propagation with Robertson-style dispersion and ETA tolerance, and spillback prediction for the connected C1–C6 road corridor. It adheres strictly to PRD §§16–17 and AGENT.MD forecasting rules: **no ungrounded ML claims**, strictly conservation-based bounded rollouts, deterministic plain-language explanation facts including upstream sources, and advance spillback warnings with ~90–120 seconds lead time.

---

## 2. Story Implementation & Acceptance Verification

### Story S11: Implement conservation-based forecasting [P0]
- **User Story:** *As an operator, I want bounded queue forecasts, so that I can anticipate congestion.*
- **Acceptance Criteria & Evidence:**
  1. **$Q(t+1) = \max(0, Q(t) + \text{arrivals} - \text{departures})$:**
     - Implemented in `services/intelligence/model.py` (`discharge = max(0., min(q[mid], capacity, receiver))`, `q[mid] = max(0., q[mid] - discharge)`).
     - Strict non-negative queue invariant verified across all simulation steps.
  2. **Bounded departures:**
     - Departures are strictly limited by active signal phase (`stage == 'green'` and `serving_phase == pid`), saturation flow capacity ($0.5 \times \text{lanes} \times \text{turn\_ratio}$), available queue, and downstream receiving capacity ($R_l(t) = \max(0, C_l - \text{occupied}_l - \text{reserved}_l)$).
  3. **Multi-horizon output & conservation test:**
     - Outputs queue lengths, occupancy ratios, and cumulative expected arrivals at $30\text{s}$, $60\text{s}$, $120\text{s}$, and $300\text{s}$.
     - 300-second horizon is explicitly labeled as *5-minute output advisory*.
     - Verified by unit test `test_conservation_and_non_negative_queues` in `services/intelligence/tests/test_model.py`.

### Story S12: Propagate platoons and predict spillback [P0]
- **User Story:** *As an operator, I want upstream-aware alerts and ETA facts, so that I can intervene before C1 becomes critical.*
- **Acceptance Criteria & Evidence:**
  1. **Platoon propagation & ETA tolerance:**
     - Vehicles discharged from upstream movements are propagated along link travel time $\tau = \lceil \text{length\_m} / (v_{\text{free}} / 3.6) \rceil$ and apportioned according to destination turning ratios.
     - Modeled with discrete dispersion across an ETA tolerance band $[\tau - 1, \tau, \tau + 1]$ (70% nominal, 15% leading front, 15% trailing platoon) preserving 100% mass conservation.
     - Verified by unit test `test_platoon_dispersion_eta_tolerance`.
  2. **Spillback risk, ETA, and upstream source facts:**
     - Detects approach storage saturation when storage occupancy exceeds $85\%$ or movement queue reaches capacity limits.
     - Returns `spillback_eta_s` and deterministic explanation facts including upstream feeder source (e.g. `Upstream source: junction C3 via corridor C3-C1`, `Projected arrivals: 36.0 veh over 120s horizon`, `Storage occupancy: 94.0%`).
     - Verified by unit test `test_spillback_prediction_and_upstream_source_facts`.
  3. **Peak-surge fixture alert lead time:**
     - Under `peak_surge` conditions (seed 1101), the model raises advance warnings at $t \approx 35\text{–}50\text{s}$, providing approximately $90\text{–}120\text{s}$ scenario lead time before C1 northbound approach reaches peak congestion.
     - Verified by test `test_peak_surge_fixture_alert_lead_time`.

---

## 3. Automated Test Results

### 3.1 Python Intelligence & Simulation Test Suite (`services/`)
```text
services/intelligence/tests/test_model.py ........                       [ 22%]
services/shared/test_schema.py ..                                        [ 27%]
services/shared/test_validation.py ......                                [ 44%]
services/simulation/tests/test_engine.py .........                       [ 69%]
services/simulation/tests/test_safety.py ..........                      [ 97%]
services/simulation/tests/test_service.py .                              [100%]

============================= 36 passed in 25.42s ==============================
```

### 3.2 Go Contracts & API Test Suite (`apps/api`)
```text
ok  	traffic.local/twin/apps/api/internal/config	(cached)
ok  	traffic.local/twin/apps/api/internal/contracts	(cached)
ok  	traffic.local/twin/apps/api/internal/httpapi	(cached)
ok  	traffic.local/twin/apps/api/internal/store	(cached)
```

### 3.3 Vitest Component & Unit Tests (`apps/web`)
```text
 ✓ lib/live.test.tsx (2 tests)
 ✓ components/live-panel.test.tsx (8 tests)
 ✓ components/network.test.tsx (3 tests)
 ✓ components/epic3.test.tsx (8 tests)
 ✓ components/epic4.test.tsx (4 tests)

 Test Files  5 passed (5)
      Tests  25 passed (25)
   Duration  3.97s
```

### 3.4 Playwright E2E Verification (`scripts/verify-epic4.mjs`)
```text
Starting Next.js test server on port 3106...
Navigating to Command Center...
Verifying S11 Conservation-based Forecasting Horizons...
Verifying S12 Platoon Dispersion and Upstream Source Explanation...
Verifying Network Screen Split Comparison Mode...
Capturing desktop and mobile screenshot evidence for Epic 4...
===============================================================
PASS verify-epic4: All S11, S12, and PRD §§16-17, 20-21 requirements verified cleanly!
Screenshots: test-results/epic4-desktop.png, test-results/epic4-mobile.png
===============================================================
```

---

## 4. UI/UX Verification Artifacts
- Desktop Screenshot: `test-results/epic4-desktop.png`
- Mobile Viewport: `test-results/epic4-mobile.png`
- Evidence Status URL: `/evidence/epic4`
