# UX production audit and API routing review

Date: 2026-09-17. Repository: `Traffic digital twin`. **Status: NOT READY for production or the requested gateway/load-balanced architecture.** The project remains a synthetic local demonstration; this audit does not approve physical traffic control or a shadow pilot.

## Scope, method and evidence limits

Inspected the product entrypoint and all production frontend components; state/query/stream handling; every registered Go REST/WebSocket handler and persistence path; Python simulation/intelligence/safety/network code; configuration, protobuf/OpenAPI/types, migration/query definitions; startup/configuration; existing tests and acceptance reports; and the separate delivery dashboard. Generated bindings, dependency trees, build/runtime output and legacy dashboard snapshots were inventory/context, not independently audited third-party code. No application code or runtime contract files were edited. Existing user changes in `apps/web/lib/api.ts` and `apps/web/next-env.d.ts` were preserved and the audit describes that working tree.

Findings below are source-verified behavior or an explicitly labeled source-derived risk. They are not claimed browser reproductions. No fresh browser visual, screen-reader, keyboard-on-device, contrast, load, 30-minute soak, full offline or database-backed end-to-end validation was completed. Historical screenshots/reports are historical evidence only. There are no payment APIs/screens or browser camera/location/notification permission requests in the inspected product; payment success/failure/interruption and permanently denied device permissions are **not applicable to the current scope**, not implemented capabilities. Authentication/session expiry is absent and is a shared-production requirement.

## What is implemented

- Six-section Next.js/React workspace, configuration-driven SVG network, junction sheet, horizon selectors, action rail, live summary, run/audit lists and eight-step briefing. React Query manages HTTP state; Zustand manages presentation selection/role; component state handles navigation/forms.
- Same-origin Next REST/WebSocket proxy to Go. All active frontend request paths have Go handlers. Python is private gRPC compute, not a gateway. Go directly persists via pgx/sqlc and inline SQL.
- Deterministic SUMO setup/reset, 1 Hz state, conservation forecasts at 30/60/120/300 seconds, aggregate comparison and bounded candidates. Go and Python include safety validators; signal scheduler defers timing changes to clearance boundaries. Three seeded scenarios and prerecorded replay assets exist.
- Network skeleton/retry UI, run/audit loading/error/empty messages, start/reset pending/error/success feedback and seed validation. Live frames receive Zod validation; stale frames are hidden after 2.5 seconds; sockets reconnect.
- Go command validation, bounded contexts for many operations, origin checks, transactional run/audit creation, append-only audit trigger, durable approval intent and simulator process-local application deduplication. These protections are partial, not a blanket durability guarantee.
- Dark theme, responsive breakpoints, scroll containers, node keyboard activation, focus outlines, Radix modal primitives and reduced-motion CSS including hidden vehicle markers.

## Screen and flow coverage

| Surface/flow | Implemented | Missing or risky; findings |
|---|---|---|
| Command Center / action rail | Configuration loading, seeds, start/reset, pending controls, live staleness | Honest no-data/analysis errors; command confirmation and recovery; A03–A07, A12–A15 |
| Network and split comparison | Topology, horizons, split UI | Invented fallback results and unsynchronized branches; A02, A06 |
| Junction drawer | Current/forecast metrics, empty metrics, Radix sheet | Invented narrative/impact, stale forecast gating and tab behavior; A03, A06, A16 |
| Incidents | Backend scheduled/active/recovering/resolved logic; launch shortcut | Static wrong capacity, no severity controls or complete recovery view; A03, A17 |
| Emergency | Backend priority/clearance/recovery; route view | Lifecycle enum mismatch, missing detailed ETA/recovery view, unsupported guarantee; A03, A17 |
| Vision | Navigation and return action | Optional pipeline absent; misleading capability copy; A17 |
| Audit & Health | Loading/error/empty history and health polling | First page mislabeled latest, no cursor/detail/auto update; false Normal; A04, A10 |
| Top bar / modes / personas | Mode controls, health dialog and local role selector | Invalid SQL, hidden errors, no mode hydration/auth enforcement; A05, A07, A13, A16 |
| Presentation | Eight steps and keyboard next/previous | Static gains, safety/readiness claims, not a live scenario acceptance run; A03, A16 |
| Replay / service outage | Verified-file replay backend, stream staleness | Active UI cannot launch fallback; no maintenance/offline recovery model; A11–A12 |
| Delivery dashboard | Filtering, empty/error/retry, local-storage failure toast | Personal completion can mask reopened records; historical reports need qualification; A19–A20 |

## Requested UX checklist

| Topic | Audit result |
|---|---|
| Loading / skeleton | Partial: topology skeleton, run/audit loading; analysis and health need explicit pending/unknown. |
| Empty / no results | Partial: run/audit/measurements empty states; no forecast is incorrectly treated as no risk. |
| API / unexpected errors | Start/reset and history errors exist; decision/mode errors hidden; no app error boundary or response validation for most HTTP data. |
| Offline / network loss | Stream disconnect detected and topology bundle available; no general offline banner or safe reconnect/reconciliation. Internet isolation differs from local service loss. |
| Slow / timeout | Some server deadlines exist; no explicit browser deadline/cancellation; no proven slow-network acceptance. |
| Retry / recovery | Query retry, refresh and socket reconnect exist; command reconciliation and reachable replay are missing. |
| Permission denied | Origin 403 exists; production authorization/denied UX absent. Device permissions not in current scope. |
| Session expired | No authenticated session implementation or expiry recovery. |
| Payments | Not applicable: none found; do not add payment work without product scope. |
| Maintenance / unavailable | Several 503 responses exist; no consistent retryable/degraded/maintenance state or retry timing. |
| Validation / feedback | Seed bounds, plan input bounds and reason category exist; submit clears notes before result and integers are only enforced server-side. |
| Keyboard / overflow | Node keys and Radix dialogs implemented; health dialog/tab deficiencies source-verified; viewport/keyboard overflow needs measurement. |
| Small screens / responsiveness | Breakpoints, stacking and table scroll exist; all-screen narrow/zoom/device coverage unverified. |
| Accessibility | Some semantics/focus/reduced motion; contrast, text scaling, target sizing and screen-reader audit not measured. |
| Dark mode / themes | Dark-only CSS is explicit and matches original design; no theme toggle found. This is not itself a defect. |
| Destructive actions | Reset/start replace current run without confirmation/undo; require confirmation and known recovery outcome. |
| Navigation / back | Local state only, no section URL/back model or draft leave guard. |
| Duplicate taps | Pending buttons and backend mutex/dedup help locally; durable cross-tab/retry/failover idempotency missing. |
| Crash / dead ends | Unvalidated HTTP payload render calls can throw; hidden failures, unavailable replay and truncated audit can leave no useful next step. |

## Verified findings and prioritized fixes

Severity reflects consequence; Critical/High findings block release in their stated scope. Shared-production authentication is separate from permission to run an isolated synthetic demo. Architecture gaps block the newly requested design. Medium findings affecting critical operator journeys are also mandatory before release. Low copy cleanup can follow launch if it makes no misleading claim.

### A01 — Critical: Requested gateway, writer boundary and load balancing are absent

**Evidence:** [apps/web/next.config.ts](../apps/web/next.config.ts) (line 4); [apps/api/cmd/api/main.go](../apps/api/cmd/api/main.go) (line 38); [apps/api/internal/httpapi/server.go](../apps/api/internal/httpapi/server.go) (line 25); [services/shared/server.py](../services/shared/server.py) (line 11).

**Verified finding / consequence:** The implemented path is Browser → Next proxy → Go/chi → Python compute and PostgreSQL. One process owns state, analysis, locks, subscribers and the active run. No Python HTTP gateway, separate Go DB writer, route-owner registry or multi-replica run ownership exists. This blocks the requested architecture; it is not evidence that the existing single-process local demo fails to route.

**Required fix:** Implement and verify PRD §§32–34 before claiming the requested architecture or load-balancing readiness. Do not simply round-robin stateful commands.

**Stories:** S01, S02, S04, S06, S39, S40, S41, S42, S43.

### A02 — Critical: Network comparison presents fabricated fallback outcomes

**Evidence:** [apps/web/components/network-view.tsx](../apps/web/components/network-view.tsx) (line 48); [apps/web/components/network-view.tsx](../apps/web/components/network-view.tsx) (line 254).

**Verified finding / consequence:** When analysis is absent, split view supplies fixed queue/delay/spillback/stops values and invented IDs. Even real results receive fixed -28%, -38% and 100% elimination claims. Two canvases receive the same frame with different horizons, not separate synchronized rollout trajectories.

**Required fix:** Remove operational fallback numbers; show not simulated/unavailable. Bind metrics and both views to one validated comparison, or explicitly present an aggregate-only comparison. Calculate signed outcomes, including worse/unchanged/zero baseline.

**Stories:** S19, S21, S22, S33.

### A03 — High: Static narratives and safety guarantees overstate evidence

**Evidence:** [apps/web/components/junction-drawer.tsx](../apps/web/components/junction-drawer.tsx) (line 86); [apps/web/components/junction-drawer.tsx](../apps/web/components/junction-drawer.tsx) (line 323); [apps/web/components/action-rail.tsx](../apps/web/components/action-rail.tsx) (line 386); [apps/web/components/dgp-presentation.tsx](../apps/web/components/dgp-presentation.tsx) (line 167); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 566).

**Verified finding / consequence:** Drawer invents travel/occupancy/impact explanations when forecasts are missing. Safety badges claim verification before the server validates; presentation advertises fixed gains, zero risk and deployment readiness. Incident text says 50% while scenario config specifies 35% remaining capacity; C6 is a boundary, not a controlled signal. These are implemented strings, not audit conclusions.

**Required fix:** Derive facts, bounds and lifecycle from current configuration and response provenance. Mark unavailable facts unknown; label illustrative briefing content as illustrative and remove unsupported completion/safety guarantees.

**Stories:** S03, S08, S10, S12, S13, S19, S29, S31, S34.

### A04 — High: No data can look healthy

**Evidence:** [apps/web/components/top-bar.tsx](../apps/web/components/top-bar.tsx) (line 54); [apps/web/components/action-rail.tsx](../apps/web/components/action-rail.tsx) (line 130); [apps/web/components/action-rail.tsx](../apps/web/components/action-rail.tsx) (line 158); [apps/web/components/kpi-strip.tsx](../apps/web/components/kpi-strip.tsx) (line 113); [apps/web/lib/api.ts](../apps/web/lib/api.ts) (line 78).

**Verified finding / consequence:** Absent health defaults to Normal; missing forecasts default to a stable horizon/nominal traffic. getNetwork catches every failure, including malformed responses, and silently returns bundled config except for a console warning. This fallback is a pre-existing uncommitted user change and was not introduced by this audit.

**Required fix:** Represent loading, unknown, failed, stale and bundled-offline topology explicitly. Healthy claims require fresh validated evidence. Keep controls disabled when authoritative dependencies are unavailable.

**Stories:** S08, S09, S10, S26, S44.

### A05 — High: Active decision and mode errors are invisible

**Evidence:** [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 125); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 478); [apps/web/components/action-rail.tsx](../apps/web/components/action-rail.tsx) (line 193); [apps/web/components/action-rail.tsx](../apps/web/components/action-rail.tsx) (line 207).

**Verified finding / consequence:** Workspace exposes only pending decision state to ActionRail and does not render decision/mode errors. Modify/reject panels close and clear the reason immediately after dispatch. A 409/503 or ambiguous application leaves the operator without feedback or their notes. The older DecisionPanel has error UI but is not mounted.

**Required fix:** Keep inputs until confirmed success, display accessible server errors and reconciliation status, attach command/audit identifiers, and allow safe recovery without blindly repeating an uncertain write.

**Stories:** S14, S15, S25, S44, S45.

### A06 — High: Stale analysis and cross-run comparison can remain actionable

**Evidence:** [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 114); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 119); [apps/web/components/action-rail.tsx](../apps/web/components/action-rail.tsx) (line 267); [apps/web/components/action-rail.tsx](../apps/web/components/action-rail.tsx) (line 460).

**Verified finding / consequence:** Cached analysis is accepted based on run ID without checking query failure, analysis age or live freshness. Decision buttons only use pending state. Scenario start/reset does not clear comparison; ActionRail displays any comparison without run/recommendation matching. Backend stale checks mitigate actuation, but UI remains misleading and failures are hidden.

**Required fix:** Gate decisions and forecasts on freshness, identity, mode, replay, permissions and dependencies. Invalidate comparison/edits on run or recommendation change; reject late responses from superseded requests.

**Stories:** S06, S09, S10, S14, S15, S22, S44, S45.

### A07 — High: Mode changes contain invalid SQL and state cannot reconcile after reload

**Evidence:** [apps/api/internal/httpapi/decision.go](../apps/api/internal/httpapi/decision.go) (line 515); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 77); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 203); [services/simulation/engine.py](../services/simulation/engine.py) (line 35).

**Verified finding / consequence:** setMode embeds canonicalMode as an SQL identifier and uses + in the SQL string rather than binding the Go value; the audit statement cannot record the intended reason. This is a source-verified defect, not a successful database reproduction. Workspace never reads GET /mode and starts with local defaults. Selecting Observe then starting sends recommend; the HTTP start validator accepts manual but Python reset rejects it. Manual is persisted as observe, losing distinction after restart.

**Required fix:** Parameterize and integration-test mode writes; persist canonical mode, hydrate it on startup/reconnect, use the acknowledged server value and unify start/reset mode contracts. Cover every mode with real PostgreSQL and Python.

**Stories:** S02, S05, S14, S33, S40.

### A08 — High: Locks can succeed without audit and disappear on restart

**Evidence:** [apps/api/internal/httpapi/decision.go](../apps/api/internal/httpapi/decision.go) (line 399); [apps/api/internal/httpapi/decision.go](../apps/api/internal/httpapi/decision.go) (line 426); [apps/api/internal/httpapi/decision.go](../apps/api/internal/httpapi/decision.go) (line 412).

**Verified finding / consequence:** Lock handlers mutate memory, accept any nonempty target and ignore audit Exec errors; no lock persistence/reload is implemented. They do not use the command mutex used for decision serialization, leaving lock changes and application uncoordinated. No lock controls are wired in the active frontend.

**Required fix:** Validate configured target IDs; make lock state and audit durable through the writer before acknowledgment; serialize with application, restore state on restart and expose actual lock controls and denied/error states.

**Stories:** S13, S14, S25, S41, S45.

### A09 — High: Persistence ordering and ambiguous decisions need reconciliation

**Evidence:** [apps/api/internal/httpapi/simulation.go](../apps/api/internal/httpapi/simulation.go) (line 63); [apps/api/internal/httpapi/decision.go](../apps/api/internal/httpapi/decision.go) (line 74); [apps/api/internal/httpapi/decision.go](../apps/api/internal/httpapi/decision.go) (line 332); [apps/api/internal/httpapi/decision.go](../apps/api/internal/httpapi/decision.go) (line 322).

**Verified finding / consequence:** Stream lifecycle writes happen before acceptFrame validation. Intelligence becomes visible before recommendation persistence completes. Safety-rejection and application-failure audit errors are ignored, and reject status update errors are ignored outside the audit transaction. Durable intent exists for approval, but final-audit failure can leave application accepted and UI uncertain. Python deduplication is in-memory and keyed by recommendation ID, not a durable payload-bound command.

**Required fix:** Validate before writes/publication; atomically commit result/status/audit with a durable command ID and payload hash. Use intent → dispatch → applied/failed/unknown reconciliation across simulator and database, including restart and changed-payload retries.

**Stories:** S04, S06, S13, S15, S25, S41, S43.

### A10 — High: Audit view loses later events and omits decision evidence

**Evidence:** [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 102); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 651); [db/queries/foundation.sql](../db/queries/foundation.sql) (line 14); [apps/web/lib/live.ts](../apps/web/lib/live.ts) (line 127).

**Verified finding / consequence:** REST returns ascending first 50 events from after=0; UI labels them latest 50, never consumes next_after, and displays no recommendation ID or before/after details. The live hook ignores audit.appended (and forecast/recommendation events), so external changes do not refresh audit automatically.

**Required fix:** Implement explicit newest/history pagination and inspectable decision links and values; consume events or documented polling and reconcile from durable cursor after reconnect. Test more than 100 events and multiple clients.

**Stories:** S25, S28, S42, S45.

### A11 — High: Replay recovery is unreachable from the active workspace

**Evidence:** [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 29); [apps/web/components/decision-panel.tsx](../apps/web/components/decision-panel.tsx) (line 282); [apps/api/internal/httpapi/replay.go](../apps/api/internal/httpapi/replay.go) (line 38).

**Verified finding / consequence:** Workspace imports but never renders DecisionPanel, the only component offering the replay mutation. The server replay path and files exist, but ordinary users cannot launch fallback from this UI. startReplay also returns without an explicit error if a store exists but sim is nil (a defensive edge; main normally creates sim). Replay needs PostgreSQL; internet-offline does not mean database-independent.

**Required fix:** Mount a controlled, visible fallback/restart flow using the normal gateway path; distinguish replay, completion and live state throughout. Return explicit errors for missing dependencies and test SUMO/intelligence loss, missing replay files and database loss.

**Stories:** S26, S27, S35, S42, S44.

### A12 — High: Network requests have no client deadline or structured recovery policy

**Evidence:** [apps/web/lib/api.ts](../apps/web/lib/api.ts) (line 8); [apps/web/components/providers.tsx](../apps/web/components/providers.tsx) (line 9); [apps/web/lib/live.ts](../apps/web/lib/live.ts) (line 141); [apps/api/internal/httpapi/decision.go](../apps/api/internal/httpapi/decision.go) (line 507).

**Verified finding / consequence:** The shared request helper has no explicit timeout, does not retain HTTP status/code, and callers do not pass query cancellation signals. WebSocket reconnect is fixed at one second without jitter or replay cursor. Several handlers use request contexts without their own operation deadline. There is no dedicated offline/maintenance/session-expired flow.

**Required fix:** Define a bounded end-to-end deadline budget; distinguish offline, 401/403, 409, 429, 503/504, cancellation and uncertain commands; use bounded jittered reconnect/read retry and command reconciliation rather than automatic mutation replay.

**Stories:** S02, S06, S26, S35, S39, S42, S44.

### A13 — High: Production authentication and authorization do not exist

**Evidence:** [apps/api/internal/httpapi/server.go](../apps/api/internal/httpapi/server.go) (line 66); [apps/web/lib/state.ts](../apps/web/lib/state.ts) (line 23); [apps/api/internal/httpapi/decision.go](../apps/api/internal/httpapi/decision.go) (line 364); [apps/web/components/top-bar.tsx](../apps/web/components/top-bar.tsx) (line 199).

**Verified finding / consequence:** The role selector only changes client presentation; all actors are demo-operator and no authenticated session or server role enforcement is wired. Origin checking is not authentication. This is consistent with the old isolated demo allowance, but blocks shared production deployment and trusted audit identity. No payment or browser device-permission flow exists to audit.

**Required fix:** Retain explicit local demo persona labeling; require authenticated principals and per-route roles for shared production, service identity for private calls, and accessible expired-session/denied recovery without losing drafts.

**Stories:** S01, S08, S14, S15, S31, S39, S46.

### A14 — High: Start/reset retries and concurrent tabs can create extra runs

**Evidence:** [apps/api/internal/httpapi/simulation.go](../apps/api/internal/httpapi/simulation.go) (line 174); [apps/api/internal/httpapi/simulation.go](../apps/api/internal/httpapi/simulation.go) (line 216); [apps/web/components/action-rail.tsx](../apps/web/components/action-rail.tsx) (line 587); [apps/api/internal/httpapi/simulation.go](../apps/api/internal/httpapi/simulation.go) (line 203).

**Verified finding / consequence:** Pending buttons and a process-local mutex serialize some operations but do not deduplicate lost-response retries or multiple clients. Reset/start replace the active run without confirmation. launch cancels replay and changes manual/analysis state before CreateRun, although its failure text says simulation unchanged. There is no client reconciliation endpoint for an uncertain start.

**Required fix:** Use durable request idempotency and one active run owner; confirm replacement/reset, preserve old safe state until transition outcome is known, and reconcile the saved command after timeout or failover.

**Stories:** S05, S07, S27, S41, S43, S45.

### A15 — Medium: Navigation and form state have no location/history model

**Evidence:** [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 74); [apps/web/lib/state.ts](../apps/web/lib/state.ts) (line 21); [apps/web/components/action-rail.tsx](../apps/web/components/action-rail.tsx) (line 112).

**Verified finding / consequence:** Six sections use local state on one page; browser back/deep links do not represent sections, reload resets selection/mode, and changing sections unmounts drafts without a leave guard. Phase-keyed edits are not reset by recommendation ID, risking reuse for a new recommendation.

**Required fix:** Define URL/back/refresh behavior and preserve or deliberately discard drafts with confirmation; bind edits to run/recommendation version and restore authoritative mode from server.

**Stories:** S08, S10, S15, S45.

### A16 — Medium: Accessibility coverage is partial

**Evidence:** [apps/web/components/top-bar.tsx](../apps/web/components/top-bar.tsx) (line 102); [apps/web/components/junction-drawer.tsx](../apps/web/components/junction-drawer.tsx) (line 138); [apps/web/app/globals.css](../apps/web/app/globals.css) (line 1651); [apps/web/app/globals.css](../apps/web/app/globals.css) (line 167).

**Verified finding / consequence:** The custom health dialog has no Escape handler, focus management or expanded/controls association. Horizon tabs declare tab roles but have no arrow-key navigation or associated tabpanel. CSS contains small text and 34px action controls: a touch/readability risk, not a measured contrast or WCAG failure. Radix sheets, keyboard node activation, focus styles and reduced-motion rules are present.

**Required fix:** Test and fix focus/escape/return, tab semantics, announcements, screen readers, 200% text, 400% zoom, narrow viewport and virtual keyboard. Measure contrast and target sizes; document supported dark theme, do not claim an unmeasured accessibility pass.

**Stories:** S08, S10, S34, S38, S47.

### A17 — Medium: Incident, emergency and vision screens are partial

**Evidence:** [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 545); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 610); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 634); [services/simulation/engine.py](../services/simulation/engine.py) (line 130).

**Verified finding / consequence:** Incident/emergency pages show a network and static launch descriptions, not complete lifecycle/control/ETA/recovery panels. ActionRail checks emergency status active, while Engine emits scheduled/pre_clearance/priority/recovery/complete. Vision is placeholder content without a video pipeline or explicit unavailable label. These gaps coexist with working backend scenario logic.

**Required fix:** Render actual lifecycle enums and current-run data; expose planned incident controls through typed commands, show ETAs/recovery and unavailable states, and clearly mark optional CV unavailable until implemented.

**Stories:** S29, S30, S31, S32, S36, S37.

### A18 — Medium: API specification and runtime contract drift

**Evidence:** [apps/api/internal/httpapi/server.go](../apps/api/internal/httpapi/server.go) (line 174); [packages/contracts/openapi.json](../packages/contracts/openapi.json) (line 605); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 139); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 198).

**Verified finding / consequence:** OpenAPI omits GET mode, POST mode/recommend and mode/observe, and lock routes; manual start acceptance differs between Go, spec and Python. Scenario start is typed as Run in the client but returns a run_id/status summary; non-simulate decisions are typed as ComparisonResult but return Recommendation. Apart from network and stream parsing, HTTP response types are unchecked casts and malformed arrays/numbers can crash render paths.

**Required fix:** Keep exhaustive method/path/owner schemas and action-specific response types; validate runtime payloads and show recoverable invalid-data UI. Add error boundaries and route parity tests, including unknown methods/actions and version mismatch.

**Stories:** S02, S04, S06, S40, S44.

### A19 — Medium: Existing tests and completion reports do not establish production acceptance

**Evidence:** [scripts/verify-epic5.mjs](../scripts/verify-epic5.mjs) (line 67); [apps/api/internal/httpapi/decision_test.go](../apps/api/internal/httpapi/decision_test.go) (line 316); [docs/delivery-status.json](../docs/delivery-status.json) (line 4); [dashboard/app.js](../dashboard/app.js) (line 15).

**Verified finding / consequence:** Epic 5 browser checks mock API responses; lock tests mutate maps rather than exercising POST/DELETE persistence. Historical reports mark S01–S15 complete. Local dashboard tracking can override noncompleted repository status, so its progress bar is not a production gate. Fresh database-backed, failure-injection, real routing and visual accessibility acceptance is missing from this audit.

**Required fix:** Preserve historical evidence but reopen revised acceptance; distinguish mocked/component checks from real integration. Base release decisions on recorded command output, routes, fault cases and machine measurements, not progress percentages.

**Stories:** S01, S33, S35, S43, S48.

### A20 — Low: Documentation pointers and product copy retain stale implementation claims

**Evidence:** [docs/architecture.md](../docs/architecture.md) (line 33); [packages/contracts/README.md](../packages/contracts/README.md) (line 9); [README.md](../README.md) (line 5); [apps/web/components/workspace.tsx](../apps/web/components/workspace.tsx) (line 793).

**Verified finding / consequence:** Foundation-era text describes now-implemented RPCs as unimplemented; the delivery plan incorrectly said docs/PRD.md was absent although it is a symlink. Product UI includes internal PRD/epic labels. Historical snapshot docs/planning-dashboard is separate from the live dashboard data source.

**Required fix:** Keep historical evidence dated and link authoritative current architecture/audit; remove internal planning labels from production copy when implementing UX fixes. Use canonical docs/backlog.json rather than the archival dashboard snapshot.

**Stories:** S01, S08, S34, S48.

## API routing inventory: current implementation

All product HTTP paths below use `/api/v1`; WebSocket uses `/ws/v1/live`. Verified against `apps/api/internal/httpapi/server.go`, all handler files, active frontend call sites and `packages/contracts/openapi.json`. "Matches" means a static method/path/handler match, not a successful live request or full contract conformance. Route owners in the target design are logical Go boundaries; separate deployment of each module is not assumed.

| Method / path | Current owner and downstream | Active browser usage / result | Target owner behind Python gateway |
|---|---|---|---|
| GET /network | Go config in memory | getNetwork; matches; silent fallback A04 | Go traffic: configuration |
| GET /state | Go cached simulation | No current REST caller; stream preferred | Go traffic: state |
| GET /junctions/{id} | Go config only | No current caller; drawer derives locally; PRD's current/forecast response not implemented | Go traffic: junction query |
| GET /health | Go + DB ping + cached compute health | Workspace; matches | Gateway aggregation + Go dependency health, including writer |
| GET /runs | Go → PostgreSQL latest 50 | Workspace; matches | Go query, read-only DB access |
| POST /runs | Go transaction: run + audit | No active UI caller | Go lifecycle result → gateway → Go writer |
| GET /audit | Go → PostgreSQL cursor query | Workspace; matches path but ignores cursor | Go query, read-only DB access |
| GET /analysis | Go cached Python Analyze | Workspace polls; matches; stale handling A06 | Go intelligence orchestration |
| GET /recommendations/active | Go cached recommendation | No current UI caller; freshness differs from analysis endpoint | Go decision query |
| POST /recommendations/{id}/simulate | Go safety → Python Compare → Go audit | Workspace; matches | Go decisions/compute; durable command result via writer |
| POST /recommendations/{id}/approve | Go safety → durable intent → Python ApplyPlan → audit | Workspace; matches; uncertain outcome A09 | Go decisions + writer intent/result orchestration |
| POST /recommendations/{id}/modify | Go safety → Python Compare → intent → ApplyPlan → audit | Workspace; matches; notes loss A05 | Go decisions + writer intent/result orchestration |
| POST /recommendations/{id}/reject | Go audit and status writes | Workspace; matches; ignored write error A09 | Go decisions → gateway → writer |
| POST /scenarios/{type}/start | Go create run → Python Reset → Go activation/audit | Workspace; matches route, mode/response drift A07/A18 | Go lifecycle with writer intent/activation |
| POST /scenarios/reset | Go previous command → launch flow | Workspace; matches | Go lifecycle; durable idempotent reset |
| GET /mode | Go memory | Not called by current UI; omitted OpenAPI | Go control query |
| POST /mode/{mode} | Go DB/audit + memory; accepts recommend/recommendation/observe/manual | Workspace uses recommend/observe/manual; SQL defect A07. Spec only manual/recommendation | Go control; writer-backed canonical transition |
| GET /locks | Go memory | No active UI caller; omitted OpenAPI | Go control query of durable locks |
| POST /locks/{id} | Go memory + best-effort audit | No active UI caller; omitted OpenAPI | Go control → gateway → writer |
| DELETE /locks/{id} | Go memory + best-effort audit | No active UI caller; omitted OpenAPI | Go control → gateway → writer |
| POST /replay/{scenario} | Go file/checksum → DB run/activation → replay stream | Only unmounted DecisionPanel; inaccessible active UI | Go replay; writer-backed lifecycle |
| GET upgrade /ws/v1/live | Go per-client event stream, nine event types | useLive consumes network.state and simulation health only | Python gateway stream proxy → owning Go run service |

The dynamic decision route dispatches only simulate/approve/modify/reject; other actions return 404. Router unknown methods/paths must remain explicit failures in migration. No active frontend endpoint was found routed to the wrong existing handler. **None currently travels through the requested Python gateway/Go writer.** Contract omissions and semantic bugs above prevent an "all APIs correct" conclusion.

Private RPC ownership: Simulation implements ValidateState, Reset, GetState, StreamState, ApplyPlan and Stop; Go calls Reset/StreamState/ApplyPlan/Stop. Intelligence implements ValidateState, Analyze, Compare and Predict; Go calls Analyze/Compare. Go Analyze polls every five seconds. These Python workers should remain private behind their Go domain owner; migration does not require rewriting SUMO/ML in Go. Current listeners are single configured addresses, not demonstrated health-aware load balancing.

The separate local planning server exposes GET `/api/plan`, `/api/git` and `/evidence/epic1`…`epic5` (also e01…e05 aliases), plus static assets. It reads planning documents/Git, does not control traffic or write business data, and is outside the product gateway migration. The archived `docs/planning-dashboard` artifact is not the source used by this server.

## Verification actually performed

- `npm run test:ui`: **33 passed, 6 test files**. This is jsdom/component evidence, not visual or integrated acceptance.
- Python shared, safety, service and intelligence suites: initial sandbox run **26 passed, 1 failed** because SUMO could not obtain its local socket. Same command rerun with approved local socket access: **27 passed**. Command: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m pytest -p no:cacheprovider services/shared services/simulation/tests/test_safety.py services/simulation/tests/test_service.py services/intelligence/tests -q`. Includes one real SUMO peak-surge lead-time test; the full engine suite was not run.
- `GOCACHE=/tmp/traffic-audit-go-cache go test -v ./apps/api/... ./db/...`: initial sandbox blocked sockets. Approved rerun passed non-database checks, but the overall command **failed**: TestStartResetFailureAndAuditedLifecycle and TestPostgresDurabilityAndAtomicAudit could not connect to PostgreSQL at 127.0.0.1:5433. TestLaunchFailureModes skipped on the same unavailable DB; TestPythonRoundTrip skipped because SIMULATION_GRPC_ADDR was not set. This does not prove application DB behavior passes or fails. No database service was started for this audit.
- Existing browser acceptance scripts reviewed; some mock APIs. They were not rerun and their prior outputs are not current production proof. Build/typecheck/performance and live deployment checks were not run for this documentation-only change.
- Documentation validation **passed**: 14 epics / 45 unique stories, all dependency references valid with no cycles, all 35 original stories present, Markdown/JSON story headings in agreement, 15 historical acceptance records retained, 20 finding IDs and local document links valid. PRD symlink preserved; `git diff --check` passed. SHA-256 comparison against the pre-document snapshot confirmed application source, configuration, contracts and scripts were unchanged.

## Mandatory delivery sequence and post-launch recommendations

1. **Truth and operator recovery:** A02–A07, A10–A12, A17. Remove invented values and false-safe states, expose failures, restore reachable fallback, reconcile mode and preserve drafts. Revalidate on the active Workspace, not the old component alone.
2. **Durable control:** A08–A09, A14. Correct database transactions/order, durable idempotency and unknown-outcome reconciliation; validate safety immediately before dispatch and confirm eventual applied state. Test real DB failures and concurrent clients.
3. **Requested architecture:** A01, A18; E13/S39–S43. Build explicit route ownership and Python gateway, isolate the Go writer, preserve read/stream paths, add run ownership and measured failover/load tests. Do not double-write during cutover.
4. **Production access and complete UX:** A13, A15–A16; E14/S44–S48. Enforce roles on server and private service boundaries; finish denied/expired/maintenance/offline paths, navigation, accessibility and true screen-specific states.
5. **Release evidence:** rerun real three-scenario journeys with PostgreSQL, gateway, writer and compute; failure injection, all-route parity, offline/replay, accessibility and performance/soak. Record limitations, unresolved IDs and owners. No Critical/High finding may remain open for its applicable release scope; critical-flow Medium gaps must also close.

After launch: tune measured latency/capacity and reconnect policy, observe failure/recovery rates without logging unnecessary sensitive content, refine optional CV/charts, add alternative themes only if required, and clean low-priority internal planning labels. Do not postpone truthful data, authorization, safety/audit integrity or operator recovery as polish.

## Assumptions and decisions, separated from findings

- User-requested target is interpreted as **Frontend → Python gateway → owning Go domain service → Python gateway → Go DB writer → PostgreSQL**, with acknowledged durable results returned to the frontend. This is a future requirement, not the current implementation.
- "Write the Go result" means typed validated durable business-command results, not arbitrary SQL or every GET/health/WebSocket frame. Existing PRD explicitly avoids frame-by-frame database writes; persistence classification in §32 makes that boundary reviewable.
- Existing Python SUMO/intelligence workers remain internal compute dependencies of Go services. Go domain owners may initially share a process; the gateway and writer are explicit boundaries. No throughput, replica count, identity provider or deployment platform was supplied; those need measured sizing/design during implementation.
- Payments/device permission flows stay not applicable unless future CV requests browser devices or paid features are introduced. Static serving without internet is not proof of first-load browser offline support or service failure recovery.

## Documentation changes completed by this audit

Updated the root PRD (and its existing docs/PRD.md symlink), all 12 original epics and 35 original stories, and added E13/E14 with S39–S48 for a total of 14 epics and 45 stories. Canonical JSON and the human-readable delivery plan agree. Added current/target architecture distinctions and historical revalidation notices; preserved all 15 previous completion records in delivery-status.json rather than deleting their evidence. Corrected the delivery-plan symlink statement. These address documentation portions of A19/A20 only; runtime findings remain unresolved. The archival standalone docs/planning-dashboard snapshot was left unchanged because the live dashboard uses docs/backlog.json.

No fixes, refactors, new runtime services, dependency changes, deployment changes or commits were made. The two pre-existing frontend changes remain intact. Temporary audit-generation/check scripts and Go compilation cache were placed under /tmp; existing test tools may create ignored runtime/cache artifacts. New code tests were not authored.
