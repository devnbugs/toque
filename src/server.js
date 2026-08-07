/**
 * HTTP server entry point for the Cloudflare Container.
 *
 * Exposes the Nusuk CLI operations as JSON endpoints so a Cloudflare Worker
 * can route requests to the container. The container is stateless: auth,
 * entity, and captcha values are read from environment variables or request
 * bodies, not from local files.
 */

import { createServer } from "http";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { Nusuk } from "./nusuk.js";
import { AuthaWorker } from "./worker.js";
import { CapSolver } from "./capsolver.js";
import { buildVisaPayload } from "./visa-payload.js";
import { getRequest, listRequests } from "./requests.js";
import { extractGroups, formatGroups, normalizeGroupId } from "./groups.js";
import { computeSendSchedule } from "./scheduling.js";
import { parsePositiveCount, parseTargetTime } from "./validation.js";
import { pullCaptchaOnce, runCaptchaPullLoop, normalizeCaptchaType, parseInterval } from "./captcha-puller.js";

const PORT = Number(process.env.PORT || 8080);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const CLI_PATH = resolve(PROJECT_ROOT, "bin/nusuk.js");

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function buildNusuk(body = {}) {
  const nusuk = new Nusuk({
    baseUrl: body.baseUrl || process.env.NUSUK_BASE_URL,
    origin: body.origin || process.env.NUSUK_ORIGIN,
    referer: body.referer || process.env.NUSUK_REFERER,
    browserOptions: { headless: true },
  });

  const authToken = body.authToken || process.env.AUTH_TOKEN || process.env.NUSUK_AUTH_TOKEN;
  if (authToken) {
    nusuk.setAuthToken(authToken);
  } else {
    nusuk.loadAuth();
  }

  nusuk.loadEntity({
    activeEntityId: body.activeEntityId || process.env.ACTIVE_ENTITY_ID,
    activeEntityTypeId: body.activeEntityTypeId || process.env.ACTIVE_ENTITY_TYPE_ID,
  });

  const captchaType = body.captchaType || process.env.CAPTCHA_TYPE || "visa";
  const captchaToken = body.captchaToken || process.env.CAPTCHA_TOKEN;
  if (captchaToken) {
    nusuk.captchaToken = captchaToken;
  } else {
    nusuk.loadCaptcha(undefined, captchaType);
  }

  return nusuk;
}

async function withNusuk(body, callback) {
  const nusuk = buildNusuk(body);
  await nusuk.init();
  try {
    return await callback(nusuk);
  } finally {
    await nusuk.close();
  }
}

async function handlePull(body) {
  requireEnv(["WORKER_URL", "WORKER_API_TOKEN", "ACTIVE_ENTITY_ID"]);
  const worker = new AuthaWorker({
    endpoint: process.env.WORKER_URL,
    apiToken: process.env.WORKER_API_TOKEN,
    entityId: body.activeEntityId || process.env.ACTIVE_ENTITY_ID,
    systemUserId: body.systemUserId || process.env.SYSTEM_USER_ID,
  });
  const context = await worker.fetchContext(undefined, { refresh: Boolean(body.refresh) });
  return { ok: true, context };
}

async function handleInfo(body) {
  return withNusuk(body, async (nusuk) => {
    const res = await nusuk.request(
      "/umrah/reports_apis/api/Dashboard/DashboardCompanyInfo",
      { method: "POST", payload: {} }
    );
    return { ok: res.ok, status: res.status, data: res.json };
  });
}

async function handleSend(body) {
  const groupId = normalizeGroupId(body.groupId);
  if (!groupId) {
    throw new Error("groupId is required");
  }
  return withNusuk(body, async (nusuk) => {
    const payload = buildVisaPayload(body.payload, groupId, nusuk.captchaToken);
    const res = await nusuk.request(
      "/umrah/visa_apis/api/Visa/SendToIssueVisa",
      { method: "POST", payload }
    );
    return { ok: res.ok, status: res.status, data: res.json, timing: res.timing };
  });
}

async function handleApi(body) {
  const name = String(body.name || "").trim().toLowerCase();
  const request = getRequest(name);
  if (!request) {
    throw new Error(`Unknown API request: ${body.name}`);
  }
  return withNusuk(body, async (nusuk) => {
    const payload = request.captcha
      ? { ...request.payload, captchaToken: nusuk.captchaToken }
      : request.payload;
    const res = await nusuk.request(request.path, {
      method: request.method,
      payload,
    });
    return { ok: res.ok, status: res.status, data: res.json, timing: res.timing };
  });
}

async function handleRequest(body) {
  if (!body.path) throw new Error("path is required");
  return withNusuk(body, async (nusuk) => {
    const res = await nusuk.request(body.path, {
      method: body.method || "GET",
      payload: body.payload,
      headers: body.headers || {},
    });
    return { ok: res.ok, status: res.status, data: res.json || res.body, timing: res.timing };
  });
}

async function handleGroups(body) {
  return withNusuk(body, async (nusuk) => {
    const limit = parsePositiveCount(body.limit) || 10;
    const offset = parsePositiveCount(body.offset) || 0;
    const res = await nusuk.request("/umrah/groups_apis/api/Groups/GetGroupList", {
      method: "POST",
      payload: {
        limit,
        offset,
        filterList: [],
        sortColumn: null,
        sortCriteria: [],
        noCount: true,
      },
    });
    const groups = extractGroups(res.json);
    return {
      ok: res.ok,
      status: res.status,
      groups: formatGroups(groups),
      raw: body.raw ? res.json : undefined,
    };
  });
}

async function handleCaptchaSolve(body) {
  requireEnv(["CAPSOLVER_API_KEY"]);
  const solver = new CapSolver({
    apiKey: process.env.CAPSOLVER_API_KEY,
    siteKey: body.siteKey || process.env.CAPSOLVER_SITE_KEY,
    pageUrl: body.pageUrl || process.env.CAPSOLVER_PAGE_URL,
    pageAction: body.pageAction || process.env.CAPSOLVER_PAGE_ACTION,
  });
  const token = await solver.solve();
  return { ok: true, token };
}

async function handleSchedule(body) {
  const target = parseTargetTime(body.target);
  if (!target) throw new Error("target time is required (HH:MM:SS[.mmm])");
  const groupId = normalizeGroupId(body.groupId);
  if (!groupId) throw new Error("groupId is required");

  return withNusuk(body, async (nusuk) => {
    const schedule = computeSendSchedule(target);
    const payload = buildVisaPayload(body.payload, groupId, nusuk.captchaToken);

    if (schedule.waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, schedule.waitMs));
    }

    const res = await nusuk.request(
      "/umrah/visa_apis/api/Visa/SendToIssueVisa",
      { method: "POST", payload }
    );
    return {
      ok: res.ok,
      status: res.status,
      data: res.json,
      timing: res.timing,
      scheduledAt: schedule.target.toISOString(),
      firedAt: new Date().toISOString(),
    };
  });
}

async function handleListApis() {
  return { ok: true, requests: listRequests() };
}

// ---------------------------------------------------------------------------
// Unified /cmd endpoint — run any CLI command and return structured output
// ---------------------------------------------------------------------------

/**
 * In-process background CAPTCHA refresher.
 *
 * Instead of spawning a detached daemon (which is unsafe in a container and
 * impossible to control over HTTP), we run the pull loop in-process with an
 * AbortController. This lets /cmd/captcha-start, /cmd/captcha-status, and
 * /cmd/captcha-stop manage it cleanly.
 */
const captchaTask = {
  controller: null,   // AbortController | null
  startedAt: null,    // Date | null
  options: null,      // last-used pull options
  pulls: 0,           // number of successful pulls
  errors: 0,          // number of failed pulls
  lastResult: null,   // last pull result
  lastError: null,    // last error message
};

function captchaTaskStatus() {
  const running = Boolean(captchaTask.controller && !captchaTask.controller.signal.aborted);
  return {
    running,
    startedAt: captchaTask.startedAt ? captchaTask.startedAt.toISOString() : null,
    uptimeMs: running && captchaTask.startedAt ? Date.now() - captchaTask.startedAt.getTime() : 0,
    options: captchaTask.options,
    pulls: captchaTask.pulls,
    errors: captchaTask.errors,
    lastResult: captchaTask.lastResult,
    lastError: captchaTask.lastError,
  };
}

function captchaTaskStop() {
  if (captchaTask.controller) {
    captchaTask.controller.abort();
  }
  return captchaTaskStatus();
}

async function captchaTaskStart(options = {}) {
  // Stop any existing task first
  if (captchaTask.controller) {
    captchaTask.controller.abort();
  }

  const entityId = options.entityId || process.env.ACTIVE_ENTITY_ID;
  if (!entityId) {
    throw new Error("Entity ID required (pass --entity or set ACTIVE_ENTITY_ID)");
  }

  const type = normalizeCaptchaType(options.type || "visa");
  const interval = parseInterval(options.interval, 5000);
  const endpoint = options.endpoint || process.env.WORKER_URL;
  const outputPath = options.output || process.env.CAPTCHA_PATH || "captcha.json";
  const strict = options.strict !== false;

  const controller = new AbortController();
  captchaTask.controller = controller;
  captchaTask.startedAt = new Date();
  captchaTask.options = { entityId, type, interval, endpoint, outputPath, strict };
  captchaTask.pulls = 0;
  captchaTask.errors = 0;
  captchaTask.lastResult = null;
  captchaTask.lastError = null;

  // Run the loop in the background (not awaited — fire and forget)
  runCaptchaPullLoop({
    entityId,
    type,
    endpoint,
    outputPath,
    strict,
    interval,
    signal: controller.signal,
    quiet: true,
    logger: {
      log: () => { captchaTask.pulls += 1; },
      error: (msg) => { captchaTask.errors += 1; captchaTask.lastError = String(msg); },
    },
  }).then(() => {
    captchaTask.controller = null;
  }).catch((err) => {
    captchaTask.lastError = err.message;
    captchaTask.controller = null;
  });

  return captchaTaskStatus();
}

/**
 * Run a bounded captcha watch — pulls in a loop for a limited duration,
 * then stops. Returns the collected results. Safe for HTTP.
 */
async function captchaWatchBounded(options = {}) {
  const entityId = options.entityId || process.env.ACTIVE_ENTITY_ID;
  if (!entityId) {
    throw new Error("Entity ID required (pass --entity or set ACTIVE_ENTITY_ID)");
  }

  const type = normalizeCaptchaType(options.type || "visa");
  const interval = parseInterval(options.interval, 5000);
  const maxDuration = Math.min(Number(options.maxDuration) || 60_000, 300_000); // cap at 5 min
  const endpoint = options.endpoint || process.env.WORKER_URL;
  const outputPath = options.output || process.env.CAPTCHA_PATH || "captcha.json";
  const strict = options.strict !== false;

  const controller = new AbortController();
  const results = [];
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), maxDuration);

  try {
    while (!controller.signal.aborted) {
      try {
        const result = await pullCaptchaOnce({ entityId, type, endpoint, outputPath, strict });
        results.push({ at: new Date().toISOString(), updated: result.updated, ok: true });
      } catch (err) {
        results.push({ at: new Date().toISOString(), updated: false, ok: false, error: err.message });
      }
      if (controller.signal.aborted) break;
      await new Promise((r) => setTimeout(r, interval));
      if (Date.now() - startedAt >= maxDuration) break;
    }
  } finally {
    clearTimeout(timeout);
  }

  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    pulls: results.length,
    results,
  };
}

/**
 * Catalog of all CLI commands exposed via /cmd.
 * Each entry maps a command name to its allowed args and description.
 */
const CMD_CATALOG = {
  init:           { args: [],                          description: "Create local config files" },
  login:          { args: ["--system-user", "--type", "--endpoint"], description: "Install latest user credentials" },
  logout:         { args: [],                          description: "Clear local auth/captcha/entity state" },
  pull:           { args: ["--entity", "--type", "--endpoint"], description: "Refresh auth, entity, and CAPTCHA" },
  info:           { args: [],                          description: "Show dashboard company info" },
  send:           { args: ["--target", "--data", "--captcha", "--captcha-type", "--no-test", "--endpoint"], description: "Send a visa request" },
  "send-visa":    { args: ["--target", "--data", "--captcha", "--captcha-type", "--no-test", "--endpoint"], description: "Send a visa request (alias)" },
  "set-group-id": { args: [],                          description: "Store a default group ID" },
  request:        { args: ["--data", "--data-raw", "--captcha", "--captcha-type", "--raw-json"], description: "Send a custom API request" },
  api:            { args: ["--raw-json"],               description: "Run a saved request from the catalog" },
  groups:         { args: ["--limit", "--offset", "--raw-json"], description: "List groups" },
  schedule:       { args: ["--target", "--path", "--method", "--count", "--data", "--captcha", "--captcha-type"], description: "Schedule a timed request" },
  "sync-time":    { args: ["--dry-run", "--source"],   description: "Sync system clock to network time" },
  bench:          { args: [],                          description: "Measure request latency" },
  "captcha-pull": { args: ["--entity", "--type", "--endpoint", "--output", "--quiet"], description: "Pull one CAPTCHA" },
  "captcha-set":  { args: ["--type", "--token"],       description: "Save a CAPTCHA token" },
  "captcha-show": { args: [],                          description: "Show the saved token" },
  "captcha-solve":{ args: ["--v3", "--type"],          description: "Solve CAPTCHA via CapSolver" },
  "captcha-watch":{ args: ["--entity", "--type", "--interval", "--max-duration", "--endpoint", "--output"], description: "Watch CAPTCHA for a bounded duration (in-process)" },
  "captcha-start":{ args: ["--entity", "--type", "--interval", "--endpoint", "--output"], description: "Start in-process background CAPTCHA refresher" },
  "captcha-status":{ args: [],                         description: "Show background refresher status" },
  "captcha-stop": { args: [],                          description: "Stop the background refresher" },
  help:           { args: [],                          description: "Show CLI help" },
};

// Commands that are blocked from subprocess execution (handled in-process instead)
const CMD_BLOCKED = new Set([
  // All captcha commands are now handled in-process — none blocked
]);

/**
 * Execute a CLI command as a subprocess and capture stdout/stderr/exit code.
 * @param {string[]} argv - command args (e.g. ["info"] or ["send", "12345"])
 * @param {object} options
 * @param {number} options.timeout - max execution time in ms (default: 30000)
 * @param {string} options.cwd - working directory (default: project root)
 * @returns {Promise<{ok: boolean, exitCode: number, stdout: string, stderr: string, command: string}>}
 */
function runCliCommand(argv, options = {}) {
  const timeout = options.timeout ?? 30_000;
  const cwd = options.cwd ?? PROJECT_ROOT;

  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI_PATH, ...argv], {
      cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        ok: code === 0 && !timedOut,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
        command: `nusuk ${argv.join(" ")}`,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        exitCode: -1,
        stdout: stdout.trim(),
        stderr: err.message,
        timedOut: false,
        command: `nusuk ${argv.join(" ")}`,
      });
    });
  });
}

/**
 * Parse the /cmd request body into CLI argv.
 * Supports two shapes:
 *   { "command": "info" }
 *   { "command": "send", "args": ["12345", "--no-test"] }
 *   { "argv": ["info"] }
 */
function parseCmdRequest(body) {
  if (Array.isArray(body.argv)) {
    return body.argv.map(String);
  }
  if (body.command) {
    const cmd = String(body.command).trim();
    const args = Array.isArray(body.args) ? body.args.map(String) : [];
    return [cmd, ...args];
  }
  return null;
}

async function handleCmd(body) {
  const argv = parseCmdRequest(body);
  if (!argv || argv.length === 0) {
    throw new Error("Request body must include 'command' or 'argv'. See /cmd/list for available commands.");
  }

  const cmdStr = argv.join(" ");

  // Block dangerous commands
  for (const blocked of CMD_BLOCKED) {
    if (cmdStr.startsWith(blocked)) {
      throw new Error(`Command "${blocked}" is blocked over HTTP (long-running). Use the CLI directly.`);
    }
  }

  // Validate command exists in catalog
  const baseCmd = argv[0];
  if (!CMD_CATALOG[baseCmd]) {
    const available = Object.keys(CMD_CATALOG).join(", ");
    throw new Error(`Unknown command: "${baseCmd}". Available: ${available}`);
  }

  // --- In-process handlers for long-running captcha commands ---
  // These bypass the subprocess and run natively in the server, making them
  // safe and controllable over HTTP.
  if (baseCmd === "captcha-watch") {
    const opts = parseCaptchaWatchArgs(argv.slice(1), body);
    const result = await captchaWatchBounded(opts);
    return { ok: true, command: cmdStr, ...result };
  }

  if (baseCmd === "captcha-start") {
    const opts = parseCaptchaStartArgs(argv.slice(1), body);
    const status = await captchaTaskStart(opts);
    return { ok: true, command: cmdStr, status };
  }

  if (baseCmd === "captcha-status") {
    return { ok: true, command: cmdStr, status: captchaTaskStatus() };
  }

  if (baseCmd === "captcha-stop") {
    const status = captchaTaskStop();
    return { ok: true, command: cmdStr, status };
  }

  const timeout = Number(body.timeout) || 30_000;
  // Cap timeout at 5 minutes for safety
  const cappedTimeout = Math.min(timeout, 300_000);

  const result = await runCliCommand(argv, { timeout: cappedTimeout });

  return {
    ok: result.ok,
    command: result.command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Parse argv for `captcha-watch` into options for captchaWatchBounded.
 * Supports both CLI-style flags (--entity 123) and body fields.
 */
function parseCaptchaWatchArgs(argv, body = {}) {
  const getArg = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  return {
    entityId: getArg("--entity") || body.entityId || process.env.ACTIVE_ENTITY_ID,
    type: getArg("--type") || body.type || "visa",
    interval: getArg("--interval") || body.interval || "5s",
    maxDuration: getArg("--max-duration") || body.maxDuration || 60_000,
    endpoint: getArg("--endpoint") || body.endpoint || process.env.WORKER_URL,
    output: getArg("--output") || body.output || process.env.CAPTCHA_PATH || "captcha.json",
    strict: body.strict !== false,
  };
}

/**
 * Parse argv for `captcha-start` into options for captchaTaskStart.
 */
function parseCaptchaStartArgs(argv, body = {}) {
  const getArg = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  return {
    entityId: getArg("--entity") || body.entityId || process.env.ACTIVE_ENTITY_ID,
    type: getArg("--type") || body.type || "visa",
    interval: getArg("--interval") || body.interval || "5s",
    endpoint: getArg("--endpoint") || body.endpoint || process.env.WORKER_URL,
    output: getArg("--output") || body.output || process.env.CAPTCHA_PATH || "captcha.json",
    strict: body.strict !== false,
  };
}

async function handleCmdList() {
  const commands = Object.entries(CMD_CATALOG).map(([name, info]) => ({
    name,
    description: info.description,
    allowedArgs: info.args,
  }));
  return { ok: true, commands, blocked: [...CMD_BLOCKED] };
}

const ROUTES = {
  "/": async () => ({ ok: true, service: "toque-container" }),
  "/health": async () => ({ ok: true }),
  "/pull": handlePull,
  "/info": handleInfo,
  "/send": handleSend,
  "/api": handleApi,
  "/request": handleRequest,
  "/groups": handleGroups,
  "/captcha/solve": handleCaptchaSolve,
  "/schedule": handleSchedule,
  "/api-list": handleListApis,
  "/cmd": handleCmd,
  "/cmd/list": handleCmdList,
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const handler = ROUTES[url.pathname];

  if (!handler) {
    return jsonResponse(res, 404, { ok: false, error: `Unknown route: ${url.pathname}` });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.method === "POST" ? await parseBody(req) : {};
    const result = await handler(body);
    jsonResponse(res, result.status && !result.ok ? result.status : 200, result);
  } catch (err) {
    jsonResponse(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Toque container listening on port ${PORT}`);
});
