# A02/P01 local startup guidance repair — 2026-10-02

The supplied screenshot shows a correctly signed-out workspace. On the target host, Vite, Go and PostgreSQL responded and a private operator account existed. User requested its password reset; the reset preserves other accounts and increases operator credential version, invalidating prior sessions. Password and runtime artifacts remain ignored and private.

Branch `task/A02-startup-guidance`, isolated worktree from `67d3551`. No generated contracts, Workspace or decision hotspot changes.

Changes: launcher checks that a private account file contains a usable account before launching application services, with explicit provisioning/permission errors; startup banner explains login and explicit scenario start. SessionPanel provides expandable local account/reset instructions and explains seeded versus processed-video demand and unavailable pre-run metrics. README corrects stable ports and Vite naming. Session browser probe checks help is visible.

Two launcher regressions failed before implementation; signed-out help regression also failed before implementation. After repair: 7 launcher tests and full web suite (148 tests) passed, TypeScript and Vite production build passed; diff whitespace check passed. Real browser verification is recorded below after integration.

No authentication bypass or automatic run/replay is introduced. This repairs access/setup clarity; it does not close recorded-video, measurement/control or full-prototype gates.

## Integrated verification

- Fast-forwarded main to `bb39d0a`; repeated launcher tests (7), web suite (148), TypeScript check and production build successfully.
- Real `node scripts/verify-session-startup-live.mjs` passed: signed-out idle/help, password/cookie login, six-node v5 network, server revocation, stopped polling, re-login and logout. Disposable schema/accounts/processes cleaned up.
- Actual user's reset account authenticated against the existing stack on 3100/8081. Explicit seeded peak start returned HTTP 200 and a running run. Browser inspection confirmed simulation time 95s, live seeded demand, all six nodes, queues, phase countdowns and horizon forecasts, with no JavaScript errors. Saved ignored `.runtime/startup-verified.png`. Synthetic run remains active for operator inspection; no approval or physical actuation performed.
- Host Go API/store/db tests passed with PostgreSQL. Initial sandbox run failed because sockets were forbidden; repeated on host successfully.
- Real Python shared/simulation/intelligence suites: 125 passed. Full Python suite collection fails because local `.venv` lacks `cv2`; no mocked acceptance or recorded-video processing claim. Vision dependency setup remains outside this access repair.
- Browser decision support rejected an advanced snapshot as expected; a safe actionable plan is not claimed by this startup check. Source-video times are unavailable for this synthetic run.
- New operator password is saved only in mode-0600 `.runtime/operator-login.txt`. Other accounts, database history and source media preserved. No password printed in tools, tests or git.
