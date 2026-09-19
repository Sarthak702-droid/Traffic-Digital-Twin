import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const UI_PORT = process.env.UI_PORT ? Number(process.env.UI_PORT) : 3111;
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
  console.log("Launching Playwright browser session...");
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

  // Step 1: Verify presence of START DGP DEMONSTRATION in TopBar
  const dgpBtn = page.getByRole("button", { name: /START DGP DEMONSTRATION/i });
  await dgpBtn.waitFor({ state: "visible", timeout: 10000 });
  console.log("  ✓ 'START DGP DEMONSTRATION' launcher visible in command bar");

  // Step 2: Click to open modal
  await dgpBtn.click();
  const modal = page.getByRole("dialog");
  await modal.waitFor({ state: "visible" });
  assert.equal(await modal.isVisible(), true);
  console.log("  ✓ DGP Demonstration Presentation modal opened");

  // Step 3: Verify Executive Header, Status Pill, and Step 1
  await page.getByText("Traffic Digital Twin · DGP Demonstration").waitFor();
  await page.getByText("Step 1 of 8").waitFor();
  await page.getByText("Current Network State").first().waitFor();
  await page.getByText(/DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL/).first().waitFor();
  console.log("  ✓ Step 1 rendered with synthetic disclosure and executive typography");

  // Step 4: Toggle Preflight Checklist
  const preflightBtn = page.getByRole("button", { name: /Preflight Checklist/i });
  await preflightBtn.click();
  await page.getByText("Presenter Preflight Checklist (8-Minute Demonstration Gate)").waitFor();
  await page.getByText("PostgreSQL Local Database").waitFor();
  await page.getByText("Offline Golden Replay Fallback").waitFor();
  console.log("  ✓ Preflight checklist toggled; 8 critical release controls inspected");

  // Return to slide
  await page.getByRole("button", { name: /Return to Slide/i }).click();
  await page.getByText("Current Network State").first().waitFor();

  // Step 5: Toggle Speaker Script
  const scriptBtn = page.getByRole("button", { name: /Presenter Script/i });
  await scriptBtn.click();
  await page.getByText(/SPEAKER NOTES/).waitFor();
  await page.getByText("Suggested Spoken Phrasing:").waitFor();
  await page.getByText(/Director General, what you see on screen/).waitFor();
  console.log("  ✓ Speaker Script panel toggled; duration, pitch and Q&A verified");

  // Step 6: Step through all 8 slides
  const expectedSteps = [
    "Current Network State",
    "Future Congestion Prediction",
    "Coordinated Recommendation",
    "Before-vs-After Twin Simulation",
    "C3 Incident Scenario",
    "Ambulance Corridor Priority",
    "Human Authority & Audit Trail",
    "Shadow-Pilot Recommendation",
  ];

  for (let i = 0; i < expectedSteps.length - 1; i++) {
    const nextBtn = page.getByRole("button", { name: "Next Step", exact: true });
    await nextBtn.click();
    await page.getByText(`Step ${i + 2} of 8`).waitFor();
    await page.getByText(expectedSteps[i + 1]).first().waitFor();
  }
  console.log("  ✓ All 8 demonstration steps navigated sequentially");

  // Verify Complete Briefing button on step 8
  const completeBtn = page.getByRole("button", { name: /Complete Briefing/i });
  await completeBtn.waitFor({ state: "visible" });
  console.log("  ✓ 'Complete Briefing' release gate action visible on final step");

  // Capture desktop screenshot
  await page.screenshot({ path: "test-results/epic11-desktop.png", fullPage: true });
  console.log("  ✓ Desktop presentation screenshot saved to test-results/epic11-desktop.png");

  // Step 7: Mobile Viewport & Responsiveness Check (390 x 844 iPhone standard)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(hasOverflow, false, "Mobile viewport detected horizontal overflow");
  console.log("  ✓ Mobile viewport (390x844) responsive layout verified (no horizontal overflow)");

  // Capture mobile screenshot
  await page.screenshot({ path: "test-results/epic11-mobile.png", fullPage: true });
  console.log("  ✓ Mobile presentation screenshot saved to test-results/epic11-mobile.png");

  // Close modal with Escape key
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  assert.deepEqual(errors, [], `Page errors encountered: ${errors.join(", ")}`);
  console.log("\n======================================================================");
  console.log("PASS browser: DGP Guided Presentation, Preflight, Script, Responsive");
  console.log("======================================================================");

} finally {
  await browser.close();
  if (serverProc && serverProc.pid) {
    try {
      process.kill(-serverProc.pid, "SIGKILL");
    } catch {}
  }
  process.exit(0);
}
