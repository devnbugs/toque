#!/usr/bin/env node

import "dotenv/config";
import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { Nusuk } from "../src/nusuk.js";
import { AuthaWorker } from "../src/worker.js";
import { parseJwt } from "../src/jwt.js";
import { CapSolver } from "../src/capsolver.js";
import { parsePositiveCount, parseTargetTime } from "../src/validation.js";
import { computeSendSchedule } from "../src/scheduling.js";
import { buildVisaPayload } from "../src/visa-payload.js";
import { summarizeRequestTiming } from "../src/timing.js";
import {
  isProcessRunning,
  normalizeCaptchaType,
  parseInterval,
  pullCaptchaOnce,
  readPidFile,
  runCaptchaPullLoop,
} from "../src/captcha-puller.js";
import { getRequest, listRequests } from "../src/requests.js";
import { extractGroups, formatGroups, normalizeGroupId, parseGroupSelection } from "../src/groups.js";

function ms(ms) {
  return `${ms}ms`;
}

function formatTime(date) {
  return date.toTimeString().slice(0, 8) + "." + String(date.getMilliseconds()).padStart(3, "0");
}

function formatCurlPreview(url, headers, payload) {
  const lines = [];
  lines.push(`curl --request POST --url '${url}'`);
  for (const [key, value] of Object.entries(headers)) {
    const safeValue = String(value).replace(/'/g, "'\\''");
    lines.push(`  -H '${key.toLowerCase()}: ${safeValue}'`);
  }
  if (payload !== undefined && payload !== null) {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const safeBody = body.replace(/'/g, "'\\''");
    lines.push(`  --data-raw '${safeBody}'`);
  }
  return lines.join("\\n");
}

function canPrompt() {
  return Boolean(input.isTTY && output.isTTY);
}

async function ask(question) {
  if (!canPrompt()) return null;
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function hasCaptchaToken(data) {
  return Boolean(
    data?.captchaToken || data?.visa || data?.login || data?.general
  );
}

function findAuth() {
  const candidates = [
    process.env.AUTH_PATH,
    "auth.json",
    resolve(process.cwd(), "auth.json"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, "utf8"));
        if (parseJwt(data?.response?.data?.authInfo?.userToken)) return p;
      } catch {}
    }
  }
  return null;
}

function findCaptcha() {
  const candidates = [
    process.env.CAPTCHA_PATH,
    "captcha.json",
    resolve(process.cwd(), "captcha.json"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, "utf8"));
        if (hasCaptchaToken(data)) return p;
      } catch {}
    }
  }
  return null;
}

function readCaptchaToken(type = "visa") {
  const p = findCaptcha();
  if (!p) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    return (
      data[type] ||
      data.captchaToken ||
      data.visa ||
      data.login ||
      data.general ||
      null
    );
  } catch {
    return null;
  }
}

function parsePayloadOptions(args, { defaultCaptchaType = "visa" } = {}) {
  const dataIdx = args.indexOf("--data");
  const dataRawIdx = args.indexOf("--data-raw");
  const dataStr = dataIdx !== -1 ? args[dataIdx + 1] : null;
  const dataRawStr = dataRawIdx !== -1 ? args[dataRawIdx + 1] : null;
  let payload = undefined;
  if (dataStr !== null) {
    try {
      payload = JSON.parse(dataStr);
    } catch {
      payload = dataStr;
    }
  } else if (dataRawStr !== null) {
    try {
      payload = JSON.parse(dataRawStr);
    } catch {
      payload = dataRawStr;
    }
  }
  const captchaTypeIndex = args.indexOf("--captcha-type");
  const captchaType = captchaTypeIndex !== -1 ? args[captchaTypeIndex + 1] : defaultCaptchaType;
  const useCaptcha = args.includes("--captcha");
  return { payload, captchaType, useCaptcha };
}

function injectCaptchaToken(payload, captchaToken) {
  if (!captchaToken) return payload;
  if (payload === undefined || payload === null) {
    return { captchaToken, recaptchaToken: captchaToken };
  }
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      console.warn(
        "Warning: --data payload is not valid JSON; captcha token cannot be injected automatically"
      );
      return payload;
    }
  }
  return typeof payload === "object"
    ? {
        ...payload,
        captchaToken: payload?.captchaToken || captchaToken,
        recaptchaToken: payload?.recaptchaToken || captchaToken,
      }
    : payload;
}

function writePrivateJson(path, data) {
  const absolutePath = resolve(path);
  const temporaryPath = resolve(
    dirname(absolutePath),
    `.${absolutePath.split("/").pop()}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    writeFileSync(temporaryPath, JSON.stringify(data, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporaryPath, absolutePath);
    chmodSync(absolutePath, 0o600);
  } catch (error) {
    try { unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

function writeAuthToken(token, entityId) {
  const authPath = process.env.AUTH_PATH || "auth.json";
  const data = { response: { data: { authInfo: { userToken: token } } } };
  if (entityId) data.entityId = String(entityId);
  writePrivateJson(authPath, data);
}

function ensureInitFiles() {
  const created = [];
  const files = ["auth.json", "captcha.json", "entity.json"];
  for (const file of files) {
    if (!existsSync(file)) {
      writePrivateJson(file, {});
      created.push(file);
    }
  }

  if (!existsSync(".env")) {
    if (existsSync(".env.example")) {
      copyFileSync(".env.example", ".env");
    } else {
      writeFileSync(".env", "", { mode: 0o600 });
    }
    created.push(".env");
  }

  return created;
}

async function cmdInit(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: nusuk init

Creates ignored local configuration files after cloning the repository.
`);
    return;
  }

  const created = ensureInitFiles();
  if (created.length === 0) {
    console.log("All local ignored files already exist.");
    return;
  }
  for (const file of created) {
    console.log(`Created ${file}`);
  }
}

function runCommandSync(command, args = []) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function getTimeSource() {
  return process.env.TIME_SYNC_SOURCE || "https://worldtimeapi.org/api/timezone/Etc/UTC";
}

function formatTimeSpan(msValue) {
  return `${msValue >= 0 ? "+" : ""}${msValue}ms`;
}

function isFileSource(source) {
  if (source.startsWith("file://")) return true;
  return existsSync(source);
}

function fetchWithTool(source) {
  const candidates = [
    { command: "curl", args: ["-fsL", source] },
    { command: "wget", args: ["-qO-", source] },
  ];

  for (const { command, args } of candidates) {
    const result = runCommandSync(command, args);
    if (result.status === 0 && result.stdout) {
      return result.stdout;
    }
  }

  throw new Error("No available HTTP fetch tool found (curl or wget) or all fetch attempts failed.");
}

async function fetchNetworkTime(source) {
  if (isFileSource(source)) {
    let sourcePath = source;
    if (source.startsWith("file://")) {
      sourcePath = fileURLToPath(source);
    }
    const raw = readFileSync(sourcePath, "utf8");
    const data = JSON.parse(raw);
    const remoteIso = data.utc_datetime || data.datetime || data.utcDateTime || data.currentDateTime || null;
    if (!remoteIso) {
      throw new Error("Time source file returned an unsupported payload");
    }
    const networkTime = new Date(remoteIso);
    if (Number.isNaN(networkTime.getTime())) {
      throw new Error("Time source file returned an invalid timestamp");
    }
    return networkTime;
  }

  let body;
  try {
    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Time source returned ${response.status} ${response.statusText}`);
    }
    body = await response.text();
  } catch (error) {
    body = fetchWithTool(source);
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (error) {
    throw new Error(`Failed to parse time source response: ${error.message}`);
  }

  const remoteIso = data.utc_datetime || data.datetime || data.utcDateTime || data.currentDateTime || null;
  if (!remoteIso) {
    throw new Error("Time source returned an unsupported payload");
  }

  const networkTime = new Date(remoteIso);
  if (Number.isNaN(networkTime.getTime())) {
    throw new Error("Time source returned an invalid timestamp");
  }
  return networkTime;
}

async function cmdSyncTime(args) {
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: nusuk sync-time [--dry-run] [--source <url>]\n\nOptions:\n  --dry-run            Show network time and offset without changing system clock\n  --source <url>       Use a custom time source URL (default: ${getTimeSource()})\n`);
    return;
  }

  const source = getArg("--source") || getTimeSource();
  const dryRun = args.includes("--dry-run");
  const pool = "pool.ntp.org";

  if (dryRun) {
    const networkTime = await fetchNetworkTime(source);
    const localTime = new Date();
    const offsetMs = networkTime.getTime() - localTime.getTime();
    console.log(`Network time: ${networkTime.toISOString()}`);
    console.log(`Local time  : ${localTime.toISOString()}`);
    console.log(`Clock offset: ${formatTimeSpan(offsetMs)}`);
    console.log("Dry run complete. No system clock changes were made.");
    return;
  }

  if (process.platform === "win32") {
    console.error("Automatic time synchronization is not supported on Windows by this CLI.");
    process.exitCode = 1;
    return;
  }

  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    console.error("Root privileges are required to set the system clock. Re-run as root or with sudo.");
    process.exitCode = 1;
    return;
  }

  if (process.platform === "linux") {
    let result = runCommandSync("timedatectl", ["set-ntp", "true"]);
    if (result.status === 0) {
      console.log("Enabled timedatectl NTP sync.");
      return;
    }

    result = runCommandSync("ntpdate", ["-u", pool]);
    if (result.status === 0) {
      console.log(result.stdout.trim() || "System time synchronized via ntpdate.");
      return;
    }

    let networkTime;
    try {
      networkTime = await fetchNetworkTime(source);
    } catch (error) {
      console.error(error.message);
      console.error("Unable to update clock via timedatectl or ntpdate.");
      process.exitCode = 1;
      return;
    }

    result = runCommandSync("date", ["-s", networkTime.toISOString()]);
    if (result.status === 0) {
      console.log("System clock updated using date.");
      return;
    }
    console.error("Unable to adjust system clock. Ensure timedatectl or ntpdate is installed and try again.");
    process.exitCode = 1;
    return;
  }

  if (process.platform === "darwin") {
    let result = runCommandSync("sntp", ["-sS", pool]);
    if (result.status === 0) {
      console.log(result.stdout.trim() || "System time synchronized via sntp.");
      return;
    }

    let networkTime;
    try {
      networkTime = await fetchNetworkTime(source);
    } catch (error) {
      console.error(error.message);
      console.error("Unable to update clock via sntp.");
      process.exitCode = 1;
      return;
    }

    const dateArg = networkTime.toISOString().replace(/T/, " ").replace(/Z$/, "");
    result = runCommandSync("date", ["-u", dateArg]);
    if (result.status === 0) {
      console.log("System clock updated using date.");
      return;
    }
    console.error("Unable to adjust system clock. Ensure sntp is installed and try again.");
    process.exitCode = 1;
    return;
  }

  console.error(`Automatic time sync is not implemented for platform: ${process.platform}`);
  process.exitCode = 1;
}

function writeCaptchaToken(token, type = "visa") {
  const captchaPath = process.env.CAPTCHA_PATH || "captcha.json";
  const existing = existsSync(captchaPath)
    ? JSON.parse(readFileSync(captchaPath, "utf8"))
    : {};
  existing[type] = token;
  existing.captchaToken = token;
  existing.entityId = existing.entityId || process.env.ACTIVE_ENTITY_ID || readEntityId();
  existing.updatedAt = new Date().toISOString();
  writePrivateJson(captchaPath, existing);
}

function readEntityId() {
  const filePath = process.env.ENTITY_CONFIG_PATH || "entity.json";
  try {
    return JSON.parse(readFileSync(filePath, "utf8")).activeEntityId || null;
  } catch {
    return null;
  }
}

function readStoredGroupId() {
  const filePath = process.env.ENTITY_CONFIG_PATH || "entity.json";
  try {
    return JSON.parse(readFileSync(filePath, "utf8")).groupId || null;
  } catch {
    return null;
  }
}

function writeStoredGroupId(groupId) {
  const entityPath = process.env.ENTITY_CONFIG_PATH || "entity.json";
  const existing = existsSync(entityPath)
    ? JSON.parse(readFileSync(entityPath, "utf8"))
    : {};
  writePrivateJson(entityPath, {
    ...existing,
    groupId: String(groupId),
  });
}

async function pullCreds({ entityId, type = "visa", endpoint, quiet = false } = {}) {
  entityId = entityId || process.env.ACTIVE_ENTITY_ID || readEntityId();

  const worker = new AuthaWorker({ endpoint, entityId });
  if (!quiet) {
    console.log(`Pulling from ${worker.endpoint} (entity ${entityId}, system user ${worker.systemUserId}, captcha type ${type})...\n`);
  }

  const context = await worker.fetchContext(entityId, { refresh: true });
  return saveContext(context, { type, worker, quiet });
}

function saveContext(context, { type = "visa", worker, quiet = false } = {}) {
  const entityId = context.entityId || context.entity?.entityId;
  const token = worker.extractToken(context.auth);
  const captchaOptions = context.captcha || {};
  const captchaOrder = type === "login"
    ? [captchaOptions.login, captchaOptions.latest, captchaOptions.visa]
    : type === "general"
      ? [captchaOptions.latest, captchaOptions.visa, captchaOptions.login]
      : [captchaOptions.visa, captchaOptions.latest, captchaOptions.login];
  const captcha = captchaOrder.find((entry) => entry?.captchaToken)?.captchaToken || null;
  const authPath = process.env.AUTH_PATH || "auth.json";
  const captchaPath = process.env.CAPTCHA_PATH || "captcha.json";
  const entityPath = process.env.ENTITY_CONFIG_PATH || "entity.json";

  if (token) {
    writeAuthToken(token, entityId);
  }
  if (captcha) {
    const existingCaptcha = existsSync(captchaPath)
      ? JSON.parse(readFileSync(captchaPath, "utf8"))
      : {};
    existingCaptcha[type] = captcha;
    existingCaptcha.captchaToken = captcha;
    existingCaptcha.entityId = existingCaptcha.entityId || entityId;
    existingCaptcha.updatedAt = new Date().toISOString();
    writePrivateJson(captchaPath, existingCaptcha);
  }

  const capturedEntity = context.entity || {};
  if (capturedEntity.entityId || entityId) {
    const existingEntity = existsSync(entityPath)
      ? JSON.parse(readFileSync(entityPath, "utf8"))
      : {};
    writePrivateJson(entityPath, {
      ...existingEntity,
      activeEntityId: capturedEntity.activeEntityId || capturedEntity.entityId || entityId,
      activeEntityTypeId: capturedEntity.activeEntityTypeId || existingEntity.activeEntityTypeId,
      entityId: capturedEntity.entityId || entityId,
      entityTypeId: capturedEntity.entityTypeId || capturedEntity.activeEntityTypeId || existingEntity.entityTypeId,
      systemUserId: context.systemUserId || worker.systemUserId,
    });
  }

  return { token, captcha, authPath, captchaPath, entityPath, entityId, context };
}

async function cmdLogin(args) {
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  let systemUserId = getArg("--system-user") || process.env.SYSTEM_USER_ID || "";
  if (!systemUserId) {
    systemUserId = await ask("System user ID: ") || "";
  }
  if (!systemUserId) {
    throw new Error("System user ID is required. Pass --system-user <id> or set SYSTEM_USER_ID");
  }

  const worker = new AuthaWorker({
    endpoint: getArg("--endpoint"),
    systemUserId,
  });
  console.log(`Loading latest D1 context for system user ${systemUserId}...`);
  const context = await worker.fetchUserContext(systemUserId);
  const result = saveContext(context, {
    type: getArg("--type") || "visa",
    worker,
  });

  console.log(`  entity  : ${context.entityId}`);
  console.log(`  auth    : ${result.token ? "valid JWT saved" : "not available"}`);
  console.log(`  captcha : ${result.captcha ? "saved" : "not available"}`);
  console.log(`  files   : ${result.authPath}, ${result.captchaPath}, ${result.entityPath}`);
  if (!result.token) process.exitCode = 1;
}

async function cmdPull(args) {
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const entityId =
    getArg("--entity") || process.env.ACTIVE_ENTITY_ID || readEntityId();
  const type = getArg("--type") || "visa";
  const endpoint = getArg("--endpoint");

  if (!entityId) {
    console.error("Entity ID required. Use --entity <id> or set activeEntityId in entity.json");
    process.exit(1);
  }

  const { token, captcha, authPath, captchaPath, entityId: tokenEntityId } = await pullCreds({ entityId, type, endpoint });

  if (!token) console.error("  Warning: no auth token found in worker records");
  if (!captcha) console.error(`  Warning: no ${type} captcha found in worker`);

  console.log(`\n  auth    -> ${authPath}${token ? "" : " (skipped — none found)"}`);
  console.log(`  captcha -> ${captchaPath}${captcha ? "" : " (skipped — none found)"}`);
  if (token) console.log(`  token   : ${token.slice(0, 28)}... (entity ${tokenEntityId})`);
  if (captcha) console.log(`  captcha : ${captcha.slice(0, 28)}...`);

  if (!token && !captcha) process.exitCode = 1;
}

async function autoPull(type = "visa") {
  try {
    const result = await pullCreds({ type, quiet: true });
    if (result.token || result.captcha) {
      const files = [result.token && result.authPath, result.captcha && result.captchaPath]
        .filter(Boolean)
        .join(" and ");
      console.log(`  auto-created ${files} from worker`);
    }
    return result;
  } catch (e) {
    console.error(`  auto-pull from worker failed: ${e.message}`);
    return {};
  }
}

async function cmdBench(args) {
  const count = parsePositiveCount(args[0]);
  if (count === null) {
    throw new Error("Benchmark count must be an integer from 1 to 100");
  }
  const authPath = findAuth();
  const nusuk = authPath ? new Nusuk().loadAuth(authPath).loadEntity() : new Nusuk().loadEntity();
  await nusuk.init();

  try {
    console.log(`Sending ${count} test requests...\n`);
    const samples = [];
    for (let i = 0; i < count; i++) {
      const res = await nusuk.request("/manifest.json");
      const t = res.timing;
      samples.push(t);
      console.log(`  req ${i + 1}: total=${ms(t.total)}  ttfb=${ms(t.ttfb ?? "?")}  status=${res.status}`);
    }

    const totals = samples.map((s) => s.total);
    const ttfbVals = samples.map((s) => s.ttfb).filter(Boolean);
    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const min = (arr) => Math.min(...arr);

    const realTtfb = ttfbVals.filter((v) => v > 2);
    const minTtfb = realTtfb.length ? min(realTtfb) : (ttfbVals.length ? min(ttfbVals) : null);
    const avgTtfb = ttfbVals.length ? avg(ttfbVals) : null;
    const netOneWay = minTtfb ? Math.round(minTtfb / 2) : null;

    console.log(`\n--- Latency Stats ---`);
    console.log(`  total RTT  : min=${ms(min(totals))}  avg=${ms(avg(totals))}  max=${ms(Math.max(...totals))}`);
    if (ttfbVals.length) {
      const filtered = realTtfb.length < ttfbVals.length ? ` (${realTtfb.length}/${ttfbVals.length} real)` : "";
      console.log(`  ttfb       : min=${ms(minTtfb)}  avg=${ms(avgTtfb)}  max=${ms(Math.max(...ttfbVals))}${filtered}`);
      if (realTtfb.length) {
        console.log(`  server proc: ${ms(avgTtfb - minTtfb)}  (avg ttfb - min ttfb)`);
      }
    }
    if (netOneWay) {
      console.log(`  net 1-way  : ${ms(netOneWay)}  (min ttfb ÷ 2)  <-- request delivery`);
    }
    const oneway = netOneWay || Math.round(avg(totals) / 2);
    console.log(`  one-way ~  : ${ms(oneway)}`);
  } finally {
    await nusuk.close();
  }
}

async function cmdReq(args) {
  const { payload: initialPayload, captchaType, useCaptcha } = parsePayloadOptions(args, { defaultCaptchaType: "visa" });
  const rawJson = args.includes("--raw-json");
  const dataIdx = args.indexOf("--data");
  const captchaTypeIndex = args.indexOf("--captcha-type");
  const clean = args.filter((value, index) =>
    value !== "--captcha" &&
    value !== "--raw-json" &&
    value !== "--captcha-type" &&
    value !== "--data" &&
    (dataIdx === -1 || index !== dataIdx + 1) &&
    (captchaTypeIndex === -1 || index !== captchaTypeIndex + 1)
  );
  const path = clean[0];
  const method = (clean[1] || (initialPayload !== undefined ? "POST" : "GET")).toUpperCase();
  if (!path) {
    console.error("Usage: nusuk request <path> [method] [--data <json>] [--captcha] [--captcha-type <type>]");
    process.exit(1);
  }

  let payload = initialPayload;
  if (payload === undefined && ["POST", "PUT", "PATCH"].includes(method)) {
    payload = {};
  }
  if (useCaptcha) {
    const token = readCaptchaToken(captchaType);
    if (!token) console.error("Warning: captcha.json not found or empty");
    payload = injectCaptchaToken(payload, token);
  }

  const res = await executeRequest({ path, method, payload, useCaptcha, captchaType });
  if (rawJson) {
    if (res.json === null) {
      console.error(JSON.stringify({
        error: "Response is not JSON",
        status: res.status,
        contentType: res.headers?.["content-type"] || null,
        url: res.url,
      }, null, 2));
      process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify(res.json, null, 2));
    return;
  }
  console.log(`status: ${res.status}`);
  if (res.timing) console.log(`timing:`, res.timing);
  if (res.json) console.log(`body:`, JSON.stringify(res.json, null, 2));
  else console.log(`body:`, res.body);
}

async function executeRequest({ path, method = "GET", payload, useCaptcha = false, captchaType = "visa" }) {
  let authPath = findAuth();
  if (!authPath || (useCaptcha && !payload?.captchaToken)) {
    const pulled = await autoPull(captchaType);
    authPath = authPath || (pulled.token ? pulled.authPath : null);
    if (useCaptcha && !payload?.captchaToken && pulled.captcha) {
      payload = { ...(payload || {}), captchaToken: pulled.captcha };
    }
  }

  const nusuk = authPath ? new Nusuk().loadAuth(authPath).loadEntity() : new Nusuk().loadEntity();
  await nusuk.init();

  try {
    return await nusuk.request(path, { method, payload });
  } finally {
    await nusuk.close();
  }
}

function printNamedRequests() {
  console.log("Available requests:\n");
  for (const request of listRequests()) {
    console.log(`  ${request.name.padEnd(24)} ${request.method.padEnd(6)} ${request.description}`);
  }
  console.log("\nRun: nusuk api <name> [--raw-json]");
}

async function cmdApi(args) {
  const [name, ...options] = args;
  if (!name || name === "list") {
    printNamedRequests();
    return;
  }
  const request = getRequest(name);
  if (!request) {
    throw new Error(`Unknown request: ${name}. Run "nusuk api list" to see available requests`);
  }

  const requestArgs = [request.path, request.method];
  if (request.payload !== undefined) {
    requestArgs.push("--data", JSON.stringify(request.payload));
  }
  if (request.captcha) requestArgs.push("--captcha");
  if (options.includes("--raw-json")) requestArgs.push("--raw-json");
  return cmdReq(requestArgs);
}

async function fetchGroups({ limit = 10, offset = 0 } = {}) {
  const request = getRequest("group-list");
  const payload = { ...request.payload, limit, offset };
  const response = await executeRequest({
    path: request.path,
    method: request.method,
    payload,
  });
  if (response.json === null) throw new Error("Group list response is not JSON");
  const groups = extractGroups(response.json);
  if (groups === null) {
    throw new Error("Unsupported group-list response shape. Run `nusuk api group-list --raw-json` to inspect it");
  }
  return { groups, response };
}

async function cmdGroups(args) {
  const [action = "list", ...options] = args;
  if (action !== "list") throw new Error("Usage: nusuk groups list [--limit 10] [--offset 0] [--raw-json]");
  const getArg = (flag) => {
    const index = options.indexOf(flag);
    return index === -1 ? undefined : options[index + 1];
  };
  const limit = parsePositiveCount(getArg("--limit"), 10, 100);
  const offsetText = getArg("--offset") ?? "0";
  if (limit === null) throw new Error("Group limit must be an integer from 1 to 100");
  if (!/^\d+$/.test(offsetText) || !Number.isSafeInteger(Number(offsetText))) {
    throw new Error("Group offset must be a non-negative integer");
  }
  const { groups, response } = await fetchGroups({ limit, offset: Number(offsetText) });
  if (options.includes("--raw-json")) {
    console.log(JSON.stringify(response.json, null, 2));
    return;
  }
  console.log(`Groups (${groups.length}):\n`);
  console.log(formatGroups(groups));
}

async function selectGroup() {
  if (!canPrompt()) {
    throw new Error("Group ID is required in non-interactive mode. Run `nusuk groups list` or pass `nusuk send <group-id>`");
  }
  const { groups } = await fetchGroups();
  if (!groups.length) throw new Error("No groups found for the active entity");
  console.log(`\nSelect a group:\n\n${formatGroups(groups)}\n`);
  const selected = parseGroupSelection(await ask(`Choose 1-${groups.length} (or 0 to cancel): `), groups);
  if (!selected) return null;
  console.log(`Selected: ${selected.name} (ID: ${selected.id})`);
  return selected;
}

async function cmdSetGroupId(args = []) {
  const value = args[0] || null;
  if (!value) {
    console.error("Group ID is required. Usage: nusuk set-group-id <group-id>");
    process.exitCode = 1;
    return;
  }
  writeStoredGroupId(value);
  console.log(`Stored group ID: ${value}`);
}

async function cmdCaptchaSet(args = []) {
  const getArg = (flag) => {
    const index = args.indexOf(flag);
    return index !== -1 ? args[index + 1] : undefined;
  };
  const type = getArg("--type") || "visa";
  let token = getArg("--token");
  if (!token) {
    token = args.find((arg, index) => {
      if (arg.startsWith("-")) return false;
      return arg !== type || args[args.indexOf("--type") + 1] !== arg;
    });
  }
  token = token || process.env.CAPTCHA_TOKEN || "";
  if (!token) token = await ask("CAPTCHA token: ") || "";
  if (!token) {
    throw new Error("CAPTCHA token is required. Pass a token, use --token, or set CAPTCHA_TOKEN");
  }
  writeCaptchaToken(token, normalizeCaptchaType(type));
  console.log(`CAPTCHA token updated (${normalizeCaptchaType(type)})`);
}

async function cmdCaptchaShow() {
  const captchaPath = findCaptcha();
  if (!captchaPath) {
    console.log("captcha file not found (tried captcha.json)");
    return;
  }
  const data = JSON.parse(readFileSync(captchaPath, "utf8"));
  const hasVisa = typeof data.visa === "string" && data.visa;
  const hasLogin = typeof data.login === "string" && data.login;
  const hasGeneral = typeof data.general === "string" && data.general;
  const typedCount = [hasVisa, hasLogin, hasGeneral].filter(Boolean).length;

  if (typedCount > 1) {
    console.log(JSON.stringify({
      visa: data.visa || null,
      login: data.login || null,
      general: data.general || null,
    }, null, 2));
  } else if (typedCount === 1) {
    console.log(data.visa || data.login || data.general);
  } else {
    console.log(data.captchaToken || "(empty)");
  }
}

async function cmdCaptchaSolve(args) {
  const version = args.includes("--v3") ? 3 : 2;
  const solver = new CapSolver();
  console.log(`Solving reCAPTCHA v${version} via CapSolver (${solver.pageUrl})...`);
  const start = Date.now();
  const type = args.includes("--type") ? args[args.indexOf("--type") + 1] : "visa";
  const token = await solver.solve({
    version,
    onStatus: (res) =>
      console.log(`  status: ${res.status || "unknown"} (${((Date.now() - start) / 1000).toFixed(1)}s)`),
  });
  const normalizedType = normalizeCaptchaType(type);
  writeCaptchaToken(token, normalizedType);
  console.log(`\n  captcha token saved (${normalizedType}, ${((Date.now() - start) / 1000).toFixed(1)}s)`);
  console.log(`  token: ${token.slice(0, 28)}...`);
}

function captchaPullOptions(args) {
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    entityId: getArg("--entity") || process.env.ACTIVE_ENTITY_ID || readEntityId(),
    type: normalizeCaptchaType(getArg("--type") || process.env.CAPTCHA_PULL_TYPE || "visa"),
    endpoint: getArg("--endpoint"),
    outputPath: getArg("--output") || process.env.CAPTCHA_PATH || "captcha.json",
    interval: parseInterval(getArg("--interval") || process.env.CAPTCHA_PULL_INTERVAL, 5000),
    pidPath: resolve(getArg("--pid-file") || process.env.CAPTCHA_PULL_PID || ".nusuk-captcha.pid"),
    quiet: args.includes("--quiet"),
    strict: !args.includes("--fallback"),
  };
}

async function cmdCaptchaPull(args) {
  const options = captchaPullOptions(args);
  const result = await pullCaptchaOnce(options);
  if (!result.token) {
    throw new Error(`No ${options.type} CAPTCHA available for entity ${options.entityId}`);
  }
  if (!options.quiet) {
    console.log(`${options.type} CAPTCHA ${result.updated ? "saved" : "unchanged"} -> ${result.outputPath}`);
  }
}

async function cmdCaptchaWatch(args) {
  const options = captchaPullOptions(args);
  if (!options.entityId) throw new Error("Entity ID required (pass --entity or configure entity.json)");

  const existing = readPidFile(options.pidPath);
  if (existing && existing.pid !== process.pid && isProcessRunning(existing.pid)) {
    throw new Error(`CAPTCHA puller already running (PID ${existing.pid})`);
  }
  writePrivateJson(options.pidPath, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    entityId: String(options.entityId),
    type: options.type,
    outputPath: resolve(options.outputPath),
  });

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (!options.quiet) {
      console.log(`Watching ${options.type} CAPTCHA for entity ${options.entityId} every ${options.interval}ms`);
    }
    await runCaptchaPullLoop({ ...options, signal: controller.signal });
  } finally {
    const owned = readPidFile(options.pidPath);
    if (owned?.pid === process.pid) {
      try { unlinkSync(options.pidPath); } catch {}
    }
  }
}

async function cmdCaptchaStart(args) {
  const options = captchaPullOptions(args);
  if (!options.entityId) throw new Error("Entity ID required (pass --entity or configure entity.json)");
  const existing = readPidFile(options.pidPath);
  if (existing && isProcessRunning(existing.pid)) {
    throw new Error(`CAPTCHA puller already running (PID ${existing.pid})`);
  }
  if (existing) {
    try { unlinkSync(options.pidPath); } catch {}
  }

  const childArgs = [
    fileURLToPath(import.meta.url), "captcha", "watch",
    "--type", options.type,
    "--entity", String(options.entityId),
    "--output", options.outputPath,
    "--interval", String(options.interval),
    "--pid-file", options.pidPath,
    "--quiet",
  ];
  const endpointIndex = args.indexOf("--endpoint");
  if (endpointIndex !== -1 && args[endpointIndex + 1]) {
    childArgs.push("--endpoint", args[endpointIndex + 1]);
  }
  if (args.includes("--fallback")) childArgs.push("--fallback");

  const child = spawn(process.execPath, childArgs, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  if (!options.quiet) console.log(`CAPTCHA puller started (PID ${child.pid}, type ${options.type})`);
}

async function cmdCaptchaStatus(args) {
  const options = captchaPullOptions(args);
  const state = readPidFile(options.pidPath);
  if (!state || !isProcessRunning(state.pid)) {
    if (state) try { unlinkSync(options.pidPath); } catch {}
    console.log("CAPTCHA puller is not running");
    process.exitCode = 1;
    return;
  }
  console.log(`CAPTCHA puller running (PID ${state.pid}, type ${state.type}, entity ${state.entityId})`);
}

async function cmdCaptchaStop(args) {
  const options = captchaPullOptions(args);
  const state = readPidFile(options.pidPath);
  if (!state || !isProcessRunning(state.pid)) {
    if (state) try { unlinkSync(options.pidPath); } catch {}
    console.log("CAPTCHA puller is not running");
    return;
  }
  process.kill(state.pid, "SIGTERM");
  console.log(`Stopping CAPTCHA puller (PID ${state.pid})`);
}

async function cmdCaptcha(args) {
  const [action = "help", ...rest] = args;
  switch (action) {
    case "pull": return cmdCaptchaPull(rest);
    case "watch": return cmdCaptchaWatch(rest);
    case "start": return cmdCaptchaStart(rest);
    case "status": return cmdCaptchaStatus(rest);
    case "stop": return cmdCaptchaStop(rest);
    case "set": return cmdCaptchaSet(rest);
    case "show": return cmdCaptchaShow();
    case "solve": return cmdCaptchaSolve(rest);
    case "help": help("captcha"); return;
    default: throw new Error("Usage: nusuk captcha <pull|watch|start|status|stop|set|show|solve>");
  }
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.round(Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length));
}

function connectionQuality(stddev) {
  if (stddev <= 5) return { label: "stable", icon: "\u2714" };
  if (stddev <= 15) return { label: "moderate", icon: "\u26a0" };
  return { label: "jittery", icon: "\u274c" };
}

async function calibrate(nusuk, count, label) {
  console.log(`  ${label}`);
  const samples = [];
  for (let i = 0; i < count; i++) {
    const res = await nusuk.request("/manifest.json");
    samples.push(res.timing);
    console.log(`    req ${i + 1}: total=${ms(res.timing.total)}  ttfb=${ms(res.timing.ttfb ?? "?")}  status=${res.status}`);
  }
  return samples;
}

async function cmdSchedule(args) {
  const targetIdx = args.indexOf("--target");
  const scheduleIdx = args.indexOf("--schedule");
  const targetStr = targetIdx !== -1 ? args[targetIdx + 1] : scheduleIdx !== -1 ? args[scheduleIdx + 1] : null;
  const pathIdx = args.indexOf("--path");
  const path = pathIdx !== -1 ? args[pathIdx + 1] : "/umrah/groups_apis/api/Groups/SendToIssueVisa";
  const methodIdx = args.indexOf("--method");
  const method = methodIdx !== -1 ? args[methodIdx + 1].toUpperCase() : "POST";
  const countIdx = args.indexOf("--count");
  const count = parsePositiveCount(countIdx !== -1 ? args[countIdx + 1] : undefined);
  let { payload, captchaType, useCaptcha } = parsePayloadOptions(args, { defaultCaptchaType: "visa" });
  if (useCaptcha) {
    const token = readCaptchaToken(captchaType);
    if (!token) console.error("Warning: captcha.json not found or empty");
    payload = injectCaptchaToken(payload, token);
  }

  if (!targetStr) {
    console.error("Usage: nusuk schedule --target HH:MM:SS [--path /api/endpoint] [--count 5] [--captcha] [--captcha-type <type>]");
    process.exit(1);
  }
  if (count === null) {
    throw new Error("Calibration count must be an integer from 1 to 100");
  }
  const target = parseTargetTime(targetStr);
  if (!target) {
    console.error("Invalid target time. Use HH:MM:SS[.mmm] or HH:MM:SS:mmm");
    process.exit(1);
  }

  let authPath = findAuth();
  if (!authPath || (useCaptcha && !payload?.captchaToken)) {
    const pulled = await autoPull(captchaType);
    authPath = authPath || (pulled.token ? pulled.authPath : null);
    if (useCaptcha && !payload?.captchaToken && pulled.captcha) {
      payload = injectCaptchaToken(payload, pulled.captcha);
    }
  }
  if (!authPath) {
    console.error("No auth token found. Run `nusuk pull` first or check auth.json");
    process.exitCode = 1;
    return;
  }
  const nusuk = new Nusuk().loadAuth(authPath).loadEntity();
  await nusuk.init();

  try {
    // Phase 1: warm-up (establish connection, dismiss outliers)
    const warmup = await calibrate(nusuk, 2, "Warm-up");

    // Phase 2: full calibration
    const samples = await calibrate(nusuk, count, "Calibration");

    const totals = samples.map((s) => s.total);
    const ttfbVals = samples.map((s) => s.ttfb).filter(Boolean);
    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    // Use calibration data, fall back to warm-up if all cached (<2ms)
    let pool = [...samples.map((s) => s.ttfb).filter((v) => v > 2)];
    if (pool.length === 0) {
      pool = [...warmup.map((s) => s.ttfb).filter((v) => v > 2)];
    }
    const minTtfb = pool.length ? Math.min(...pool) : (ttfbVals.length ? Math.min(...ttfbVals) : null);
    const avgRealTtfb = pool.length ? avg(pool) : minTtfb;
    const sdTtfb = pool.length ? stddev(pool) : 0;

    // Weighted one-way: bias toward min but include avg for jitter
    const netOneWay = minTtfb ? Math.round((minTtfb * 0.6 + avgRealTtfb * 0.4) / 2) : Math.round(Math.min(...totals) / 4);
    const jitterBuffer = Math.min(sdTtfb + 20, 120);
    const sendAhead = netOneWay + jitterBuffer;
    const sendAt = new Date(target.getTime() - sendAhead);

    const quality = connectionQuality(sdTtfb);
    const driftRange = sdTtfb > 0 ? `\u00b1${sdTtfb}ms` : "\u22645ms";

    console.log(`\n--- Connection Quality ---`);
    console.log(`  stability    : ${quality.icon} ${quality.label}  (stddev ${ms(sdTtfb)}, drift ~${driftRange})`);
    console.log(`  min ttfb     : ${ms(minTtfb)}`);
    console.log(`  avg ttfb     : ${ms(avgRealTtfb)}`);
    console.log(`  weighted 1-way: ${ms(netOneWay)}  (min\xd70.6 + avg\xd70.4 \xf7 2)`);
    console.log(`  jitter buffer : ${ms(jitterBuffer)}`);
    console.log(`\n--- Schedule ---`);
    console.log(`  deliver to server: ${formatTime(target)}`);
    console.log(`  send at          : ${formatTime(sendAt)}  (${ms(sendAhead)} ahead)`);

    const waitMs = sendAt.getTime() - Date.now();
    if (waitMs > 0) {
      console.log(`  waiting ${ms(waitMs)}...`);

      // Phase 3: mid-calibration refresh at 60% of wait time
      if (waitMs > 5000) {
        const midWait = Math.round(waitMs * 0.6);
        await new Promise((r) => setTimeout(r, midWait));
        const refresh = await calibrate(nusuk, 2, "Mid-calibration refresh");

        const refreshTtfb = refresh.map((s) => s.ttfb).filter((v) => v > 2).filter(Boolean);
        if (refreshTtfb.length) {
          const refreshMin = Math.min(...refreshTtfb);
          const refreshAvg = avg(refreshTtfb);
          const refreshOneWay = Math.round((refreshMin * 0.6 + refreshAvg * 0.4) / 2);
          const adjustedAhead = refreshOneWay + jitterBuffer;
          const adjustedSend = new Date(target.getTime() - adjustedAhead);
          if (adjustedSend.getTime() < sendAt.getTime() + 200 && adjustedSend.getTime() > Date.now()) {
            console.log(`\n  \u21aa refresh 1-way: ${ms(refreshOneWay)}  -> adjusting send time`);
            sendAt.setTime(adjustedSend.getTime());
          } else {
            console.log(`\n  \u21aa refresh 1-way: ${ms(refreshOneWay)}  (keep original schedule)`);
          }
        }
      }

      const remaining = sendAt.getTime() - Date.now();
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));

      const sendActual = Date.now();
      const res = await nusuk.request(path, { method, payload });
      const responseReceived = Date.now();
      const serverArrival = sendActual + netOneWay;
      const drift = serverArrival - target.getTime();

      console.log(`\n--- Result ---`);
      console.log(`  sent at          : ${formatTime(new Date(sendActual))}`);
      console.log(`  ~server arrival  : ${formatTime(new Date(serverArrival))}`);
      console.log(`  target           : ${formatTime(target)}`);
      console.log(`  drift            : ${drift >= 0 ? "+" : ""}${drift}ms`);
      console.log(`  response received: ${formatTime(new Date(responseReceived))}`);
      console.log(`  response status  : ${res.status}`);
      if (res.timing) {
        console.log(`  actual ttfb      : ${ms(res.timing.total)}`);
      }
      if (res.json) console.log(`  response:`, JSON.stringify(res.json, null, 2).slice(0, 600));
    } else {
      console.log(`  target ${formatTime(target)} is too close or in the past.`);
    }
  } finally {
    await nusuk.close();
  }
}

const VISA_PATH = "/umrah/groups_apis/api/Groups/SendToIssueVisa";
const TOKEN_TEST_PATH = "/umrah/contracts_apis/api/UoSubscription/VerifySubscriptionStatus";
const CAPTCHA_REFRESH_AHEAD = 20 * 1000;

async function refreshVisaCaptcha(entityId, endpoint) {
  const worker = new AuthaWorker({ endpoint, entityId });
  const captcha = await worker.fetchLatestCaptcha(entityId, "visa");
  if (captcha) {
    writeCaptchaToken(captcha);
    console.log(`  refreshed visa captcha -> captcha.json`);
  }
  return captcha;
}

async function warmVisaConnection(nusuk, targetTime) {
  const warmupSamples = await calibrate(nusuk, 5, "Warm-up");
  return computeSendSchedule(targetTime, warmupSamples, {
    jitterBufferMs: 40,
    clientOverheadMs: 80,
  });
}

async function cmdSendVisa(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: nusuk send-visa <group-id> [--target HH:MM:SS|--schedule HH:MM:SS] [--data '{"key":"value"}'] [--captcha] [--captcha-type <type>] [--no-test] [--endpoint <url>] [--test-path <path>]`);
    return;
  }

  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const valueFlags = new Set(["--target", "--schedule", "--test-path", "--endpoint", "--data", "--captcha-type", "--no-test", "schedule"]);
  let groupId;
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.has(args[i])) {
      i++;
    } else if (!args[i].startsWith("-")) {
      groupId = args[i];
      break;
    }
  }
  const targetStr = getArg("--target") || getArg("--schedule") || (args.includes("schedule") ? args[args.indexOf("schedule") + 1] : undefined);
  const target = targetStr ? parseTargetTime(targetStr) : null;
  const testPath = getArg("--test-path");
  const endpoint = getArg("--endpoint");
  const { payload: dataPayload, captchaType, useCaptcha } = parsePayloadOptions(args, { defaultCaptchaType: "visa" });

  if (!groupId) {
    groupId = process.env.GROUP_ID || null;
  }
  if (!groupId && canPrompt()) {
    groupId = readStoredGroupId() || null;
  }
  if (typeof groupId === "string") groupId = groupId.trim();
  if (!groupId && !canPrompt()) {
    console.error("Group ID is required in non-interactive mode. Pass a group ID or set one with `nusuk set-group-id <id>`.");
    process.exit(1);
  }
  if (!groupId) {
    const selected = await selectGroup();
    if (!selected) {
      console.log("Cancelled.");
      return;
    }
    groupId = selected.id;
  }
  if (targetStr && !target) {
    console.error("Invalid target time. Use HH:MM:SS[.mmm] or HH:MM:SS:mmm, and it must be in the future.");
    process.exit(1);
  }

  const entityId = process.env.ACTIVE_ENTITY_ID || readEntityId();
  if (!entityId) {
    console.error("Entity ID required. Set activeEntityId in entity.json or ACTIVE_ENTITY_ID env");
    process.exit(1);
  }

  let authPath = findAuth();
  if (!authPath) {
    const pulled = await autoPull();
    authPath = pulled.token ? pulled.authPath : null;
  }
  if (!authPath) {
    console.error("No auth token found. Run `nusuk pull` first or check auth.json");
    process.exit(1);
  }

  const nusuk = new Nusuk().loadAuth(authPath).loadEntity();
  await nusuk.init();

  try {
    if (args.includes("--no-test")) {
      console.log("  token check skipped (--no-test)");
    } else {
      let status = null;
      let verified = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await nusuk.request(testPath || TOKEN_TEST_PATH, {
          method: "POST",
          payload: {},
        });
        status = res.status;
        verified = status === 200 && res.json?.response?.status === true;
        if (verified) break;
        console.error(`  token check failed (status ${status}), attempt ${attempt}`);
        const worker = new AuthaWorker({ endpoint, entityId });
        const fresh = await worker.fetchLatestAuthToken(entityId);
        if (!fresh) break;
        nusuk.setAuthToken(fresh.token);
        nusuk.setEntityId(fresh.entityId);
        writeAuthToken(fresh.token, fresh.entityId);
        console.log(`  pulled fresh auth token from worker (entity ${fresh.entityId})`);
      }
      if (!verified) {
        console.error(`Token check failed (status ${status}) — aborting before visa send`);
        process.exitCode = 1;
        return;
      }
      console.log(`  token OK (${status})`);
    }

    let payload = dataPayload;
    if (useCaptcha) {
      const token = readCaptchaToken(captchaType);
      if (!token) console.error("Warning: captcha.json not found or empty");
      payload = injectCaptchaToken(payload, token);
    }

    const sendAt = target ? target.getTime() : Date.now();
    const now = Date.now();
    if (target && sendAt <= now) {
      console.error("Target time is already in the past; aborting request.");
      process.exitCode = 1;
      return;
    }
    const refreshAt = sendAt - CAPTCHA_REFRESH_AHEAD;
    const firstWait = refreshAt - now;
    const tokenEntityId = nusuk.entityId || entityId;

    if (firstWait > 0) {
      console.log(
        `  refreshing visa captcha at ${formatTime(new Date(refreshAt))} (20s before target)...`
      );
      await new Promise((r) => setTimeout(r, firstWait));
    }

    let captcha;
    try {
      captcha = await refreshVisaCaptcha(tokenEntityId, endpoint);
    } catch (e) {
      console.warn(`  captcha refresh failed: ${e.message}`);
    }
    if (!captcha) {
      captcha = readCaptchaToken(captchaType);
      if (captcha) {
        console.warn("  worker has no new captcha — reusing captcha.json");
      } else {
        console.error("  no captcha available (worker or captcha.json) — aborting");
        process.exitCode = 1;
        return;
      }
    }

    let schedule = null;
    if (target) {
      schedule = await warmVisaConnection(nusuk, target);
      console.log(`  target           : ${formatTime(target)}`);
      console.log(`  estimated one-way: ${ms(schedule.oneWayMs)}`);
      console.log(`  send at          : ${formatTime(schedule.sendAt)} (${ms(schedule.sendAheadMs)} ahead)`);
    }

    const actualSendAt = target ? schedule.sendAt.getTime() : sendAt;
    const secondWait = actualSendAt - Date.now();
    if (secondWait > 0) {
      console.log(`  waiting ${ms(secondWait)} until execute (${formatTime(new Date(actualSendAt))})...`);
      await new Promise((r) => setTimeout(r, secondWait));
    }

    const tokenValue = payload?.captchaToken || payload?.recaptchaToken || readCaptchaToken(captchaType) || captcha;
    payload = buildVisaPayload(payload, groupId, tokenValue);
    const sendActual = Date.now();

    const requestPreview = {
      url: VISA_PATH,
      method: "POST",
      headers: await nusuk.buildRequestHeaders(),
      payload,
    };

    console.log(`\n--- Request Preview ---`);
    console.log(`  method  : ${requestPreview.method}`);
    console.log(`  url     : ${requestPreview.url}`);
    console.log(`  headers :`, JSON.stringify(requestPreview.headers, null, 2));
    console.log(`  payload :`, JSON.stringify(requestPreview.payload, null, 2));
    console.log(`  curl    :`);
    console.log(formatCurlPreview(requestPreview.url, requestPreview.headers, requestPreview.payload));

    const res = await nusuk.request(VISA_PATH, { method: "POST", payload });
    const responseReceived = Date.now();
    const timing = summarizeRequestTiming({
      sendAt: new Date(sendActual),
      responseReceivedAt: new Date(responseReceived),
      response: res,
    });

    console.log(`\n--- Result ---`);
    console.log(`  sent at          : ${formatTime(timing.sendAt)}`);
    console.log(`  response received: ${formatTime(timing.responseReceivedAt)}`);
    console.log(`  elapsed          : ${ms(timing.elapsedMs)}`);
    console.log(`  response date    : ${timing.serverDateHeader || "(none)"}`);
    console.log(`  status           : ${res.status}`);
    if (res.timing) console.log(`  timing           : ${ms(res.timing.total)}  ttfb=${ms(res.timing.ttfb ?? "?")}`);
    if (res.json) console.log(`  response         :`, JSON.stringify(res.json, null, 2).slice(0, 600));
    else console.log(`  body             :`, String(res.body).slice(0, 600));

    if (res.status !== 200) process.exitCode = 1;
  } finally {
    await nusuk.close();
  }
}
function help(topic = "") {
  if (topic === "captcha") {
    console.log(`
Usage: nusuk captcha <action> [options]

Actions:
  pull                  Pull one CAPTCHA
  watch                 Refresh continuously in the foreground
  start                 Start a silent background refresher
  status                Show background refresher status
  stop                  Stop the background refresher
  set [token]           Save a CAPTCHA token
  show                  Show the saved token
  solve [--v3]          Solve via CapSolver

Options:
  --type <type>         visa, login, or general (default: visa)
  --entity <id>         Entity ID
  --interval <duration> Poll interval, for example 5s or 1m
  --output <path>       CAPTCHA output file
  --fallback            Allow fallback to another CAPTCHA type
  --quiet               Suppress routine output
`);
    return;
  }

  console.log(`
Toque — Nusuk command line

Usage: nusuk <command> [options]
       nusuk                    Open the guided menu

Common tasks:
  init                  Create ignored local config files after a fresh clone
  login                 Install the latest user credentials
  pull                  Refresh auth, entity, and CAPTCHA files
  info                  Show dashboard company information
  send <group-id>       Send a visa request
  set-group-id <id>     Store a default group ID for future sends
  request <path>        Send a custom API request
  api <name>            Run a saved request from the catalog
  groups list           Show group names and IDs
  schedule              Schedule a request
  sync-time             Sync system clock to accurate network time
  bench [count]         Measure request latency

CAPTCHA:
  captcha <action>      Pull, monitor, set, show, or solve CAPTCHA

Help:
  help [command]        Show command help

Examples:
  nusuk login
  nusuk info
  nusuk send 12345
  nusuk api verify-subscription
  nusuk api list
  nusuk groups list
  nusuk captcha start --type visa --interval 5s --quiet
  nusuk help captcha
`);
}

async function guidedMenu() {
  if (!canPrompt()) {
    help();
    return;
  }
  console.log(`
What would you like to do?

  1. Log in / install credentials
  2. Refresh auth and CAPTCHA
  3. Show company information
  4. Send a visa request
  5. Manage CAPTCHA
  6. Send a custom request
  7. Verify subscription status
  8. Schedule a request
  9. Benchmark latency
  0. Exit
`);
  const selection = await ask("Select: ");
  switch (selection) {
    case "1": return cmdLogin([]);
    case "2": return cmdPull([]);
    case "3": return cmdApi(["company-info"]);
    case "4": {
      return cmdSendVisa([]);
    }
    case "5": help("captcha"); return;
    case "6": {
      const path = await ask("API path: ");
      if (!path) throw new Error("API path is required");
      return cmdReq([path]);
    }
    case "7": return cmdApi(["verify-subscription"]);
    case "8": {
      const target = await ask("Target time (HH:MM:SS): ");
      if (!target) throw new Error("Target time is required");
      return cmdSchedule(["--target", target]);
    }
    case "9": return cmdBench([]);
    case "0": case "": return;
    default: throw new Error("Invalid selection. Run `nusuk` again and choose 0-9");
  }
}

async function main() {
  const [, , cmd, ...args] = process.argv;

  if (!cmd) return guidedMenu();
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    help(args[0] || "");
    return;
  }
  if (cmd === "captcha" && (args.includes("--help") || args.includes("-h"))) {
    help("captcha");
    return;
  }

  switch (cmd) {
    case "bench":
      await cmdBench(args);
      break;
    case "request":
      await cmdReq(args);
      break;
    case "api":
      await cmdApi(args);
      break;
    case "groups":
      await cmdGroups(args);
      break;
    case "init":
      await cmdInit(args);
      break;
    case "schedule":
      await cmdSchedule(args);
      break;
    case "set-group-id":
      await cmdSetGroupId(args);
      break;
    case "send":
    case "send-visa":
      await cmdSendVisa(args);
      break;
    case "sync-time":
      await cmdSyncTime(args);
      break;
    case "captcha-set":
      await cmdCaptchaSet(args);
      break;
    case "captcha-show":
      await cmdCaptchaShow();
      break;
    case "captcha-solve":
      await cmdCaptchaSolve(args);
      break;
    case "captcha":
      await cmdCaptcha(args);
      break;
    case "pull":
      await cmdPull(args);
      break;
    case "info":
      await cmdApi(["company-info", ...args]);
      break;
    case "login":
      await cmdLogin(args);
      break;
    case "help":
      help(args[0] || "");
      break;
    case "--help":
    case "-h":
      help();
      break;
    default:
      throw new Error(`Unknown command: ${cmd}. Run "nusuk help" for usage`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  if (process.env.NUSUK_DEBUG === "1") console.error(err.stack);
  process.exitCode = 1;
});
