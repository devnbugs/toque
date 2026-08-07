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
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
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
    browserOptions: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--single-process",
      ],
    },
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
  requireEnv(["WORKER_URL", "WORKER_API_TOKEN"]);
  const worker = new AuthaWorker({
    endpoint: process.env.WORKER_URL,
    apiToken: process.env.WORKER_API_TOKEN,
    entityId: body.activeEntityId || process.env.ACTIVE_ENTITY_ID,
    systemUserId: body.systemUserId || process.env.SYSTEM_USER_ID,
  });
  const context = await worker.fetchContext(undefined, { refresh: Boolean(body.refresh) });

  // Persist the pulled context to local files so subsequent commands
  // (info, send, schedule, etc.) auto-read auth/captcha/entity without
  // needing ACTIVE_ENTITY_ID or SYSTEM_USER_ID env vars.
  const { writeFileSync, existsSync, readFileSync } = await import("fs");
  const authPath = process.env.AUTH_PATH || "auth.json";
  const captchaPath = process.env.CAPTCHA_PATH || "captcha.json";
  const entityPath = process.env.ENTITY_CONFIG_PATH || "entity.json";

  const entityId = context.entityId || context.entity?.entityId;
  const token = worker.extractToken(context.auth);
  const captchaOptions = context.captcha || {};
  const captcha =
    captchaOptions.visa?.captchaToken ||
    captchaOptions.latest?.captchaToken ||
    captchaOptions.login?.captchaToken ||
    null;

  if (token) {
    const existingAuth = existsSync(authPath) ? JSON.parse(readFileSync(authPath, "utf8")) : {};
    existingAuth.response = existingAuth.response || { data: { authInfo: {} } };
    existingAuth.response.data = existingAuth.response.data || { authInfo: {} };
    existingAuth.response.data.authInfo = existingAuth.response.data.authInfo || {};
    existingAuth.response.data.authInfo.userToken = token;
    if (entityId) existingAuth.response.data.authInfo.entityId = entityId;
    writeFileSync(authPath, JSON.stringify(existingAuth, null, 2));
  }

  if (captcha) {
    const existingCaptcha = existsSync(captchaPath) ? JSON.parse(readFileSync(captchaPath, "utf8")) : {};
    existingCaptcha.visa = captcha;
    existingCaptcha.captchaToken = captcha;
    existingCaptcha.entityId = existingCaptcha.entityId || entityId;
    existingCaptcha.updatedAt = new Date().toISOString();
    writeFileSync(captchaPath, JSON.stringify(existingCaptcha, null, 2));
  }

  if (entityId || context.systemUserId) {
    const existingEntity = existsSync(entityPath) ? JSON.parse(readFileSync(entityPath, "utf8")) : {};
    const capturedEntity = context.entity || {};
    existingEntity.activeEntityId = capturedEntity.activeEntityId || capturedEntity.entityId || entityId;
    existingEntity.activeEntityTypeId = capturedEntity.activeEntityTypeId || existingEntity.activeEntityTypeId;
    existingEntity.entityId = capturedEntity.entityId || entityId;
    existingEntity.entityTypeId = capturedEntity.entityTypeId || existingEntity.entityTypeId;
    existingEntity.systemUserId = context.systemUserId || worker.systemUserId;
    writeFileSync(entityPath, JSON.stringify(existingEntity, null, 2));
  }

  return {
    ok: true,
    context,
    saved: {
      auth: Boolean(token),
      captcha: Boolean(captcha),
      entityId: entityId || null,
      systemUserId: context.systemUserId || worker.systemUserId || null,
    },
  };
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

/**
 * Handle a schedule request that delegates to the Cloudflare Workflow.
 *
 * Instead of blocking with setTimeout inside the container (which is lost
 * if the container sleeps or restarts), this returns immediately with a
 * workflow instance ID. The Workflow runs in the Worker runtime and
 * durably sleeps until the target time, then calls /send on the container.
 *
 * The container's /schedule/workflow endpoint is NOT called directly by
 * clients — the Worker's /schedule/workflow route creates the Workflow
 * instance. This handler exists for internal container-to-container calls
 * and for environments where the container is accessed directly.
 */
async function handleScheduleWorkflow(body) {
  // This is a fallback for direct container access. Normally the Worker
  // creates the Workflow instance via env.VISA_SCHEDULE_WORKFLOW.create().
  // When called directly on the container, we fall back to setTimeout.
  return handleSchedule(body);
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
  workflow:       { args: ["status", "terminate"],            description: "Manage Cloudflare Workflow instances" },
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

/**
 * Full API documentation — all endpoints, methods, usage, and examples.
 * Exposed via GET /help and GET / on the container.
 */
const API_DOCS = [
  {
    method: "GET",
    path: "/help",
    description: "Show this API documentation with all endpoints, usage, and examples",
    auth: false,
  },
  {
    method: "GET",
    path: "/",
    description: "Health check — returns service name and status",
    auth: false,
    example: "curl https://toque.decloud.workers.dev/",
  },
  {
    method: "GET",
    path: "/health",
    description: "Health check — returns { ok: true }",
    auth: false,
  },
  {
    method: "POST",
    path: "/pull",
    description: "Pull fresh auth, captcha, and entity context from the autha-worker. Saves to auth.json, captcha.json, entity.json inside the container so subsequent commands auto-read them.",
    auth: "WORKER_API_TOKEN",
    body: {
      activeEntityId: "string (optional — overrides entity.json)",
      systemUserId: "string (optional — overrides entity.json)",
      refresh: "boolean (optional — force refresh, default false)",
    },
    example: 'curl -X POST https://toque.decloud.workers.dev/pull -H "Content-Type: application/json" -d \'{"refresh": true}\'',
    response: {
      ok: true,
      context: "{ ... auth, captcha, entity data from worker }",
      saved: { auth: true, captcha: true, entityId: "525513", systemUserId: "rhsalisu" },
    },
  },
  {
    method: "POST",
    path: "/info",
    description: "Fetch dashboard company info from Nusuk API",
    auth: "auth.json (run /pull first)",
    body: {
      authToken: "string (optional — overrides auth.json)",
      activeEntityId: "string (optional — overrides entity.json)",
    },
    example: 'curl -X POST https://toque.decloud.workers.dev/info -H "Content-Type: application/json" -d \'{}\'',
    response: { ok: true, status: 200, data: "{ ...company info }" },
  },
  {
    method: "POST",
    path: "/send",
    description: "Send a visa request for a group",
    auth: "auth.json + captcha.json (run /pull first)",
    body: {
      groupId: "string (required — group ID)",
      payload: "object (optional — custom visa payload)",
      captchaToken: "string (optional — overrides captcha.json)",
      captchaType: "string (optional — visa|login|general, default: visa)",
    },
    example: 'curl -X POST https://toque.decloud.workers.dev/send -H "Content-Type: application/json" -d \'{"groupId": "12345"}\'',
    response: { ok: true, status: 200, data: "{ ...visa response }", timing: "{ total, ttfb }" },
  },
  {
    method: "POST",
    path: "/api",
    description: "Run a saved API request from the catalog (see /api-list)",
    auth: "auth.json (run /pull first)",
    body: {
      name: "string (required — request name, e.g. 'company-info', 'group-list')",
      rawJson: "boolean (optional — return raw JSON without parsing)",
    },
    example: 'curl -X POST https://toque.decloud.workers.dev/api -H "Content-Type: application/json" -d \'{"name": "company-info"}\'',
    response: { ok: true, status: 200, data: "{ ...API response }", timing: "{ total, ttfb }" },
  },
  {
    method: "GET",
    path: "/api-list",
    description: "List all saved API requests in the catalog",
    auth: false,
    example: "curl https://toque.decloud.workers.dev/api-list",
    response: { ok: true, requests: "[{ name, path, method, captcha, payload }] " },
  },
  {
    method: "POST",
    path: "/request",
    description: "Send a custom API request to any Nusuk endpoint path",
    auth: "auth.json (run /pull first)",
    body: {
      path: "string (required — API path, e.g. '/umrah/groups_apis/api/Groups/GetGroupList')",
      method: "string (optional — GET|POST|PUT|DELETE, default: GET)",
      payload: "object (optional — request body)",
      headers: "object (optional — extra headers)",
    },
    example: 'curl -X POST https://toque.decloud.workers.dev/request -H "Content-Type: application/json" -d \'{"path": "/umrah/reports_apis/api/Dashboard/DashboardCompanyInfo", "method": "POST", "payload": {}}\'',
    response: { ok: true, status: 200, data: "{ ...response }", timing: "{ total, ttfb }" },
  },
  {
    method: "POST",
    path: "/groups",
    description: "List groups with pagination",
    auth: "auth.json (run /pull first)",
    body: {
      limit: "number (optional — default 10)",
      offset: "number (optional — default 0)",
      raw: "boolean (optional — return raw JSON)",
    },
    example: 'curl -X POST https://toque.decloud.workers.dev/groups -H "Content-Type: application/json" -d \'{"limit": 10}\'',
    response: { ok: true, status: 200, groups: "[{ id, name }]", raw: "(if raw=true)" },
  },
  {
    method: "POST",
    path: "/captcha/solve",
    description: "Solve a CAPTCHA via CapSolver",
    auth: "CAPSOLVER_API_KEY env var",
    body: {
      siteKey: "string (optional — overrides CAPSOLVER_SITE_KEY)",
      pageUrl: "string (optional — overrides CAPSOLVER_PAGE_URL)",
      pageAction: "string (optional — overrides CAPSOLVER_PAGE_ACTION)",
    },
    example: 'curl -X POST https://toque.decloud.workers.dev/captcha/solve -H "Content-Type: application/json" -d \'{}\'',
    response: { ok: true, token: "captcha-token-string" },
  },
  {
    method: "POST",
    path: "/schedule",
    description: "Schedule a timed visa request (blocks until target time, then sends). For durable scheduling use /schedule/workflow instead.",
    auth: "auth.json + captcha.json (run /pull first)",
    body: {
      target: "string (required — HH:MM:SS[.mmm] target time)",
      groupId: "string (required — group ID)",
      payload: "object (optional — custom visa payload)",
      captchaType: "string (optional — visa|login|general, default: visa)",
    },
    example: 'curl -X POST https://toque.decloud.workers.dev/schedule -H "Content-Type: application/json" -d \'{"target": "21:00:00.500", "groupId": "12345"}\'',
    response: { ok: true, status: 200, data: "{ ...visa response }", scheduledAt: "ISO", firedAt: "ISO" },
  },
  {
    method: "POST",
    path: "/schedule/workflow",
    description: "Create a durable Cloudflare Workflow instance for scheduled visa send. Survives container sleep/restart. Uses step.sleepUntil() + retried step.do().",
    auth: "none (runs in Worker runtime)",
    body: {
      targetTime: "string (required — ISO string or HH:MM:SS[.mmm] / HH:MM:SS:mmm)",
      groupId: "string (required — group ID)",
      captcha: "boolean (optional — default true)",
      captchaType: "string (optional — visa|login|general, default: visa)",
      payload: "object (optional — custom visa payload)",
      pullBefore: "boolean (optional — pull fresh creds before send, default true)",
    },
    example: 'curl -X POST https://toque.decloud.workers.dev/schedule/workflow -H "Content-Type: application/json" -d \'{"targetTime": "21:00:00:000", "groupId": "12345", "captcha": true}\'',
    response: { ok: true, instanceId: "abc-123", targetTime: "ISO", groupId: "12345" },
  },
  {
    method: "GET",
    path: "/schedule/workflow/status",
    description: "Check the status of a Workflow instance",
    auth: "none",
    params: { instanceId: "string (required — workflow instance ID)" },
    example: "curl 'https://toque.decloud.workers.dev/schedule/workflow/status?instanceId=abc-123'",
    response: { ok: true, instanceId: "abc-123", status: "{ status, steps, ... }" },
  },
  {
    method: "POST",
    path: "/schedule/workflow/terminate",
    description: "Terminate a running Workflow instance",
    auth: "none",
    body: { instanceId: "string (required — workflow instance ID)" },
    example: 'curl -X POST https://toque.decloud.workers.dev/schedule/workflow/terminate -H "Content-Type: application/json" -d \'{"instanceId": "abc-123"}\'',
    response: { ok: true, instanceId: "abc-123", terminated: true },
  },
  {
    method: "POST",
    path: "/cmd",
    description: "Run any CLI command as a subprocess. See /cmd/list for available commands.",
    auth: "varies by command",
    body: {
      command: "string (required — command name, e.g. 'info', 'send', 'bench')",
      args: "string[] (optional — command arguments, e.g. ['15'] for bench)",
      argv: "string[] (alternative — full argv array, e.g. ['bench', '15'])",
      timeout: "number (optional — max execution time in ms, default 30000, max 300000)",
    },
    example: 'curl -X POST https://toque.decloud.workers.dev/cmd -H "Content-Type: application/json" -d \'{"command": "bench", "args": ["15"]}\'',
    response: { ok: true, command: "nusuk bench 15", exitCode: 0, stdout: "...", stderr: "" },
  },
  {
    method: "GET",
    path: "/cmd/list",
    description: "List all available CLI commands exposed via /cmd",
    auth: false,
    example: "curl https://toque.decloud.workers.dev/cmd/list",
    response: { ok: true, commands: "[{ name, description, allowedArgs }]", blocked: "[]" },
  },
];

function handleHelp() {
  return {
    ok: true,
    service: "toque-container",
    version: "1.0.0",
    endpoints: API_DOCS,
  };
}

const ROUTES = {
  "/": handleHelp,
  "/help": handleHelp,
  "/health": async () => ({ ok: true }),
  "/pull": handlePull,
  "/info": handleInfo,
  "/send": handleSend,
  "/api": handleApi,
  "/request": handleRequest,
  "/groups": handleGroups,
  "/captcha/solve": handleCaptchaSolve,
  "/schedule": handleSchedule,
  "/schedule/workflow": handleScheduleWorkflow,
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
