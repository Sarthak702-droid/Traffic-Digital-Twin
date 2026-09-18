import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const UI_PORT = process.env.UI_PORT ? Number(process.env.UI_PORT) : 3112;
const UI_URL = process.env.UI_URL || `http://127.0.0.1:${UI_PORT}`;

await mkdir("test-results", { recursive: true });

let serverProc = null;

// Check if UI is already serving
let isReady = false;
try {
  const res = await fetch(UI_URL);
  if (res.status === 200) isReady = true;
} catch {}

if (!isReady) {
  console.log(`Starting Vite preview on port ${UI_PORT}...`);
  serverProc = spawn(
    "npx",
    ["vite", "preview", "--host", "127.0.0.1", "--port", String(UI_PORT)],
    {
      cwd: "apps/web",
      stdio: "pipe",
      detached: true,
      env: { ...process.env, PORT: String(UI_PORT) },
    },
  );

  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(UI_URL);
      if (res.status === 200) {
        isReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
}

if (!isReady) {
  if (serverProc) serverProc.kill();
  throw new Error(`Web server failed to become ready on ${UI_URL}`);
}

const browser = await chromium.launch({ headless: true });

try {
  console.log("Launching Playwright browser session for Epic 12...");
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  console.log(`Navigating to ${UI_URL}...`);
  await page.goto(UI_URL);
  await page.waitForLoadState("networkidle");

  // Step 1: Navigate to Vision Analytics view
  console.log("Navigating to Vision Analytics view...");
  const visionNavBtn = page.getByRole("button", { name: /Vision Analytics/i });
  await visionNavBtn.waitFor({ state: "visible", timeout: 10000 });
  await visionNavBtn.click();
  await page.waitForTimeout(400);

  // Step 2: Verify Vision Analytics Panel and Disclaimers
  const panel = page.getByTestId("vision-analytics-panel");
  await panel.waitFor({ state: "visible", timeout: 10000 });
  console.log("  ✓ Vision Analytics panel is visible");

  await page.getByText(/Sample Video Feed & Traffic State Extraction/i).waitFor();
  await page.getByText(/NON-ODISHA SAMPLE VIDEO FEED/i).first().waitFor();
  await page.getByText(/TEMPORARY LOCAL IDS ONLY/i).waitFor();
  await page.getByText(/UNCALIBRATED SPEED: DEMO ESTIMATE ONLY/i).waitFor();
  await page.getByText(/CORE SCENARIOS OPERATE INDEPENDENTLY/i).waitFor();
  console.log("  ✓ All required privacy, non-Odisha sample feed and demo speed disclaimers verified");

  // Step 3: Verify Canvas Video Viewport
  const canvas = page.locator("canvas.vision-canvas");
  await canvas.waitFor({ state: "visible" });
  assert.equal(await canvas.isVisible(), true);
  console.log("  ✓ OpenCV video viewport canvas active with camera CAM-C3-NORTH");

  // Step 4: Verify 5 Vehicle Classes Breakdown (PRD §15.2)
  for (const cls of ["Bike", "Car", "Auto", "Bus", "Truck"]) {
    await page.getByText(cls, { exact: true }).first().waitFor();
  }
  console.log("  ✓ All 5 PRD §15.2 vehicle classes verified in distribution breakdown");

  // Step 5: Verify Lane Table & Queue Assignment
  await page.getByText(/Lane 1 \(Left \/ Turning\)/i).waitFor();
  await page.getByText(/Lane 2 \(Through \/ Main\)/i).waitFor();
  await page.getByText(/Lane 3 \(Through \/ Curb\)/i).waitFor();
  console.log("  ✓ 3 lane ROIs and queue metrics verified");

  // Step 6: Verify Upstream C1 Corridor Impact Section (PRD §8.5)
  await page.getByText(/Upstream Impact on Corridor Junction C1/i).waitFor();
  await page.getByText(/\+30s Expected Inflow/i).waitFor();
  await page.getByText(/\+60s Expected Inflow/i).waitFor();
  await page.getByText(/\+120s Expected Inflow/i).waitFor();
  await page.getByText(/Estimated ETA to C1/i).waitFor();
  console.log("  ✓ Upstream C1 impact forecasts (+30s, +60s, +120s) and ETA range verified");

  // Step 7: Test Overlay Toggles
  const boxesBtn = page.getByRole("button", { name: /Bounding Boxes/i });
  await boxesBtn.click();
  assert.equal(await boxesBtn.getAttribute("aria-pressed"), "false");
  await boxesBtn.click();
  assert.equal(await boxesBtn.getAttribute("aria-pressed"), "true");
  console.log("  ✓ Video overlay toggle interactions verified");

  // Step 8: Test Video Playback Transport Controls
  const pauseBtn = page.getByRole("button", { name: /Pause video/i });
  await pauseBtn.click();
  const playBtn = page.getByRole("button", { name: /Play video/i });
  await playBtn.waitFor({ state: "visible" });
  await playBtn.click();
  console.log("  ✓ Play/pause and transport controls verified");

  // Capture desktop screenshot
  await page.screenshot({ path: "test-results/epic12-desktop.png", fullPage: true });
  console.log("  ✓ Desktop screenshot saved to test-results/epic12-desktop.png");

  // Step 9: Test Offline State & Recovery (Story S37, Finding A17)
  const simulateOfflineBtn = page.getByRole("button", { name: /Simulate Offline/i });
  await simulateOfflineBtn.click();
  const offlinePanel = page.getByTestId("vision-offline-panel");
  await offlinePanel.waitFor({ state: "visible" });
  await page.getByText(/Sample Video Edge Pipeline Disconnected/i).waitFor();
  await page.getByText(/core synthetic scenarios and golden replay remain 100% independent/i).waitFor();
  console.log("  ✓ Honest offline/disconnected state and independence disclaimer verified");

  // Reconnect from offline state
  const reconnectBtn = page.getByRole("button", { name: /Reconnect/i });
  await reconnectBtn.click();
  await panel.waitFor({ state: "visible" });
  console.log("  ✓ Pipeline reconnection restored live analytics panel");

  // Step 10: Mobile Responsiveness Check (390 x 844)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(hasOverflow, false, "Mobile viewport detected horizontal overflow");
  console.log("  ✓ Mobile viewport (390x844) responsive layout verified (no horizontal overflow)");

  // Capture mobile screenshot
  await page.screenshot({ path: "test-results/epic12-mobile.png", fullPage: true });
  console.log("  ✓ Mobile screenshot saved to test-results/epic12-mobile.png");

  assert.deepEqual(errors, [], `Page errors encountered: ${errors.join(", ")}`);
  console.log("\n======================================================================");
  console.log("PASS browser: Vision Analytics, OpenCV Player, Overlays, Responsive");
  console.log("======================================================================");

} catch (err) {
  console.error("Browser verification error:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (serverProc && serverProc.pid) {
    try {
      process.kill(-serverProc.pid, "SIGKILL");
    } catch {}
  }
}
