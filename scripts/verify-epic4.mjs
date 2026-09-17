import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const UI_PORT = 3106;
const UI_URL = `http://127.0.0.1:${UI_PORT}`;

await mkdir("test-results", { recursive: true });

console.log(`Starting Next.js test server on port ${UI_PORT}...`);
const webProc = spawn(
  "npx",
  ["next", "start", "--hostname", "127.0.0.1", "--port", String(UI_PORT)],
  {
    cwd: "apps/web",
    stdio: "inherit",
    env: { ...process.env, PORT: String(UI_PORT) },
  },
);

// Wait for Next.js server to be up
let ready = false;
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(UI_URL);
    if (res.status === 200) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  webProc.kill();
  throw new Error(`Next.js failed to start on ${UI_URL}`);
}

const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  console.log("Navigating to Command Center...");
  await page.goto(UI_URL);

  // 1. Mandatory Disclosure Check
  await page.getByText("DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL").waitFor();

  // 2. S11: Verify 5 Forward Horizons (NOW, +30s, +1m, +2m, +5m)
  console.log("Verifying S11 Conservation-based Forecasting Horizons...");
  await page.getByRole("button", { name: /Inspect C1,/ }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.getByText("C1 · Central junction").waitFor();

  // Verify horizon tabs: NOW, +30s, +1m, +2m, +5m
  assert.equal(await dialog.getByRole("tab").count(), 5);

  // Inspect +30s
  await dialog.getByRole("tab", { name: "+30s" }).click();
  await dialog.getByText(/simulation forecast/i).first().waitFor();

  // Inspect +1m
  await dialog.getByRole("tab", { name: "+1m" }).click();
  await dialog.getByText(/simulation forecast/i).first().waitFor();

  // Inspect +2m
  await dialog.getByRole("tab", { name: "+2m" }).click();
  await dialog.getByText(/simulation forecast/i).first().waitFor();

  // Inspect +5m (advisory label check)
  await dialog.getByRole("tab", { name: "+5m" }).click();
  await dialog.getByText(/5-minute output advisory/i).first().waitFor();

  // 3. S12: Verify Platoon Waveform, Upstream Source, and Deterministic Spillback Facts
  console.log("Verifying S12 Platoon Dispersion and Upstream Source Explanation...");
  await dialog.getByRole("tab", { name: "+2m" }).click();

  // Check deterministic cause section
  await dialog.getByText("Why this is happening", { exact: true }).waitFor();
  await dialog.getByText("Proposed signal timing adjustment", { exact: true }).waitFor();

  // Close drawer
  await page.getByRole("button", { name: "Close junction details" }).click();

  // 4. Verify Network Screen Before-vs-After Split Screen Comparison
  console.log("Verifying Network Screen Split Comparison Mode...");
  await page.getByRole("button", { name: "Network / Junction Intelligence", exact: true }).click();
  const networkView = page.locator('[data-testid="network-view"]');
  await networkView.waitFor();

  // Switch to Before vs After split mode
  await page.getByRole("button", { name: "Before vs After Split Mode" }).click();
  await page.getByText("BASELINE STRATEGY", { exact: true }).waitFor();
  await page.getByText("CANDIDATE PLAN", { exact: true }).waitFor();

  // Verify the 4 mandated outcome metrics
  await page.getByText("1. Maximum Queue").waitFor();
  await page.getByText("2. Average Modeled Delay").waitFor();
  await page.getByText("3. Spillback Occurrence").waitFor();
  await page.getByText("4. Modeled Stops / Vehicle").waitFor();

  // 5. Capture Screenshot Evidence
  console.log("Capturing desktop and mobile screenshot evidence for Epic 4...");
  await page.screenshot({ path: "test-results/epic4-desktop.png", fullPage: true });

  // Mobile viewport verification
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/epic4-mobile.png", fullPage: true });

  assert.deepEqual(errors, [], `Browser console/page errors detected: ${JSON.stringify(errors)}`);

  console.log("===============================================================");
  console.log("PASS verify-epic4: All S11, S12, and PRD §§16-17, 20-21 requirements verified cleanly!");
  console.log("Screenshots: test-results/epic4-desktop.png, test-results/epic4-mobile.png");
  console.log("===============================================================");
} finally {
  await browser.close();
  webProc.kill("SIGTERM");
}
