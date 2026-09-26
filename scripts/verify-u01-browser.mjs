import assert from "node:assert/strict";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { chromium } from "@playwright/test";

const settings = JSON.parse(readFileSync(".runtime/local-env.json", "utf8"));
const accountsPath = settings.GATEWAY_USERS_FILE;
assert.ok(accountsPath && !existsSync(accountsPath), "Use a disposable worktree without an existing account file");
const username = "u01-browser-probe";
const password = randomBytes(30).toString("base64url");
const salt = randomBytes(24).toString("hex");
const hash = pbkdf2Sync(password, salt, 600000, 32, "sha256").toString("hex");
let browser;
let createdAccountFile = false;
try {
  writeFileSync(accountsPath, JSON.stringify({ [username]: { role: "operator", salt, hash, version: 1 } }), { mode: 0o600, flag: "wx" });
  createdAccountFile = true;
  browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/google-chrome" });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3100", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Authenticated session").waitFor();
  const recommend = page.getByRole("button", { name: "Recommend", exact: true });
  if (await recommend.isEnabled()) await recommend.click();
  else assert.match(await recommend.getAttribute("class") || "", /active/, "Recommend mode was unavailable");
  await page.getByLabel("Boundary demand source").selectOption("seeded");
  await page.getByRole("button", { name: /Start simulation/i }).click();
  await page.getByRole("region", { name: "Source and model clocks" }).getByText(/Virtual simulation time/).waitFor();
  await page.waitForFunction(() => {
    const clocks = document.querySelector('[aria-label="Source and model clocks"]');
    return clocks?.textContent?.includes("Virtual simulation time") && !clocks?.textContent?.includes("Virtual simulation time Unavailable");
  }, { timeout: 10_000 });
  await page.waitForTimeout(5_000);
  const response = await page.request.get("http://127.0.0.1:3100/api/v1/analysis");
  const analysisStatus = response.status();
  const result = analysisStatus === 200 ? await response.json() : null;
  const quality = await page.getByRole("region", { name: "Source and model clocks" }).innerText();
  await page.screenshot({ path: "/tmp/traffic-u01-browser.png", fullPage: true });
  await page.getByRole("button", { name: "Vision Analytics" }).click();
  await page.getByTestId("vision-analytics-panel").waitFor();
  assert.equal(await page.getByLabel("Recorded clip display only").evaluate((video) => video.loop), false);
  const displayStatus = await page.getByRole("region", { name: "Source and model clocks" }).innerText();
  await page.screenshot({ path: "/tmp/traffic-u01-vision.png", fullPage: true });
  console.log(JSON.stringify({ browser: "passed", analysisStatus, outcome: result?.outcome, snapshot: result?.snapshot_sequence, sourceSession: !!result?.input_session_id, clocks: quality.replaceAll("\n", " ").slice(0, 300), visionClocks: displayStatus.replaceAll("\n", " ").slice(0, 240) }));
} finally {
  if (browser) await browser.close();
  if (createdAccountFile) unlinkSync(accountsPath);
}
