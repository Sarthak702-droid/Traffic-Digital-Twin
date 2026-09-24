# Web workspace guidance

This app is React/TypeScript on Vite. Use `apps/web/package.json` and the root `AGENTS.MD` for current stack, milestone and acceptance rules; older Next.js instructions do not apply.

Keep operator commands on the authenticated Go API path. Display source observations, modeled state and forecasts with their distinct times and quality labels. Clear stale analyses after authoritative input changes, and preserve decision drafts plus command identity through session expiry. Use the existing component and schema patterns; add focused Vitest coverage for changed behavior and run `npm run typecheck -w apps/web` and `npm run build -w apps/web` when touching the UI.
