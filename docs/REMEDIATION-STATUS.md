# Remediation checkpoint — 2026-09-18

**Not production-ready. No audit gap is declared fully closed by this checkpoint.**
The original audit is a historical source review. The supplied backend and API-concepts specifications now control implementation: Go is the public gateway and persistence owner; Python is private gRPC compute. Passing component checks does not satisfy remaining release gates.

## Verified checks in this continuation

- `npm run test -w apps/web -- --reporter=json --outputFile=/tmp/traffic-ui-results.json`: **35 passed, 0 failed**. Updated outdated assertions and added absent-comparison and signed/zero-baseline outcome checks.
- `npm run typecheck -w apps/web`: **passed**.
- The Python public-gateway test has been retired because a Python public gateway is out of scope. `scripts/verify-epic5-integration.py` now exercises the direct Go gateway, private Python gRPC compute, migration, and audited scenario-start path in a local Docker runtime.
- `GOCACHE=/tmp/traffic-audit-go-cache go test ./apps/api/... ./db/...`: **passed**, with local network permission and real PostgreSQL. Extended the isolated-schema persistence test for all three modes, invalid lock targets, rollback when unlock audit fails, actor/payload command conflicts and completed-command deduplication.
- Python syntax compilation passed for gateway and startup/bootstrap scripts.

## Changes verified or inspected during this continuation

- Gateway streams, public requests and private writer requests now have separate capacity limits. A saturated stream pool cannot consume the writer pool.
- Invalid login/private envelope shapes return errors; incomplete request bodies are rejected. Rejected requests close their connection so unread bodies cannot become subsequent requests.
- Command payload hashing canonicalizes object key order. Changed-payload/actor conflicts are distinguished from uncertain dispatched commands.
- Analysis publication rechecks mode and same-recommendation decision status after persistence, preventing a late save from restoring a pending recommendation after approval/rejection. This race fix was compiled and covered by the existing Go suite, but lacks a dedicated concurrent regression test.
- UI tests now assert real aggregate metrics, unavailable comparison states, server-assigned role display and server-validation requirements, rather than fabricated outcomes or unsupported safety guarantees.
- README and environment examples describe the new private writer/gateway startup boundary. Full startup has not been verified in this continuation.

## Remaining work, by original gap

| Gap | Current evidence and remaining acceptance |
| --- | --- |
| A01 | Gateway/writer code exists; require end-to-end routing, ownership fencing, restart and failover tests. Lease routing alone is insufficient for stateful load balancing. |
| A02 | Fabricated comparison fallback removed; signed and zero-baseline tests pass. Add cross-run/recommendation and live integration checks. |
| A03 | Several unsupported narratives removed. Complete screen-by-screen provenance review. |
| A04 | Unknown/fallback/error states added. Verify stale dependencies disable every relevant control. |
| A05 | Mutation errors and draft handling added. Draft lifetime across analysis loss/remount still needs correction and tests. |
| A06 | Freshness/identity checks added; late analysis publication guarded. Complete superseded-request and decision concurrency tests. |
| A07 | Parameterized mode persistence passes real PostgreSQL tests for all modes. Python/manual and reload/reconnect acceptance remain. |
| A08 | Durable validated locks and atomic audit rollback pass database tests. Restart restoration and concurrent application remain. |
| A09 | Durable command reservation/deduplication tests pass. Simulator intent/result/audit are not yet one reconciled lifecycle; restart/unknown resolution remains a blocker. |
| A10 | History pagination and event invalidation added. Test more than 100 events, reconnect cursors and multiple clients. |
| A11 | Replay controls mounted and missing simulation dependency returns an error. Run fault-injection acceptance. |
| A12 | Client deadlines/reconnect and unknown-command UI added. Measure the full deadline budget; writer/owner/dispatch calls can exceed the intended aggregate bound. |
| A13 | Gateway sessions, roles and service tokens added. Private compute authentication, stream revocation, transport deployment and session recovery remain. |
| A14 | Durable gateway command deduplication exists. Owner failover, uncertain run transitions and multiple tabs remain unverified. |
| A15 | URL navigation and draft confirmation added. Back-cancellation URL consistency and draft lifetime remain. |
| A16 | Initial semantics/focus/target changes exist. No measured contrast, zoom, keyboard, screen-reader or responsive acceptance yet. |
| A17 | Actual incident/emergency state and optional-CV disclosure added. Typed incident controls and lifecycle acceptance remain. |
| A18 | Runtime schemas and representative Go/gateway route-family checks added. Complete action-specific schemas, OpenAPI parity and invalid-data recovery tests. |
| A19 | New check results above are recorded; historical acceptance remains historical. Full-stack, fault, race, load and accessibility evidence still required. |
| A20 | Current startup and checkpoint pointers corrected. Finish historical-document/product-copy consistency review. |

## Next mandatory sequence

1. Fence owner epochs at persistence and simulator mutation boundaries; authenticate private compute calls. Do not enable multi-owner deployment based on the lease alone.
2. Implement durable intent/dispatch/outcome reconciliation, including restart and supervisor resolution of uncertain commands.
3. Verify complete gateway → Go → gateway → writer → PostgreSQL flows, every route/action, read-only domain credentials and dependency failures.
4. Correct draft/back-navigation edge cases; verify replay, sessions, stale responses, pagination and duplicate submissions across tabs.
5. Run measured accessibility/responsive checks and production fault/load acceptance. Only then close individual gaps and revise story acceptance.

No deployment, production approval or claim of all 20 gaps being fixed is implied.
