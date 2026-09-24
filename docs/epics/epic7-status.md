# Epic 7 — Before-vs-after Evidence (S21, S22)

**Status:** ✅ Complete  
**Branch:** `epic7`  
**Date:** 2026-09-17

## Stories Completed

### S21 — Create isolated, equal-seed simulation branches

**Implementation:**
- `services/intelligence/model.py` — `Model.comparison()` clones identical snapshot & random seed for baseline and candidate rollouts (120s horizon, conservation-v2 model)
- Returns 4 aggregate outcome metrics: max queue (veh), average delay (s), spillback (movement-seconds), stops/vehicle
- Safety envelope enforcement rejects out-of-bounds timing changes before simulation
- Zero mutation of live traffic state verified via serialization comparison
- Binds results to immutable (run_id, recommendation_id, seed, initial_time_s)

**Tests:**
- `services/intelligence/tests/test_epic7.py` — 5 tests:
  - `test_s21_equal_seed_identical_initial_snapshot` — provenance fields + zero-mutation
  - `test_s21_four_outcome_metrics_evaluated` — all 4 metrics non-negative
  - `test_s21_identical_plans_yield_exact_zero_deltas` — identical plans = zero delta
  - `test_s21_safety_envelope_enforcement_in_simulation` — out-of-bounds rejection
  - `test_s22_stale_binding_integrity` — unique run_id/recommendation_id binding

### S22 — Show synchronized comparison and impact

**Implementation:**
- `apps/web/components/network-view.tsx` — `ComparisonTable` and `NetworkView` with PRD §8.4 split-screen:
  - Dual-canvas Before-vs-After split view (baseline strategy + candidate recommendation)
  - 4 outcome metric cards with honest delta indicators (improved/unchanged/worse)
  - SIMULATED badge on both split header and metrics section
  - Simulation provenance strip (seed, initial time, horizon, model version, run_id, recommendation_id)
  - Zero-mutation disclaimer
  - Stale comparison rejection (run_id/recommendation_id mismatch → empty state)
  - "Simulate in Digital Twin" action button with loading state
- `apps/web/components/workspace.tsx` — Passes `comparisonResult`, `onSimulate`, `isSimulating` to `NetworkView`
- `apps/web/app/globals.css` — Added `.delta-pill.red` and `.delta-pill.gray` for honest indicators
- `apps/api/internal/httpapi/decision.go` — Stores comparison result in analysis under mutex, clears on approve/reject/modify

**Tests:**
- `apps/web/components/epic7.test.tsx` — 12 tests:
  - S21 provenance: seed, initial time, horizon, model version rendering
  - S21 binding: run_id and recommendation_id displayed
  - S21 disclaimer: zero-mutation text
  - S22 split-screen: baseline + candidate canvas columns with labels
  - S22 metrics: 4 PRD §8.4 metrics + SIMULATED badge
  - S22 deltas: improved, unchanged, worse indicators
  - S22 stale rejection: run_id mismatch → empty state
  - S22 simulation trigger: button click fires onSimulate
  - S22 loading state: disabled button + loading text
  - outcome() helper: improved, worse, zero baseline tests

## Verification Summary

| Stack    | Tests | Status |
|----------|-------|--------|
| Frontend | 57/57 | ✅ Pass |
| Python   | 20/20 | ✅ Pass |
| Go       | All   | ✅ Pass |

## Modified Files

- `apps/api/internal/httpapi/decision.go`
- `apps/web/app/globals.css`
- `apps/web/components/network-view.tsx`
- `apps/web/components/workspace.tsx`
- `apps/web/components/epic7.test.tsx` (new)
- `services/intelligence/model.py`
- `services/intelligence/tests/test_epic7.py` (new)
- `docs/delivery-status.json`
- `docs/backlog.json`
- `docs/DELIVERY-PLAN.md`
