import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
const metrics = { measured_at: new Date().toISOString(), scenarios: [] };
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.samples = [];
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (e) => {
          try {
            const event = JSON.parse(e.data);
            if (event.type === "network.state")
              window.samples.push({
                run: event.payload.run_id,
                t: event.payload.simulation_time_s,
                latency: Date.now() - Date.parse(event.payload.timestamp),
                received: Date.now(),
              });
          } catch {}
        });
      }
    };
  });
  await page.goto("http://127.0.0.1:3100");
  await page.getByText("Configuration validated", { exact: true }).waitFor();
  for (const [scenario, seed] of [
    ["peak_surge", "1101"],
    ["incident_c3", "2202"],
    ["ambulance_corridor", "3303"],
  ]) {
    await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
    await page.getByLabel("Deterministic seed").fill(seed);
    const start = Date.now();
    const responsePromise = page.waitForResponse((r) =>
      r.url().endsWith(`/scenarios/${scenario}/start`),
    );
    await page
      .getByRole("button", { name: "Start simulation", exact: true })
      .click();
    const response = await responsePromise;
    assert.equal(response.status(), 200, await response.text());
    const run = await response.json();
    await page.waitForFunction(
      (id) => window.samples.some((s) => s.run === id),
      run.run_id,
    );
    const startMs = Date.now() - start;
    assert.ok(startMs < 5000, `start ${startMs}ms`);
    await page.waitForFunction(
      (id) => window.samples.filter((s) => s.run === id).length >= 7,
      run.run_id,
    );
    const samples = await page.evaluate(
      (id) => window.samples.filter((s) => s.run === id),
      run.run_id,
    );
    assert.ok(
      Math.max(...samples.map((s) => s.latency)) < 500,
      JSON.stringify(samples),
    );
    const periodic = samples.slice(2);
    const cadence =
      (periodic.at(-1).received - periodic[0].received) / (periodic.length - 1);
    assert.ok(cadence > 800 && cadence < 1200, `cadence ${cadence}`);
    const resetStart = Date.now();
    const resetPromise = page.waitForResponse((r) =>
      r.url().endsWith("/scenarios/reset"),
    );
    await page
      .getByRole("button", { name: "Reset same seed", exact: true })
      .click();
    const resetResponse = await resetPromise;
    assert.equal(resetResponse.status(), 200);
    const reset = await resetResponse.json();
    assert.equal(reset.seed, Number(seed));
    assert.notEqual(reset.run_id, run.run_id);
    await page.waitForFunction(
      (id) => window.samples.some((s) => s.run === id),
      reset.run_id,
    );
    const resetMs = Date.now() - resetStart;
    assert.ok(resetMs < 5000);
    metrics.scenarios.push({
      scenario,
      start_ms: startMs,
      reset_ms: resetMs,
      max_latency_ms: Math.max(...samples.map((s) => s.latency)),
      mean_interval_ms: cadence,
      sample_count: samples.length,
    });
  }
  // Use the non-emergency scenario for operator actions.
  await page.getByLabel("Scenario", { exact: true }).selectOption("peak_surge");
  await page
    .getByRole("button", { name: "Start simulation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Simulate", exact: true })
    .waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await page.getByRole("heading", { name: /Same initial state/ }).waitFor();
  await page
    .getByRole("button", { name: "Approve in digital twin", exact: true })
    .click();
  await page.getByText("approve completed and audited.").waitFor();
  await page
    .getByRole("button", { name: "Manual / observe", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enable recommendations", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Approve in digital twin", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Enable recommendations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Modify", exact: true })
    .waitFor({ timeout: 15000 });
  await page
    .getByLabel("Decision reason")
    .fill("Acceptance test: bounded manual adjustment");
  const green = page.getByLabel(/Green seconds/).first();
  await green.fill("999");
  await page.getByRole("button", { name: "Modify", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "green outside configured bounds" })
    .waitFor();
  await green.fill("15");
  await page.getByRole("button", { name: "Modify", exact: true }).click();
  await page.getByText("modify completed and audited.").waitFor();
  const decisionResetPromise = page.waitForResponse((r) =>
    r.url().endsWith("/scenarios/reset"),
  );
  await page
    .getByRole("button", { name: "Reset same seed", exact: true })
    .click();
  const decisionReset = await (await decisionResetPromise).json();
  await page.waitForFunction(
    (id) => window.samples.at(-1)?.run === id,
    decisionReset.run_id,
  );
  await page
    .getByRole("button", { name: "Reject", exact: true })
    .waitFor({ timeout: 15000 });
  await page
    .getByLabel("Decision reason")
    .fill("Acceptance test: retain current safe plan");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByText("reject completed and audited.").waitFor();
  const measuredRun = await page.evaluate(() => window.samples.at(-1).run);
  const measurementStart = Date.now();
  await page.waitForFunction(
    ({ run, start }) =>
      window.samples.filter((s) => s.run === run && s.received >= start)
        .length >= 61,
    { run: measuredRun, start: measurementStart },
    { timeout: 75000 },
  );
  const sustained = await page.evaluate(
    ({ run, start }) =>
      window.samples.filter((s) => s.run === run && s.received >= start),
    { run: measuredRun, start: measurementStart },
  );
  const maxLatency = Math.max(...sustained.map((s) => s.latency));
  assert.ok(maxLatency < 500, `sustained latency ${maxLatency}`);
  metrics.sustained = {
    sample_count: sustained.length,
    max_latency_ms: maxLatency,
    mean_interval_ms:
      (sustained.at(-1).received - sustained[0].received) /
      (sustained.length - 1),
  };
  await context.setOffline(true);
  await page
    .getByText("Stream stale / disconnected", { exact: true })
    .waitFor({ timeout: 10000 });
  await context.setOffline(false);
  await page.waitForFunction(
    () => Date.now() - window.samples.at(-1).received < 1500,
    {},
    { timeout: 10000 },
  );
  metrics.reconnect = "passed";
  await page.screenshot({
    path: "test-results/epic2-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile overflow",
  );
  await page.screenshot({
    path: "test-results/epic2-mobile.png",
    fullPage: true,
  });
  execFileSync(
    ".venv/bin/python",
    [
      "-c",
      "import grpc,twin_pb2 as p,twin_pb2_grpc as r;c=r.SimulationStub(grpc.insecure_channel('127.0.0.1:50051'));s=c.GetState(p.RunRequest());c.Stop(p.RunRequest(run_id=s.run_id))",
    ],
    { env: { ...process.env, PYTHONPATH: ".:packages/contracts/gen/python" } },
  );
  await page
    .getByText("Stream stale / disconnected", { exact: true })
    .waitFor({ timeout: 10000 });
  await page.getByText("Demo fallback", { exact: true }).click();
  await page
    .getByRole("button", { name: "Start golden replay", exact: true })
    .click();
  await page
    .getByText("GOLDEN REPLAY / PRERECORDED", { exact: true })
    .waitFor({ timeout: 15000 });
  await page.reload();
  await page
    .getByText("GOLDEN REPLAY / PRERECORDED", { exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(
    await page
      .getByRole("button", { name: "Approve in digital twin", exact: true })
      .count(),
    0,
  );
  metrics.replay_without_running_aggregate_runtime = "passed";
  assert.deepEqual(errors, []);
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/epic2-acceptance.json",
    JSON.stringify(metrics, null, 2),
  );
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser.close();
}
