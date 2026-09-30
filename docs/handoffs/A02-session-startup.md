# A02 signed-out loading repair — 2026-09-30

## Reproduction and cause

The supplied screenshot and local screen recording showed the sign-in form, a false authenticated viewer label, an intermittently appearing viewer briefing banner and an endlessly resetting network loading panel. Three focused Workspace regressions reproduced the failure before implementation, including repeated protected requests while signed out.

Workspace fetched network, health and run data before authentication. Each protected 401 emitted `session-expired`; SessionPanel removed active queries and invalidated the session again. Removing queries restarted the protected reads. Meanwhile, setting session data to null made TanStack Query's `isSuccess` true, enabling mode/decision polling and viewer claims despite there being no authenticated identity. Tailwind's form reset also left the sign-in inputs without visible borders/backgrounds.

## Changes and ownership

Isolated branch: `task/A02-session-startup`, based on `e235e09`. No other task owner was active; the requested repair includes the Workspace hotspot.

- `apps/web/components/session-panel.tsx`: treat session GET 401 as a stable null identity, and handle protected-request expiry once per authenticated identity. Retain drafts/uncertain command identity and the existing server login/command recovery flow.
- `apps/web/components/workspace.tsx`: require an actual successful session identity for all protected queries, WebSocket subscription, role banners and operator actions. Render a clear sign-in state when protected topology loading is disabled.
- `apps/web/lib/live.ts`: allow the Workspace to disable the stream, close/cancel reconnect attempts on sign-out and require a newly received frame after re-login. Ignore callbacks from disposed connections; retain the last frame for draft recovery without treating it as fresh.
- `apps/web/components/top-bar.tsx`: display authenticated role only from the supplied server identity; display Signed out otherwise.
- `apps/web/app/globals.css`: visible, accessible username/password inputs with borders, backgrounds, text contrast and 44px minimum height.
- `apps/web/components/workspace-session.test.tsx` and `epic3.test.tsx`: signed-out request/stream gating, null-session cache handling, truthful role/loading states, login topology loading and expiry recovery.
- `scripts/verify-a02-browser.mjs`: extend the deterministic browser fixture to cover stable signed-out idle, visible fields, topology after login and stopped polling after expiry. Preserve uncertain-command lookup without resubmission.
- `scripts/verify-session-startup-live.mjs`: real browser password login/revocation/re-login/logout probe using separate Go/Python/Vite ports, a disposable PostgreSQL schema and private temporary credentials. Preserve existing accounts/runs; remove probe processes/schema/credentials afterward.

No Go authorization change, public schema change, protobuf change or authentication bypass was introduced.

## Verification

- Three new Workspace regressions failed before the implementation and passed afterward. The focused Workspace/session recovery/live suite passed 23 tests.
- Full web suite: 120 tests passed across 24 files.
- `npm run typecheck -w apps/web`, `npm run build -w apps/web` and `git diff --check`: passed.
- `node scripts/verify-a02-browser.mjs`: browser fixture passed; no protected polling while signed out, six-node topology after login, retained uncertain command, no command resubmission and no page errors. This fixture uses mocked HTTP/WebSocket responses.
- `node scripts/verify-session-startup-live.mjs`: passed with real Go, PostgreSQL, Python gRPC and Chromium. Checked unauthenticated idle without protected reads, password/cookie login, server-returned `c1-c6-v5` and six-node topology, server session revocation, stopped polling, re-login and logout. Used isolated ports 8083/50061/50062/3116 and cleaned up its disposable schema/account/processes.
- Inspected browser screenshots at `/tmp/traffic-a02-live-signed-out.png` and `/tmp/traffic-a02-live-signed-in.png`. Source screen recording and credentials were not copied into git.
- Integrated into main by fast-forward as `482e2c7`. Re-ran the web suite (120 passed), direct-venv Python suite (143 passed), Go/API/PostgreSQL suites, typecheck and production build successfully after integration.
- Re-ran the real Go/PostgreSQL/gRPC/Chromium login, six-node topology, revocation, idle, re-login and logout probe on the integrated main build: passed. Probe processes and its schema/credentials were cleaned up.

## Remaining scope

The command center requires a provisioned server account. A signed-out browser receives an explicit sign-in screen; no virtual run starts automatically. This repair verifies session/loading behavior, not fresh recorded-video processing, complete operator decision/application acceptance or the six prototype gates. Existing synthetic/virtual/physical-control labels and safety gates remain in force.
