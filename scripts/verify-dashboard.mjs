import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.env.DASHBOARD_URL || "http://127.0.0.1:3001";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByText("Repository plan connected", { exact: true }).waitFor();
  const response = await page.request.get(base + "/api/plan");
  assert.equal(response.status(), 200);
  const plan = await response.json();
  assert.equal(
    plan.epics.flatMap((e) => e.stories).filter((s) => s.status === "completed")
      .length,
    12,
  );
  for (const epic of plan.epics) {
    await page.getByRole("searchbox").fill(String(Number(epic.id.slice(1))));
    await page.waitForFunction(
      (expected) => document.querySelectorAll(".task-card").length === expected,
      epic.stories.length,
    );
  }
  await page.getByRole("searchbox").fill("1");
  await page.waitForFunction(
    () => document.querySelectorAll(".task-card").length === 4,
  );
  assert.equal(
    await page
      .locator(".task-card .badge")
      .filter({ hasText: "COMPLETED" })
      .count(),
    4,
  );
  await page.getByRole("searchbox").fill("2");
  await page.waitForFunction(
    () => document.querySelectorAll(".task-card").length === 3,
  );
  assert.equal(
    await page
      .locator(".task-card .badge")
      .filter({ hasText: "COMPLETED" })
      .count(),
    3,
  );
  await page
    .getByRole("button", {
      name: "Build seeded SUMO scenarios and reset",
      exact: true,
    })
    .click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.locator("#task-status").isDisabled(), true);
  assert.equal(
    (await page.request.get(base + "/evidence/epic2")).status(),
    200,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox").fill("3");
  await page.waitForFunction(
    () => document.querySelectorAll(".task-card").length === 3,
  );
  assert.equal(
    await page
      .locator(".task-card .badge")
      .filter({ hasText: "COMPLETED" })
      .count(),
    3,
  );
  await page
    .getByRole("button", {
      name: "Build the product shell and disclosure",
      exact: true,
    })
    .click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.locator("#task-status").isDisabled(), true);
  assert.equal(
    (await page.request.get(base + "/evidence/epic3")).status(),
    200,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox").fill("4");
  await page.waitForFunction(
    () => document.querySelectorAll(".task-card").length === 2,
  );
  assert.equal(
    await page
      .locator(".task-card .badge")
      .filter({ hasText: "COMPLETED" })
      .count(),
    2,
  );
  await page
    .getByRole("button", {
      name: "Implement conservation-based forecasting",
      exact: true,
    })
    .click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.locator("#task-status").isDisabled(), true);
  assert.equal(
    (await page.request.get(base + "/evidence/epic4")).status(),
    200,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox").fill("");
  await page
    .getByRole("button", { name: "Epic overview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  assert.equal(await page.locator(".epic-card").count(), 12);
  assert.deepEqual(errors, []);
  console.log(
    "PASS dashboard: all 12 epic searches, 12 evidence-backed completions, locked accepted status, evidence endpoints and overview",
  );
} finally {
  await browser.close();
}
