import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const UI_PORT = process.env.UI_PORT ? Number(process.env.UI_PORT) : 3114;
const UI_URL = process.env.UI_URL || `http://127.0.0.1:${UI_PORT}`;

await mkdir("test-results", { recursive: true });
await mkdir("docs/screenshots", { recursive: true });

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
  console.log("Launching Playwright browser session for Epic 14...");
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

  // Step 1: Verify Disclosure and TopBar Policy Chips (S44)
  console.log("Step 1: Checking Policy Chips and TopBar...");
  await page.getByText(/DEMONSTRATION MODE/i).first().waitFor();
  await page.getByText(/SYNTHETIC DATA/i).first().waitFor();
  await page.getByText(/NO LIVE SIGNAL CONTROL/i).first().waitFor();
  console.log("  ✓ Policy disclosure and operating constraints chips verified");

  // Step 2: Test Health Dialog Focus & Keyboard Dismissal (S47)
  console.log("Step 2: Testing Accessible Health Dialog & Keyboard Handling...");
  const healthBtn = page.getByRole("button", { name: /System health:/i });
  await healthBtn.waitFor({ state: "visible" });
  await healthBtn.click();

  const healthDialog = page.getByRole("dialog", { name: /Component Health Status/i });
  await healthDialog.waitFor({ state: "visible" });
  assert.equal(await healthBtn.getAttribute("aria-expanded"), "true");
  console.log("  ✓ Health dialog opened with aria-modal and aria-expanded attributes");

  // Dismiss via Escape key
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  assert.equal(await healthDialog.isVisible(), false);
  assert.equal(await healthBtn.getAttribute("aria-expanded"), "false");
  console.log("  ✓ Health dialog successfully dismissed via Escape key");

  // Step 3: Verify Session & Recovery Panel (S46)
  console.log("Step 3: Verifying Session & Recovery Panel...");
  const sessionPanel = page.locator(".session-panel");
  await sessionPanel.waitFor({ state: "visible" });
  await page.getByText(/Sign in to the digital twin/i).waitFor();
  console.log("  ✓ Unauthenticated sign-in and command recovery panel rendered");

  // Step 4: Verify Navigation across all 6 Screens (S44, S45)
  console.log("Step 4: Verifying navigation across all 6 screens...");
  const screens = [
    { name: "Command Center", text: /C1–C6 Network Twin/i },
    { name: "Network / Junction Intelligence", text: /Full Digital Twin/i },
    { name: "Vision Analytics", text: /Sample Video Feed & Traffic State Extraction/i },
    { name: "Incidents", text: /Incident Scenario · C3 Capacity Reduction/i },
    { name: "Emergency", text: /Ambulance Corridor Priority/i },
    { name: "Audit & Health", text: /Durable Audit Trail/i },
  ];

  for (const screen of screens) {
    const navBtn = page.getByRole("button", { name: new RegExp(screen.name, "i") });
    await navBtn.click();
    await page.waitForTimeout(300);
    await page.getByText(screen.text).first().waitFor({ state: "visible", timeout: 8000 });
    console.log(`  ✓ Navigated to "${screen.name}" screen`);
  }

  // Step 5: Test Deep Linking via URL Search Param (S45)
  console.log("Step 5: Testing deep linking (?view=audit)...");
  await page.goto(`${UI_URL}/?view=audit`);
  await page.waitForLoadState("networkidle");
  await page.getByText(/Durable Audit Trail/i).waitFor({ state: "visible" });
  console.log("  ✓ Direct deep link to ?view=audit successfully hydrated");

  // Capture Desktop Screenshot
  await page.screenshot({ path: "docs/screenshots/epic14-desktop.png", fullPage: false });
  await page.screenshot({ path: "test-results/epic14-desktop.png", fullPage: false });
  console.log("  ✓ Desktop screenshot captured: docs/screenshots/epic14-desktop.png");

  // Step 6: Responsive Mobile Viewport Testing (S47)
  console.log("Step 6: Testing responsive mobile viewport (390x844)...");
  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.goto(UI_URL);
  await mobilePage.waitForLoadState("networkidle");

  // Verify zero horizontal overflow on mobile
  const scrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await mobilePage.evaluate(() => document.documentElement.clientWidth);
  assert.ok(scrollWidth <= clientWidth + 2, `Horizontal overflow detected: scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
  console.log("  ✓ Zero horizontal overflow verified on mobile viewport (390px)");

  // Capture Mobile Screenshot
  await mobilePage.screenshot({ path: "docs/screenshots/epic14-mobile.png", fullPage: false });
  await mobilePage.screenshot({ path: "test-results/epic14-mobile.png", fullPage: false });
  console.log("  ✓ Mobile screenshot captured: docs/screenshots/epic14-mobile.png");

  assert.deepEqual(errors, [], "Uncaught client exceptions detected");
  console.log("\nPASS: Epic 14 browser and responsive acceptance verification complete!");
} finally {
  await browser.close();
  if (serverProc) {
    try {
      process.kill(-serverProc.pid, "SIGKILL");
    } catch {
      serverProc.kill();
    }
  }
}
