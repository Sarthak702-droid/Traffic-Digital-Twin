import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";

const port = 3115;
const url = `http://127.0.0.1:${port}`;
const vite = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin/vite.js");
const network = JSON.parse(readFileSync("packages/scenario-config/c1-c6.json", "utf8"));
const server = spawn(process.execPath, [vite, "preview", "--host", "127.0.0.1", "--port", String(port)], {
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
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.routeWebSocket("**/ws/v1/live", () => {});
  await page.addInitScript(() => localStorage.setItem("twin-uncertain-command", "browser-expired-1001"));
  let signedIn = true;
  let commandReads = 0;
  let protectedReads = 0;
  const posts = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST") posts.push(path);
    if (request.method() === "GET" && path !== "/api/v1/session") protectedReads++;
    const reply = (status, body) => route.fulfill({status, contentType:"application/json", body:JSON.stringify(body)});
    if (path === "/api/v1/session/login") { signedIn = true; return reply(200,{actor:"alice",role:"operator"}); }
    if (path === "/api/v1/session") return signedIn ? reply(200,{actor:"alice",role:"operator"}) : reply(401,{code:"UNAUTHORIZED",message:"Sign in required"});
    if (path === "/api/v1/commands/browser-expired-1001") {
      if (commandReads++ === 0) { signedIn = false; return reply(401,{code:"UNAUTHORIZED",message:"Session expired"}); }
      return reply(200,{command_id:"browser-expired-1001",status:"completed",response:{applied:true}});
    }
    if (!signedIn) return reply(401,{code:"UNAUTHORIZED",message:"Sign in required"});
    if (path === "/api/v1/network") return reply(200,network);
    if (path === "/api/v1/health") return reply(200,{timestamp:new Date().toISOString(),components:[]});
    if (path === "/api/v1/runs") return reply(200,[]);
    if (path === "/api/v1/mode") return reply(200,{mode:"observe",locks:[]});
    if (path === "/api/v1/decisions/unresolved") return reply(200,{unresolved:[]});
    return reply(503,{code:"SIMULATION_UNAVAILABLE",message:"Not part of this browser fixture"});
  });
  await page.goto(url);
  await page.getByLabel("Username").waitFor();
  await page.getByText("Signed out",{exact:true}).waitFor();
  assert.equal(await page.getByText("Loading network configuration…",{exact:true}).count(),0);
  assert.equal(await page.getByText(/EXECUTIVE BRIEFING MODE/).count(),0);
  const idleReads = protectedReads;
  await page.waitForTimeout(3500);
  assert.equal(protectedReads,idleReads,"Signed-out workspace kept requesting protected endpoints");
  const inputStyle = await page.getByLabel("Username").evaluate(input => ({
    height:input.getBoundingClientRect().height,
    border:getComputedStyle(input).borderTopWidth,
    background:getComputedStyle(input).backgroundColor,
  }));
  assert.ok(inputStyle.height>=44 && inputStyle.border!=="0px" && inputStyle.background!=="rgba(0, 0, 0, 0)","Login input was not visibly styled");
  await page.screenshot({path:"/tmp/traffic-a02-signed-out.png",fullPage:true});
  assert.equal(await page.evaluate(() => localStorage.getItem("twin-uncertain-command")), "browser-expired-1001");
  await page.getByLabel("Username").fill("alice");
  await page.getByLabel("Password").fill("correct-test-password");
  await page.getByRole("button",{name:"Sign in"}).click();
  await page.getByText("Authenticated session").waitFor();
  await page.getByText("Configuration validated",{exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:/Inspect C\d,/}).count(),6);
  await page.screenshot({path:"/tmp/traffic-a02-signed-in.png",fullPage:true});
  await page.getByText(/browser-expired-1001.*completed/).waitFor();
  assert.deepEqual(posts,["/api/v1/session/login"]);
  assert.equal(await page.evaluate(() => localStorage.getItem("twin-uncertain-command")), "browser-expired-1001");
  signedIn=false;
  await page.getByLabel("Username").waitFor();
  await page.getByText("Signed out",{exact:true}).waitFor();
  await page.waitForTimeout(500);
  const expiredReads=protectedReads;
  await page.waitForTimeout(3500);
  assert.equal(protectedReads,expiredReads,"Expired-session queries restarted instead of stopping");
  assert.equal(await page.getByText("Loading network configuration…",{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem("twin-uncertain-command")),"browser-expired-1001");
  assert.deepEqual(pageErrors,[]);
  console.log("A02 browser fixture: stable signed-out screen, visible inputs, six-node topology after login, expiry recovery, no protected polling while signed out, command retained without resubmission");
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
