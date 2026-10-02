# A02/P01 local startup guidance repair — 2026-10-02

The supplied screenshot shows a correctly signed-out workspace. On the target host, Vite, Go and PostgreSQL responded and a private operator account existed. User requested its password reset; the reset preserves other accounts and increases operator credential version, invalidating prior sessions. Password and runtime artifacts remain ignored and private.

Branch `task/A02-startup-guidance`, isolated worktree from `67d3551`. No generated contracts, Workspace or decision hotspot changes.

Changes: launcher checks that a private account file contains a usable account before launching application services, with explicit provisioning/permission errors; startup banner explains login and explicit scenario start. SessionPanel provides expandable local account/reset instructions and explains seeded versus processed-video demand and unavailable pre-run metrics. README corrects stable ports and Vite naming. Session browser probe checks help is visible.

Two launcher regressions failed before implementation; signed-out help regression also failed before implementation. After repair: 7 launcher tests and full web suite (148 tests) passed, TypeScript and Vite production build passed; diff whitespace check passed. Real browser verification is recorded below after integration.

No authentication bypass or automatic run/replay is introduced. This repairs access/setup clarity; it does not close recorded-video, measurement/control or full-prototype gates.
