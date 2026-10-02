// Real Go/PostgreSQL/gRPC/browser login probe using disposable accounts/schema.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { chromium } from "@playwright/test";

const root = process.cwd();
let machineRoot = root;
while (!existsSync(join(machineRoot, ".venv/bin/python"))) {
  const parent = dirname(machineRoot);
  assert.notEqual(parent, machineRoot, "A real Python .venv is required");
  machineRoot = parent;
}
assert.ok(existsSync(join(root, "apps/web/dist/index.html")), "Build the web app first");
const settings = JSON.parse(readFileSync(join(machineRoot, ".runtime/local-env.json"), "utf8"));
const database = new URL(process.env.TEST_DATABASE_URL || settings.DATABASE_URL);
assert.equal(database.hostname, "127.0.0.1", "Probe requires the local Compose database");
assert.equal(database.port, "5433");
assert.equal(database.pathname, "/traffic");
const schema = `a02_browser_${Date.now()}`;
database.searchParams.set("search_path", schema);
mkdirSync(join(root, ".runtime"), { recursive: true });
const runtime = mkdtempSync(join(root, ".runtime/a02-browser-"));
const username = "a02-browser-operator";
const password = randomBytes(30).toString("base64url");
const salt = randomBytes(24).toString("hex");
const accountFile = join(runtime, "users.json");
writeFileSync(accountFile, JSON.stringify({ [username]: {
  role: "operator", salt, hash: pbkdf2Sync(password, salt, 600000, 32, "sha256").toString("hex"), version: 1,
} }), { mode: 0o600, flag: "wx" });
const token = randomBytes(32).toString("hex");
const url = "http://127.0.0.1:3116";
const children = [];
let browser;
let schemaCreated = false;

const sql = statement => execFileSync("docker", ["compose", "--project-directory", machineRoot,
  "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "traffic", "-d", "traffic", "-c", statement], { stdio: "pipe" });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const listening = port => new Promise(resolve => {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.setTimeout(250);
  const finish = ready => { socket.destroy(); resolve(ready); };
  socket.once("connect", () => finish(true));
  socket.once("error", () => finish(false));
  socket.once("timeout", () => finish(false));
});
async function start(name, executable, args, env, port, cwd = root) {
  assert.equal(await listening(port), false, `${name} probe port is already occupied`);
  const child = spawn(executable, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  children.push(child);
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw Error(`${name} exited: ${output}`);
    if (await listening(port)) return;
    await delay(250);
  }
  throw Error(`${name} did not listen: ${output}`);
}

try {
  sql(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  const api = join(runtime, "api");
  execFileSync(resolve("scripts/run-go.sh"), ["build", "-buildvcs=false", "-o", api, "./apps/api/cmd/api"], {
    env: { ...process.env, GOCACHE: "/tmp/traffic-go-build-cache" }, stdio: "pipe",
  });
  const computeEnv = { ...process.env, COMPUTE_TOKEN: token,
    NETWORK_CONFIG: join(root, "packages/scenario-config/c1-c6.json"),
    PYTHONPATH: `${root}:${root}/packages/contracts/gen/python`,
    SIMULATION_DIRECTORY: join(runtime, "simulation"),
  };
  delete computeEnv.DATABASE_URL;
  delete computeEnv.WRITE_DATABASE_URL;
  for (const [kind, port] of [["simulation", 50061], ["intelligence", 50062]]) {
    await start(kind, join(machineRoot, ".venv/bin/python"), ["-m", "services.shared.server", kind, "--port", String(port)], computeEnv, port);
  }
  await start("Go API", api, [], { ...process.env, COMPUTE_TOKEN: token,
    DATABASE_URL: database.toString(), GATEWAY_USERS_FILE: accountFile, UI_ORIGIN: url,
    API_ADDR: "127.0.0.1:8083", SIMULATION_ADDR: "127.0.0.1:50061", INTELLIGENCE_ADDR: "127.0.0.1:50062",
    NETWORK_CONFIG: computeEnv.NETWORK_CONFIG,
  }, 8083);
  const vite = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin/vite.js");
  await start("Vite", process.execPath, [vite, "preview", "--host", "127.0.0.1", "--port", "3116"],
    { ...process.env, API_ORIGIN: "http://127.0.0.1:8083" }, 3116, join(root, "apps/web"));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  let reads = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (request.method() === "GET" && request.url().includes("/api/v1/") && !request.url().endsWith("/session")) reads++;
  });
  await page.goto(url);
  await page.getByLabel("Username").waitFor();
  await page.getByText("Signed out", { exact: true }).waitFor();
  await page.getByText("Local startup help", { exact: true }).waitFor();
  await delay(3500);
  assert.equal(reads, 0, "Signed-out browser requested protected data");
  assert.equal(await page.getByText("Loading network configuration…", { exact: true }).count(), 0);
  await page.screenshot({ path: "/tmp/traffic-a02-live-signed-out.png", fullPage: true });
  const login = async () => {
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Authenticated session").waitFor();
    await page.getByText("Configuration validated", { exact: true }).waitFor();
  };
  await login();
  assert.equal(await page.getByRole("button", { name: /Inspect C\d,/ }).count(), 6);
  const network = await page.request.get(`${url}/api/v1/network`);
  assert.equal(network.status(), 200);
  assert.equal((await network.json()).id, "c1-c6-v5");
  await page.screenshot({ path: "/tmp/traffic-a02-live-signed-in.png", fullPage: true });
  sql(`UPDATE ${schema}.auth_sessions SET revoked=true`);
  await page.getByLabel("Username").waitFor();
  await page.getByText("Signed out", { exact: true }).waitFor();
  await delay(500);
  const stopped = reads;
  await delay(3500);
  assert.equal(reads, stopped, "Revoked-session queries kept restarting");
  assert.equal(await page.getByText("Loading network configuration…", { exact: true }).count(), 0);
  await login();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByText("Signed out", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS real Go/PostgreSQL/gRPC/browser: signed-out idle, password login, six-node v5 topology, server session revocation, stopped polling, re-login and logout");
} finally {
  if (browser) await browser.close();
  for (const child of children.reverse()) {
    child.kill("SIGTERM");
    for (let attempt = 0; attempt < 20 && child.exitCode === null && child.signalCode === null; attempt++) await delay(100);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  if (schemaCreated) sql(`DROP SCHEMA ${schema} CASCADE`);
  rmSync(runtime, { recursive: true, force: true });
}
