import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const UI_PORT = 3105;
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

  // 1. S08 Product Shell & Disclosure Verification
  console.log("Verifying S08 Product Shell & Disclosure...");
  await page.getByText("DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL").waitFor();
  await page.getByText("DEMONSTRATION MODE", { exact: true }).waitFor();
  await page.getByText("SYNTHETIC DATA", { exact: true }).waitFor();
  await page.getByText("NO LIVE SIGNAL CONTROL", { exact: true }).waitFor();

  // Verify exactly 6 navigation items
  const navItems = page.locator(".app-sidebar nav .nav-item");
  assert.equal(await navItems.count(), 6);
  const navLabels = await navItems.allInnerTexts();
  assert.deepEqual(
    navLabels.map((l) => l.trim()),
    ["Command Center", "Network / Junction Intelligence", "Vision Analytics", "Incidents", "Emergency", "Audit & Health"],
  );

  // 2. Role Switcher Verification
  console.log("Verifying Role Switcher (Operator, Supervisor, Executive)...");
  const roleSelect = page.getByRole("combobox", { name: "Select user role" });
  await roleSelect.selectOption("viewer");
  await page.getByText("EXECUTIVE BRIEFING MODE (DGP / SENIOR LEADERSHIP)").waitFor();
  await roleSelect.selectOption("supervisor");
  await page.getByText("SUPERVISOR OVERSIGHT MODE").waitFor();
  await roleSelect.selectOption("operator");

  // 3. DGP Guided Presentation Mode Modal (PRD §5 & §8.1)
  console.log("Verifying Guided 8-Step DGP Presentation Modal...");
  await page.getByRole("button", { name: "START DGP DEMONSTRATION" }).click();
  await page.getByRole("dialog", { name: /DGP Demonstration/ }).waitFor();
  await page.getByText("Step 1 of 8").waitFor();
  await page.getByText("Current Network State", { exact: true }).waitFor();

  // Step through presentation
  for (let s = 1; s <= 7; s++) {
    await page.getByRole("button", { name: "Next Step" }).click();
    await page.getByText(`Step ${s + 1} of 8`).waitFor();
  }
  await page.getByText("Shadow-Pilot Recommendation", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Complete Briefing" }).click();
  await page.waitForFunction(() => !document.querySelector(".dgp-modal-content"));
  await page.waitForTimeout(500);

  // 4. S09 5 Summary KPIs Verification (PRD §8.1)
  console.log("Verifying 5 Summary KPIs Strip...");
  const kpiStrip = page.locator('[data-testid="kpi-strip"]');
  await kpiStrip.waitFor();
  const kpiCards = kpiStrip.locator(".kpi-card");
  assert.equal(await kpiCards.count(), 5);
  await page.getByText("VEHICLES IN NETWORK").waitFor();
  await page.getByText("AVG SPEED").waitFor();
  await page.getByText("AVG QUEUE").waitFor();
  await page.getByText("CRITICAL NODES").waitFor();
  await page.getByText("PREDICTED SPILLBACK ETA").waitFor();

  // 5. Command Center Action Rail Verification
  console.log("Verifying Action Rail cards...");
  await page.locator('[data-testid="priority-alert"]').waitFor();
  await page.locator('[data-testid="current-recommendation"]').waitFor();
  await page.locator('[data-testid="next-predicted-issue"]').waitFor();

  // 6. S10 Junction Intelligence Drawer & Horizons
  console.log("Verifying S10 Junction Intelligence Drawer & Forward Horizons...");
  await page.getByRole("button", { name: /Inspect C1,/ }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.getByText("C1 · Central junction").waitFor();

  // Check horizon tabs: NOW, +30s, +1m, +2m, +5m
  assert.equal(await dialog.getByRole("tab").count(), 5);
  await dialog.getByRole("tab", { name: "+30s" }).click();
  await dialog.getByText(/simulation forecast/i).first().waitFor();
  await dialog.getByRole("tab", { name: "+5m" }).click();
  await dialog.getByText(/5-minute output advisory/i).first().waitFor();

  // Check deterministic cause and recommendation impact
  await dialog.getByText("Why this is happening", { exact: true }).waitFor();
  await dialog.getByText("Proposed signal timing adjustment", { exact: true }).waitFor();

  // Close drawer
  await page.getByRole("button", { name: "Close junction details" }).click();

  // 7. Network Screen & Before-vs-After Comparison Mode (PRD §8.4)
  console.log("Verifying Network Screen Before-vs-After Comparison...");
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

  // 8. Capture Screenshot Evidence
  console.log("Capturing desktop and mobile screenshot evidence...");
  await page.screenshot({ path: "test-results/epic3-desktop.png", fullPage: true });

  // Mobile viewport verification
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/epic3-mobile.png", fullPage: true });

  assert.deepEqual(errors, [], `Browser console/page errors detected: ${JSON.stringify(errors)}`);

  console.log("===============================================================");
  console.log("PASS verify-epic3: All S08, S09, S10, and PRD §8 requirements verified cleanly!");
  console.log("Screenshots: test-results/epic3-desktop.png, test-results/epic3-mobile.png");
  console.log("===============================================================");
} finally {
  await browser.close();
  webProc.kill("SIGTERM");
}
