# Epic 14 acceptance evidence — Production UX, access & acceptance

**Status:** completed on the `epic14` branch.

Epic 14 delivers the production UX resilience, session recovery, truth-in-loading status management, accessible responsive critical flows, and audited full-epic reacceptance for the Predictive Traffic Digital Twin.

Every user journey strictly enforces human authority, truthful data provenance, durable command recovery, and zero silent failures across desktop and mobile viewports.

---

## S44 — Implement truthful loading, failure and recovery states

- **Truthful Status Lifecycle Across All Screens (`apps/web/components/workspace.tsx`):**
  - Distinguishes loading (`Loading network configuration…`), valid empty, invalid data, stale/disconnected stream, offline network, slow timeout, and maintenance states.
  - Absence of health data reports `"System: Unknown"` rather than claiming false `"Normal"` or `"Healthy"` ([`top-bar.tsx`](file:///home/sarthaktripathy/Documents/Traffic%20digital%20twin/apps/web/components/top-bar.tsx#L62-L64)).
  - Core component degradation reports `"System: Degraded"` immediately with component-level diagnostic narrative.
  - Bundled offline topology is explicitly watermarked: *"Bundled offline topology only. This configuration is not a live service response."*
- **Error Boundaries & Safe Recovery Action (`apps/web/src/main.tsx`):**
  - React `ErrorBoundary` encloses the workspace. On render or state crashes, displays structured recovery alert: *"No successful command outcome is assumed. Retry loading, then inspect current state and audit before sending a new command."* with safe `"Retry workspace"` and deep link to `"Open audit after recovery"`.
- **Golden Replay Integration in Active Workspace:**
  - Integrated directly in Command Center: displays *"Replay is a prerecorded fallback delivered by the Go API. It requires the verified recording and PostgreSQL to create its run audit."*
  - Dedicated `"Start golden replay"` launcher with confirmation prompt to prevent accidental active run replacement.

---

## S45 — Make operator journeys recoverable and idempotent

- **Draft Preservation Across Errors & Navigation (`apps/web/components/action-rail.tsx`):**
  - Decision notes, mandatory reason categories, and phase timing modifications are persisted in `sessionStorage` scoped by actor, run, and recommendation (`twin-draft:${draftOwner}:${runId}:${recId}`).
  - Retains operator drafts across failed mutation attempts, network timeouts, section changes, and component remounts.
  - Browser leave guard (`beforeunload` & dirty confirmation) warns operators before discarding unsent decision drafts.
- **Uncertain Command Identity & Review Barrier (`apps/web/components/session-panel.tsx`):**
  - Tracks uncertain commands via `twin-uncertain-command` in local storage.
  - When an uncertain command is detected, renders an alert banner blocking duplicate actions: *"Command {id} ... Do not repeat an uncertain action. Inspect the current plan and Audit & Health."*
  - Requires explicit operator review checkbox before clearing the barrier.
- **Active Run Replacement Confirmation:**
  - Confirms with the operator before replacing an active run or resetting scenarios (`window.confirm("Replace the active run? Unsent changes will be discarded.")`).
- **Durable Audit Pagination Beyond 100 Records (`apps/web/components/workspace.tsx`):**
  - Paginated cursor navigation (`after={cursor}&limit=50`) with Previous page, Next page, and First page controls, tracking durable cursors across database records.

---

## S46 — Enforce production roles and session recovery

- **Production Role Contracts & Permissions (`apps/web/components/session-panel.tsx`):**
  - Enforces roles (`operator`, `supervisor`, `viewer`) at the API and UI boundaries.
  - When unauthenticated, displays local administrator sign-in form with username and password.
  - When authenticated, displays session info: *"Signed in as {actor} · {role}"* with dedicated `"Sign out"` button.
- **Viewer Role Executive Mode Restriction:**
  - When viewing as `viewer`, mutating actions (`POST /api/v1/runs`, decision approvals, timing modifications, locks) are strictly disabled.
  - Displays prominent executive banner: *"EXECUTIVE BRIEFING MODE (DGP / SENIOR LEADERSHIP) — High-level outcome visualization. Deterministic simulation proof of concept. No live physical signal actuation."* with direct launcher for the 8-step presentation briefing.
- **Session Expiration Event Handling:**
  - Listens for `session-expired` custom events triggered on HTTP 401 responses, invalidating queries without discarding local form drafts.

---

## S47 — Verify accessibility and responsive critical flows

- **Dialog Focus & Keyboard Navigation:**
  - Custom health popover dialog implements `role="dialog"`, `aria-modal="true"`, `aria-expanded`, and `aria-controls` attributes.
  - Automatically captures focus on open and supports `Escape` key dismissal with return-to-trigger focus restoration.
- **Mode Segmented Control Accessibility:**
  - `role="group"`, `aria-label="Operational Mode Selection"`, and `active` states on Recommend, Observe, and Manual segments.
- **Responsive Mobile Layout (390 × 844 iPhone Standard):**
  - Verified zero horizontal overflow (`scrollWidth <= clientWidth`).
  - Interactive buttons and transport controls exceed 44px touch target guidelines.
  - High contrast ratio (WCAG 2.1 AA >= 4.5:1) in dark theme.
  - Full `@media (prefers-reduced-motion: reduce)` support.

---

## S48 — Reaccept every epic with auditable production evidence

- **Full Verification Summary Across All 14 Epics:**
  - **E01–E05:** Core contracts, deterministic simulation, command center, forecasting, safety envelope.
  - **E06–E10:** AGDA recommendations, before-vs-after evidence, audit resilience, C3 incident recovery, ambulance corridor.
  - **E11–E12:** DGP presentation acceptance, computer vision analytics and video overlays.
  - **E13:** Go public gateway, PostgreSQL persistence, idempotency, lease fencing, and API reliability.
  - **E14:** Production UX truthfulness, operator recovery, role sessions, accessibility, and E2E acceptance.
- **Closed Findings:**
  - **A04:** Truthful status representations; no fabricated healthy claims without fresh evidence.
  - **A05:** Decision notes retained across errors; reconciliation status and command recovery exposed.
  - **A06:** Stale analysis filtered out; cross-run comparisons invalidated on recommendation change.
  - **A08:** Timing locks hydrated from server and persisted.
  - **A10:** Audit trail paginated beyond 100 events with durable cursor and decision evidence details.
  - **A11:** Golden replay fallback restored and accessible in workspace.
  - **A12:** Bounded request timeouts, typed ApiError, and retry policies.
  - **A13:** Production roles enforced on server and UI with session recovery.
  - **A14:** Start/reset confirmation prompts prevent accidental run overwrites.
  - **A15:** URL deep linking (`?view=...`), popstate navigation, and draft beforeunload guards.
  - **A16:** Modal keyboard accessibility, Escape handlers, focus management, and responsive 390px mobile layout.
  - **A18:** Comprehensive OpenAPI synchronization and route parity testing.
  - **A19 / A20:** Real multi-suite production-path integration, removal of internal planning labels from production copy, and verified evidence.

---

## Verification Commands & Test Results

1. **TypeScript Verification:**
   ```sh
   npm run typecheck
   ```
   *Result:* PASSED (0 type errors).

2. **Web UI Test Suite (Vitest):**
   ```sh
   npm run test:ui
   ```
   *Result:* PASSED (92 tests across 15 test suites, including new tests in `apps/web/components/epic14.test.tsx`).

3. **Web Production Build (Vite):**
   ```sh
   npm run build
   ```
   *Result:* PASSED (built in 650 ms).

4. **Browser E2E Acceptance (Playwright):**
   ```sh
   node scripts/verify-epic14-browser.mjs
   ```
   *Result:* PASSED:
   - Policy disclosure chips verified.
   - Accessible health dialog and Escape key handling verified.
   - Unauthenticated sign-in and command recovery panel verified.
   - All 6 sections navigated successfully.
   - Deep linking (`?view=audit`) verified.
   - Zero horizontal overflow on mobile viewport (390 × 844) verified.
   - Visual artifacts captured: `docs/screenshots/epic14-desktop.png` and `docs/screenshots/epic14-mobile.png`.

5. **Go Gateway & Persistence Suite:**
   ```sh
   go test ./apps/api/...
   python3 scripts/verify-epic13.py
   ```
   *Result:* PASSED (100% pass rate).

6. **Python Engine & Simulation Suite:**
   ```sh
   pytest
   ```
   *Result:* PASSED (46 tests passing).

7. **Delivery Dashboard Verification:**
   ```sh
   node scripts/verify-dashboard.mjs
   ```
   *Result:* PASSED (all 14 epics verified, 45 evidence-backed completions, evidence endpoints return 200).

---

## Residual Limits

- Production user authentication in this release uses local administrator-provisioned demo accounts; enterprise SSO/SAML integration is deferred to enterprise packaging.
- Emergency corridor clearance is synthetic and simulated within the digital twin model; field actuation requires certified hardware interlocks.
