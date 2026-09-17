# Platform Delivery — Traffic Digital Twin

A local task dashboard inspired by the supplied references, with a dark grid canvas, lime accents, animated cards, readiness summary and responsive sidebar.

## Run

From the repository root, with Node.js 18 or newer:

```sh
node server.mjs
```

Open the URL printed in the terminal. The server starts at port 3001; if occupied, it automatically tries the next port (up to 20 retries) without stopping other processes. To choose a starting port: `PORT=3101 node server.mjs`. Use `PORT=0` to let the operating system select an available port. Invalid ports produce a readable error. Press Ctrl+C to stop the server and release its port.

From inside `dashboard/`, simply run `node server.mjs`, or from the repository root use `node server.mjs`. If another dashboard instance is already running, you can also use its existing URL. Personal tracking is browser-origin specific: a different port has separate localStorage, so use the original URL to retain the same tracking view.

No packages, build step, internet connection or external fonts are required. Open through the server, not directly as a file.

## Folder structure

```text
dashboard/
  app.js
  index.html
  README.md
  server.mjs
  styles.css
```

## Features

- All 12 epics are broken down into the existing 35 source-backed task cards. Each card identifies its parent epic and task position, priority, responsible team, dependencies, day window and expandable acceptance criteria.
- Search `11`, `E11`, `epic11`, `EPIC-11` or `Epic 11` for Epic 11's tasks; the same aliases work for every epic. A bare number is an exact epic search, so `1` does not mix in Epics 10–12. Use `S11` to find story S11. Ordinary text searches titles, requirements and acceptance criteria.
- Epic and priority dropdowns combine with status filtering and execution/priority/title sorting. P0 is High / Essential, P1 is Medium / Important, and P2 is Low / Optional, preserving the source plan's priority policy.
- Epic overview lists each epic's individual tasks with their priorities. Click a task for details or use “View all task cards” to open that epic's complete breakdown. This drill-down clears previous filters; “Clear filters” returns the full backlog.
- Kanban with five status columns. Open a task and change its status to move it between columns.
- Epic overview with progress and task drill-down; planning risks and scope decisions; read-only Git snapshot.
- Readable task modal with objectives, acceptance criteria, dependency navigation, source references and the original structured record.
- Personal status tracking persisted in this browser's localStorage. Refresh reloads repository data while retaining personal tracking.
- Keyboard search shortcut `/`, native modal Escape/focus handling, visible focus styles, animation pause and reduced-motion support.

## Data and boundaries

The server reads `../docs/backlog.json` on every refresh. The current source contains 35 proposed stories across 12 epics. Unverified stories begin in Backlog. Repository progress is loaded from `../docs/delivery-status.json`; accepted completion records with evidence take precedence over personal tracking. The task modal links to the recorded checks. Readiness includes both repository completion and personal status tracking, with the verified count labelled separately. The next eligible task is calculated from dependencies marked completed. Ready/Blocked are manually tracked statuses, not automatic safety checks.

The original planning dashboard and backlog remain unchanged. This is a delivery documentation tool, not the operational Traffic Digital Twin application. It does not implement traffic control or replace the required product architecture.

Git status uses local Git commands without a shell. If this workspace has no usable Git metadata, the view reports that explicitly. The server binds to loopback only, exposes an explicit static/API/evidence allowlist, and never writes repository data.
