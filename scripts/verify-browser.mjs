import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.env.UI_URL || "http://127.0.0.1:3100";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByText("Configuration validated", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: /Inspect C\d,/ }).count(),
    6,
  );
  await page.getByRole("button", { name: /Inspect C3,/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.getByRole("heading", { name: "C3 · South junction" }).waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /Green 10–55s/);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByLabel("Deterministic seed").fill("-1");
  await page.getByRole("button", { name: "Prepare run", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Enter an integer seed" })
    .waitFor();
  const commandResponses = [];
  for (const [scenario, seed] of [
    ["peak_surge", "1101"],
    ["incident_c3", "2202"],
    ["ambulance_corridor", "3303"],
  ]) {
    await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
    await page.getByLabel("Deterministic seed").fill(seed);
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/runs") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Prepare run", exact: true })
      .click();
    const response = await responsePromise;
    assert.equal(response.status(), 201, await response.text());
    const run = await response.json();
    assert.equal(run.seed, Number(seed));
    assert.equal(run.status, "prepared");
    commandResponses.push(run);
    await page.getByRole("status").filter({ hasText: "Run saved" }).waitFor();
  }
  await page.reload();
  await page.getByText("Configuration validated", { exact: true }).waitFor();
  for (const run of commandResponses)
    await page
      .getByRole("cell", { name: run.id.slice(0, 8), exact: true })
      .waitFor();
  await page.screenshot({
    path: "test-results/epic1-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Audit & Health", exact: true })
    .click();
  await page.getByText("run.prepared", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Emergency", exact: true }).click();
  await page
    .getByRole("heading", { name: "Emergency route configuration" })
    .waitFor();
  await page
    .getByRole("button", { name: "Command Center", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/epic1-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Mobile page has horizontal overflow",
  );
  await page.getByRole("button", { name: /Inspect C1,/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Close junction details" }).click();
  assert.deepEqual(errors, []);
  console.log(
    "PASS browser: keyboard drawer, invalid seed, three persisted run types, reload, audit, emergency route, mobile, no runtime errors",
  );
  console.log(
    "Screenshots: test-results/epic1-desktop.png, test-results/epic1-mobile.png",
  );
} finally {
  await browser.close();
}
