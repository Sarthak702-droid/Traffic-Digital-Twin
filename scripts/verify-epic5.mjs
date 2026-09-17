import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, copyFile } from "node:fs/promises";
import assert from "node:assert/strict";

const UI_PORT = 3107;
const UI_URL = `http://127.0.0.1:${UI_PORT}`;

await mkdir("test-results", { recursive: true });
await mkdir("docs/screenshots", { recursive: true });

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

  // State mock tracking
  let currentMode = "recommend";
  let auditEvents = [
    {
      id: "aud-001",
      sequence: 1,
      run_id: "run-e05-init",
      event_type: "mode.changed",
      actor: "supervisor",
      reason: "Initial deployment operating state",
      safety_result: "accepted_at_safe_boundary",
      created_at: new Date(Date.now() - 60000).toISOString(),
    },
  ];

  // Intercept API routes
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/api/v1/health") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "healthy",
          components: [
            { component: "api", status: "normal", message: "API operating nominal" },
            { component: "simulation", status: "normal", message: "Digital twin online" },
            { component: "database", status: "normal", message: "PostgreSQL connected" },
          ],
        }),
      });
    }

    if (url.pathname === "/api/v1/mode") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ mode: currentMode }),
      });
    }

    if (url.pathname.startsWith("/api/v1/mode/")) {
      const mode = url.pathname.split("/").pop();
      currentMode = mode;
      auditEvents.unshift({
        id: `aud-${Date.now()}`,
        sequence: auditEvents.length + 1,
        run_id: "run-e05-test",
        event_type: "mode.changed",
        actor: "operator",
        reason: `Operational mode updated to ${mode}`,
        safety_result: "accepted_at_safe_boundary",
        created_at: new Date().toISOString(),
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ mode: currentMode }),
      });
    }

    if (url.pathname === "/api/v1/analysis") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          run_id: "run-e05-test",
          simulation_time_s: 48,
          forecasts: [
            {
              id: "fc-c1",
              run_id: "run-e05-test",
              movement_id: "C3-C1-C2",
              horizon_s: 120,
              queue_veh: 22.4,
              occupancy_ratio: 0.89,
              arrivals_veh: 28.0,
              risk: "critical",
              spillback_eta_s: 98,
              model_version: "conservation-v2",
              explanation_facts: [
                "Upstream source: junction C3 via corridor C3-C1",
                "Projected arrivals: 28.0 veh over 120s horizon",
                "Storage occupancy: 89.0%",
              ],
            },
          ],
          recommendation: {
            id: "rec-e05-001",
            run_id: "run-e05-test",
            timestamp: new Date().toISOString(),
            priority: "warning",
            reason: "Increase C1 green time to flush queue and prevent corridor spillback",
            changes: [
              { node_id: "C1", phase_id: "C1-EW", green_s: 30 },
              { node_id: "C1", phase_id: "C1-NS", green_s: 25 },
            ],
            safety_status: "requires_fresh_validation",
            status: "pending",
            explanation_facts: ["Projected queue reduction: 42% at C1"],
          },
          alternatives: [],
          comparison: null,
        }),
      });
    }

    if (url.pathname === "/api/v1/recommendations/rec-e05-001/simulate") {
      auditEvents.unshift({
        id: `aud-${Date.now()}`,
        sequence: auditEvents.length + 1,
        run_id: "run-e05-test",
        event_type: "recommendation.simulated",
        actor: "operator",
        reason: "Simulated candidate rollout in twin",
        safety_result: "simulated",
        created_at: new Date().toISOString(),
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          run_id: "run-e05-test",
          recommendation_id: "rec-e05-001",
          model_version: "conservation-v2",
          initial_time_s: 48,
          horizon_s: 120,
          seed: 42,
          baseline_max_queue_veh: 28.6,
          candidate_max_queue_veh: 16.2,
          baseline_avg_delay_s: 36.4,
          candidate_avg_delay_s: 21.0,
          baseline_spillback_s: 48,
          candidate_spillback_s: 0,
          baseline_stops_per_vehicle: 1.9,
          candidate_stops_per_vehicle: 1.15,
        }),
      });
    }

    if (url.pathname === "/api/v1/recommendations/rec-e05-001/modify") {
      const body = JSON.parse(route.request().postData() || "{}");
      auditEvents.unshift({
        id: `aud-${Date.now()}`,
        sequence: auditEvents.length + 1,
        run_id: "run-e05-test",
        event_type: "recommendation.modified",
        actor: "operator",
        reason: body.reason || "Operator modified timing in digital twin",
        safety_result: "accepted_at_safe_boundary",
        created_at: new Date().toISOString(),
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, reason: body.reason }),
      });
    }

    if (url.pathname === "/api/v1/recommendations/rec-e05-001/reject") {
      const body = JSON.parse(route.request().postData() || "{}");
      auditEvents.unshift({
        id: `aud-${Date.now()}`,
        sequence: auditEvents.length + 1,
        run_id: "run-e05-test",
        event_type: "recommendation.rejected",
        actor: "operator",
        reason: body.reason || "Operator rejected recommendation",
        safety_result: "rejected: operator authority",
        created_at: new Date().toISOString(),
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, reason: body.reason }),
      });
    }

    if (url.pathname === "/api/v1/audit") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          events: auditEvents,
          next_after: 0,
        }),
      });
    }

    // Default continue for static/other assets
    return route.continue();
  });

  console.log("Navigating to Command Center...");
  await page.goto(UI_URL);

  // 1. Mandatory Operating Constraints & Disclosure Verification
  console.log("1. Verifying Operating Constraints & Disclosure...");
  await page.getByText("DEMONSTRATION MODE · SYNTHETIC TRAFFIC DATA · NO LIVE SIGNAL CONTROL").waitFor();
  await page.getByText("DEMONSTRATION MODE", { exact: true }).waitFor();
  await page.getByText("SYNTHETIC DATA", { exact: true }).waitFor();
  await page.getByText("NO LIVE SIGNAL CONTROL", { exact: true }).waitFor();

  // 2. Story S14: Mode transitions (Recommend, Observe, Manual)
  console.log("2. Verifying Story S14 Operational Modes...");
  const modeControl = page.locator(".mode-segmented-control");
  await modeControl.waitFor();

  // Initially in recommend mode
  const recSegment = modeControl.getByRole("button", { name: /recommend/i });
  const obsSegment = modeControl.getByRole("button", { name: /observe/i });
  const manSegment = modeControl.getByRole("button", { name: /manual/i });

  await recSegment.waitFor();
  assert((await recSegment.getAttribute("class")).includes("active"));

  // Switch to Observe Mode
  console.log("   - Switching to Observe mode...");
  await obsSegment.click();
  await page.waitForTimeout(300);
  assert((await obsSegment.getAttribute("class")).includes("active"));
  assert.equal(currentMode, "observe");

  // Switch to Manual Mode
  console.log("   - Switching to Manual mode...");
  await manSegment.click();
  await page.waitForTimeout(300);
  assert((await manSegment.getAttribute("class")).includes("active"));
  assert.equal(currentMode, "manual");

  // Verify Manual Mode alert banner is rendered in Action Rail
  console.log("   - Verifying manual mode alert banner on Action Rail...");
  await page.getByText("MANUAL AUTHORITY", { exact: true }).waitFor();
  await page.getByText("MANUAL MODE ACTIVE", { exact: true }).waitFor();
  await page.getByText("Autonomous recommendations suspended. Operator movement locks and manual authority engaged.").waitFor();

  // Switch back to Recommend Mode
  console.log("   - Switching back to Recommend mode...");
  await recSegment.click();
  await page.waitForTimeout(300);
  assert((await recSegment.getAttribute("class")).includes("active"));
  assert.equal(currentMode, "recommend");

  // 3. Story S13: Safety Envelope & Bounds Validation
  console.log("3. Verifying Story S13 Safety Bounds Validation...");
  // Wait for recommendation card to appear
  await page.getByText("WARNING RECOMMENDATION").waitFor();
  await page.getByText("Increase C1 green time to flush queue and prevent corridor spillback").waitFor();

  // Open Bounded Modification sub-panel
  await page.getByRole("button", { name: "Modify", exact: true }).click();
  await page.getByText("BOUNDED MODIFICATION (PRD §8.3)").waitFor();
  await page.getByText("Safety Envelope Verification").waitFor();
  await page.getByText("Configured min/max boundaries satisfied").waitFor();
  await page.getByText("Conflict matrix satisfied (n.Conflicts checked in Go)").waitFor();

  // Verify phase bounds chips are rendered
  await page.getByText("Bounds: 10s–55s").first().waitFor();

  // Test Out-of-Bounds handling
  console.log("   - Testing excessive timing out-of-bounds rejection...");
  const ewInput = page.getByLabel("Green seconds C1-EW");
  await ewInput.fill("75"); // Max is 55
  await page.getByText("Must be between 10s and 55s").waitFor();
  const applyBtn = page.getByRole("button", { name: "Confirm Modification & Apply" });
  assert(await applyBtn.isDisabled(), "Apply button should be disabled when out of bounds");

  console.log("   - Testing below-minimum timing out-of-bounds rejection...");
  await ewInput.fill("5"); // Min is 10
  await page.getByText("Must be between 10s and 55s").waitFor();
  assert(await applyBtn.isDisabled(), "Apply button should be disabled when below minimum");

  // Restore valid in-bounds value
  console.log("   - Restoring safe within-bounds timing (35s)...");
  await ewInput.fill("35");
  await page.waitForTimeout(200);
  assert(!(await applyBtn.isDisabled()), "Apply button should be enabled when within bounds");

  // 4. Story S15: Simulate candidate before and after comparison
  console.log("4. Verifying Story S15 Simulated Comparison (PRD §8.4)...");
  const simBtn = page.getByRole("button", { name: "Simulate" });
  await simBtn.click();

  // Wait for simulated rollout comparison table
  await page.getByText("SIMULATED ROLLOUT COMPARISON").waitFor();
  await page.getByText("Max Queue (veh)").waitFor();
  await page.getByText("Average Delay (s)").waitFor();
  await page.getByText("Spillback Duration (s)").waitFor();
  await page.getByText("Stops per Vehicle").waitFor();

  // Verify numerical values from comparison
  await page.getByText("28.6").waitFor();
  await page.getByText("16.2").waitFor();
  await page.getByText("36.4").waitFor();
  await page.getByText("21.0").waitFor();

  // 5. Story S15: Bounded modification with mandatory reason
  console.log("5. Verifying Story S15 Bounded Modification with Mandatory Reason...");
  const reasonSelect = page.getByLabel("Modification reason category");
  await reasonSelect.selectOption("Accident/obstruction");
  const notesField = page.getByLabel("Modification details and justification");
  await notesField.fill("Debris blocking lane at C1 north feeder; allocating +5s green");

  await applyBtn.click();
  await page.waitForTimeout(300);

  // 6. Story S15: Rejection with mandatory reason
  console.log("6. Verifying Story S15 Rejection with Mandatory Reason...");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByText("REJECTION REASON (PRD §8.3 MANDATORY)").waitFor();

  const rejectSelect = page.getByLabel("Rejection reason category");
  await rejectSelect.selectOption("Emergency vehicle");
  const rejectNotes = page.getByLabel("Rejection justification");
  await rejectNotes.fill("Active ambulance pre-clearance underway; suppressing timing update");

  await page.getByRole("button", { name: "Confirm Rejection" }).click();
  await page.waitForTimeout(300);

  // 7. Verify Durable Audit Trail View
  console.log("7. Verifying Durable Sequential Audit Trail View...");
  await page.getByRole("button", { name: "Audit & Health", exact: true }).click();
  await page.getByText("Durable Audit Trail").waitFor();
  await page.getByText("PostgreSQL Sequential Record · Latest 50 events").waitFor();

  // Verify all logged event types appear in the feed
  await page.getByText("MODE.CHANGED").first().waitFor();
  await page.getByText("RECOMMENDATION.SIMULATED").waitFor();
  await page.getByText("RECOMMENDATION.MODIFIED").waitFor();
  await page.getByText("RECOMMENDATION.REJECTED").waitFor();

  // 8. Capture Screenshot Evidence
  console.log("8. Capturing desktop and mobile screenshot evidence for Epic 5...");
  await page.getByRole("button", { name: "Command Center", exact: true }).click();
  await page.waitForTimeout(300);

  await page.screenshot({ path: "test-results/epic5-desktop.png", fullPage: true });
  await copyFile("test-results/epic5-desktop.png", "docs/screenshots/epic5-desktop.png");

  // Mobile viewport
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/epic5-mobile.png", fullPage: true });
  await copyFile("test-results/epic5-mobile.png", "docs/screenshots/epic5-mobile.png");

  assert.deepEqual(errors, [], `Browser console/page errors detected: ${JSON.stringify(errors)}`);

  console.log("===============================================================");
  console.log("PASS verify-epic5: All S13, S14, and S15 requirements verified cleanly!");
  console.log("Screenshots: docs/screenshots/epic5-desktop.png, docs/screenshots/epic5-mobile.png");
  console.log("===============================================================");
} finally {
  await browser.close();
  webProc.kill("SIGTERM");
}
