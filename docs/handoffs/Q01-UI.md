# Q01 UI refinement

Scope: operator workspace presentation and actual request feedback. No contract, backend, control policy or acceptance-gate changes.

- Replaced the violet shell with slate surfaces and blue primary controls; unified cards, navigation, button sizing, focus outlines, session controls and source/model clock tiles.
- Added reusable request-bound skeletons and busy buttons for session, topology, camera registry, audit, health, saved-run queries, clock controls, scenario start/reset, command reconciliation and report export. Operator-command progress leaves drafts and existing data mounted. Background polling does not block the workspace.
- Decorative animation is hidden from assistive technology and disabled for reduced-motion preferences. Loading buttons retain their independent permission-disabled state after requests finish.
- Regression-first: loading suite initially failed because the primitive was absent. Focused regressions now verify duplicate-submit prevention, accessible status, permission preservation, and deferred session resolution.
- Validation: full web suite 141 tests; TypeScript check and production build. Existing build advisory: main JS chunk exceeds 500 kB. Browser checked emergency/network presentation and 390-pixel navigation; viewport restored. Screenshot /tmp/traffic-ui-redesign.png.

Files: apps/web/app/globals.css, components/ui/{button,loading,loading.test}.tsx, components/session-loading.test.tsx, session-panel.tsx, workspace.tsx, action-rail.tsx, operator-time-status.tsx, vision-analytics-panel.tsx, emergency-corridor-panel.tsx, incident-recovery-panel.tsx.

The six engineering prototype gates retain their existing open/failed status. External publishing is still awaiting user authorization after automatic approval review rejected the earlier GitHub push; this UI work is local.
