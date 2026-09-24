# Epic 12 acceptance evidence — optional vision analytics and presentation polish

**Status:** completed on the `epic12` branch.

Epic 12 delivers the computer vision edge analytics pipeline, interactive video overlays, aggregate metric extraction, upstream corridor impact forecasting for Junction C1, and presentation motion polish for the Predictive Traffic Digital Twin. All capabilities strictly adhere to human authority, non-Odisha sample feed provenance, camera-local privacy constraints (no ANPR, no facial recognition, no cross-camera identity tracking), and core scenario independence.

## S36 — Convert one sample video into traffic aggregates

- **OpenCV & Tracking Pipeline (`services/vision/pipeline.py`):**
  - Processes intersection camera footage (640 × 480 @ 10 fps) using OpenCV background modeling (`cv2.createBackgroundSubtractorMOG2`) and IoU/Euclidean center tracking.
  - **Directional Crossing Line:** Evaluates crossing at virtual stop bar coordinate `y = 360`. Counts each tracked vehicle strictly once upon forward transition across the line segment.
  - **Polygonal Lane ROIs:** Uses `cv2.pointPolygonTest` to assign vehicle bottom-center positions to Lane 1 (Left / Turning), Lane 2 (Through / Main), and Lane 3 (Through / Curb).
  - **Queue Detection ROI:** Polylines boundary at `y in [240, 360]`. Marks vehicles as queued when velocity drops below threshold for consecutive frames inside the polygon.
  - **5 Vehicle Classes (PRD §15.2):** Classifies detections into `bike`, `car`, `auto` (auto-rickshaw), `bus`, and `truck`.
  - **Uncalibrated Speed Estimate (PRD §8.5, S36):** Measures pixel displacement ratio scaled to km/h, strictly tagged as `is_calibrated = false` and labeled `"demo estimate"`.
  - **Upstream C1 Corridor Forecasting:** Computes expected vehicle arrivals toward Junction C1 for +30s, +60s, and +120s horizons, travel time ETA ranges (42s–68s), and corridor risk index.
- **Privacy & Governance Guarantees:**
  - Track IDs are camera-local and temporary (`CAM3-TK-001`, `CAM3-TK-002`, ...); destroyed upon exit.
  - Zero Automated Number Plate Recognition (ANPR).
  - Zero facial recognition.
  - No cross-camera identity tracking across intersections.
  - Non-Odisha sample video disclaimer permanently watermarked on video frames and API payloads.
- **Go Public API Gateway Route (`GET /api/v1/vision/{id}`):**
  - Serves typed JSON traffic aggregates for junction C3 (`apps/api/internal/httpapi/server.go`).
  - Gracefully handles offline query parameters (`?status=offline`) or missing video with HTTP 200 containing `available: false` and explanatory problem narrative.
  - Rejects unmonitored junctions with HTTP 404.
  - Tested in Go test suite (`apps/api/internal/httpapi/server_test.go:TestVisionEndpoint`).

## S37 — Show optional vision overlays and upstream impact

- **Vision Analytics Workspace Section (`apps/web/components/vision-analytics-panel.tsx`):**
  - Accessible via primary sidebar navigation (`Vision Analytics` tab).
  - **Interactive HTML5 Canvas Viewport (640 × 480):**
    - Renders the 3-lane perspective roadway and camera feed.
    - Toggleable overlay layers:
      - Bounding boxes with class-colored borders (`car`: blue, `bike`: green, `auto`: amber, `bus`: red, `truck`: purple).
      - Temporary track IDs and class tags.
      - Lane boundary divider polygons.
      - Directional virtual counting line with crossing pulse indicator.
      - Queue ROI polygon fill with queue occupancy badges.
  - **Transport & Scrubbing Controls:**
    - Play / Pause toggling (10 fps animation loop, keyboard accessible with `Space`).
    - Step Forward / Step Backward single-frame transport (`ArrowRight` / `ArrowLeft`).
    - Interactive range scrubber slider scrubbable across all 240 frames with millisecond timestamps.
    - Playback speed selectors (`0.5x`, `1.0x`, `2.0x`).
  - **Real-Time Aggregate Panels:**
    - Live speed banner: `30.5 km/h (demo estimate)` with note: `Uncalibrated demo speed estimate; not for legal or certified enforcement`.
    - Class breakdown metrics grid with individual vehicle counters for Bike, Car, Auto, Bus, Truck.
    - Lane flow & queue metrics table displaying Flow rate (vpm), Queue length (veh), and Occupancy percentage (%).
  - **Upstream Impact on Corridor Junction C1 (PRD §8.5):**
    - Downstream corridor link: `C3 North Approach ➔ C1 Junction (Link C3-to-C1, 480m)`.
    - Arrival forecasts: `+30s Horizon` (8 veh), `+60s Horizon` (16 veh), `+120s Horizon` (33 veh).
    - Estimated Travel Time / ETA range: `42s – 68s`.
    - Risk classification badge (`MODERATE RISK`) with explanatory narrative explaining downstream queue forecasting.
  - **Honest Offline & Fallback State (Finding A17):**
    - Simulated offline toggle permits testing disconnected pipeline states.
    - Renders explicit notice: *"Optional computer vision sample-video extraction is currently unavailable or disconnected. Core synthetic scenarios and golden replay remain 100% independent of computer vision feeds."*
    - Provides single-click "Reconnect Sample Feed" and "Return to Command Center" recovery paths.

## S38 — Refine optional charts and motion

- **Restrained Motion Timing:**
  - All interactive UI element transitions configured to 150–250ms (`transition: all 180ms ease-out`).
  - Smooth frame-by-frame vehicle motion interpolation.
- **Single-Pulse Alerts:**
  - Critical alerts and counting line triggers use `.pulse-once` (`animation: single-pulse 300ms cubic-bezier(0.16, 1, 0.3, 1) 1 forwards`), pulsing exactly once rather than looping continuously.
- **Full Reduced-Motion Compliance:**
  - Verified `@media (prefers-reduced-motion: reduce)` overrides: disables canvas trail animations, eliminates nonessential transitions, and renders instant frame updates.
- **Accessible Design & High Contrast:**
  - Interactive buttons and transport controls exceed 44px touch target standards.
  - WCAG 2.1 AA text contrast ratio (>= 4.5:1).
  - Status is never conveyed by color alone: accompanied by text tags (`Low`, `Moderate`, `High`, `Active`, `Paused`, `Queued`, `Crossed`).
  - Mobile responsiveness verified at 390 × 844 iPhone standard viewport with zero horizontal overflow.

## Verification Commands

- `npm run typecheck` — passed: TypeScript types checked across all workspaces.
- `npm run test:ui` — passed: 82 UI tests in Vitest across 14 test suites, including 8 new tests in `apps/web/components/epic12.test.tsx` for Vision Analytics, overlays, transport, class distribution, and offline recovery.
- `npm run build` — passed: Vite production build succeeded in 873ms.
- `GOCACHE=/tmp/traffic-go-build-cache go test ./apps/api/...` — passed: all Go unit and integration tests passed, including new `TestVisionEndpoint` covering active C3 vision, offline simulation, and 404 junction rejection.
- `PYTHONPATH=.:packages/contracts/gen/python .venv/bin/python -m pytest services/simulation/tests/ services/intelligence/tests/ services/vision/tests/ -v` — passed: 34 Python deterministic simulation, intelligence, and vision pipeline tests passed.
- `node scripts/verify-epic12-browser.mjs` — passed: Playwright E2E browser verification on desktop and mobile viewports, generating `docs/screenshots/epic12-desktop.png` and `docs/screenshots/epic12-mobile.png`.
- `DASHBOARD_URL=http://127.0.0.1:3013 node scripts/verify-dashboard.mjs` — passed: dashboard displays Epic 12 completed with evidence links.

## Residual Limits

- Computer vision processing is scoped strictly to the sample video feed attached to Junction C3 North Approach. Physical CCTV ingestion is not enabled in this synthetic demonstration.
- Vehicle speeds are estimated from perspective pixel displacement and explicitly disclosed as uncalibrated demo estimates. They must not be used for speed enforcement.
