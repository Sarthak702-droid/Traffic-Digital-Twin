import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const port = 3115;
const url = `http://127.0.0.1:${port}`;
const server = spawn("../../node_modules/.bin/vite", ["preview", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: "apps/web", stdio: "ignore", env: process.env,
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { ready = (await fetch(url)).ok; if (ready) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Vite preview did not start");
  const executablePath = process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
  browser = await chromium.launch({headless:true,executablePath});
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem("twin-uncertain-command", "browser-expired-1001"));
  let signedIn = true;
  let commandReads = 0;
  const posts = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST") posts.push(path);
    const reply = (status, body) => route.fulfill({status, contentType:"application/json", body:JSON.stringify(body)});
    if (path === "/api/v1/session/login") { signedIn = true; return reply(200,{actor:"alice",role:"operator"}); }
    if (path === "/api/v1/session") return signedIn ? reply(200,{actor:"alice",role:"operator"}) : reply(401,{code:"UNAUTHORIZED",message:"Sign in required"});
    if (path === "/api/v1/commands/browser-expired-1001") {
      if (commandReads++ === 0) { signedIn = false; return reply(401,{code:"UNAUTHORIZED",message:"Session expired"}); }
      return reply(200,{command_id:"browser-expired-1001",status:"completed",response:{applied:true}});
    }
    return reply(503,{code:"SIMULATION_UNAVAILABLE",message:"Not part of this browser fixture"});
  });
  await page.goto(url);
  await page.getByLabel("Username").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("twin-uncertain-command")), "browser-expired-1001");
  await page.getByLabel("Username").fill("alice");
  await page.getByLabel("Password").fill("correct-test-password");
  await page.getByRole("button",{name:"Sign in"}).click();
  await page.getByText("Authenticated session").waitFor();
  await page.getByText(/browser-expired-1001.*completed/).waitFor();
  assert.deepEqual(posts,["/api/v1/session/login"]);
  assert.equal(await page.evaluate(() => localStorage.getItem("twin-uncertain-command")), "browser-expired-1001");
  console.log("A02 browser: expired session recovered; command looked up without resubmission");
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
