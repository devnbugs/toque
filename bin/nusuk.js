#!/usr/bin/env node

import "dotenv/config";
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { Nusuk } from "../src/nusuk.js";
import { AuthaWorker } from "../src/worker.js";
import { parseJwt } from "../src/jwt.js";
import { CapSolver } from "../src/capsolver.js";
import { parsePositiveCount, parseTargetTime } from "../src/validation.js";

function ms(ms) {
  return `${ms}ms`;
}

function formatTime(date) {
  return date.toTimeString().slice(0, 8) + "." + String(date.getMilliseconds()).padStart(3, "0");
}

function findCreds() {
  const candidates = [
    process.env.CREDS_PATH,
    "creds.json",
    resolve(process.cwd(), "creds.json"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}
function findAuth() {
  const creds = findCreds();
  if (creds) {
    try {
      const data = JSON.parse(readFileSync(creds, "utf8"));
      if (parseJwt(data?.response?.data?.authInfo?.userToken)) return creds;
    } catch {}
  }
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
  const creds = findCreds();
  if (creds) {
    try {
      const data = JSON.parse(readFileSync(creds, "utf8"));
      if (data?.captchaToken) return creds;
    } catch {}
  }
  const candidates = [
    process.env.CAPTCHA_PATH,
    "captcha.json",
    resolve(process.cwd(), "captcha.json"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, "utf8"));
        if (data?.captchaToken) return p;
      } catch {}
    }
  }
  return null;
}

function readCaptchaToken() {
  const p = findCaptcha();
  if (!p) return null;
  try { return JSON.parse(readFileSync(p, "utf8")).captchaToken || null; }
  catch { return null; }
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
function writeCaptchaToken(token) {
  const creds = findCreds();
  if (creds) {
    const existing = JSON.parse(readFileSync(creds, "utf8"));
    existing.captchaToken = token;
    writePrivateJson(creds, existing);
  }
  const captchaPath = process.env.CAPTCHA_PATH || "captcha.json";
  const existing = existsSync(captchaPath)
    ? JSON.parse(readFileSync(captchaPath, "utf8"))
    : {};
  existing.captchaToken = token;
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
    writePrivateJson(captchaPath, { captchaToken: captcha });
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

  const creds = findCreds();
  if (creds && (token || captcha)) {
    const data = JSON.parse(readFileSync(creds, "utf8"));
    if (token) {
      data.response = data.response || {};
      data.response.data = data.response.data || {};
      data.response.data.authInfo = {
        ...(data.response.data.authInfo || {}),
        userToken: token,
      };
    }
    if (captcha) data.captchaToken = captcha;
    writePrivateJson(creds, data);
    if (!quiet) console.log(`  merged into ${creds}`);
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
    const rl = createInterface({ input, output });
    try {
      systemUserId = (await rl.question("System user ID: ")).trim();
    } finally {
      rl.close();
    }
  }
  if (!systemUserId) throw new Error("System user ID is required");

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

async function autoPull() {
  try {
    const result = await pullCreds({ type: "visa", quiet: true });
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
  const dataIdx = args.indexOf("--data");
  const dataStr = dataIdx !== -1 ? args[dataIdx + 1] : null;
  const useCaptcha = args.includes("--captcha");
  const rawJson = args.includes("--raw-json");
  const clean = args.filter((value, index) =>
    value !== "--captcha" &&
    value !== "--raw-json" &&
    value !== "--data" &&
    (dataIdx === -1 || index !== dataIdx + 1)
  );
  const path = clean[0];
  const method = (clean[1] || (dataStr !== null ? "POST" : "GET")).toUpperCase();
  if (!path) {
    console.error("Usage: nusuk request <path> [method] [--data <json>] [--captcha]");
    process.exit(1);
  }

  let payload = undefined;
  if (dataStr !== null) {
    try { payload = JSON.parse(dataStr); }
    catch { payload = dataStr; }
  } else if (["POST", "PUT", "PATCH"].includes(method)) {
    payload = {};
  }
  if (useCaptcha) {
    const token = readCaptchaToken();
    if (!token) console.error("Warning: captcha.json not found or empty");
    else payload = { ...(payload || {}), captchaToken: token };
  }

  let authPath = findAuth();
  if (!authPath || (useCaptcha && !payload?.captchaToken)) {
    const pulled = await autoPull();
    authPath = authPath || (pulled.token ? pulled.authPath : null);
    if (useCaptcha && !payload?.captchaToken && pulled.captcha) {
      payload = { ...(payload || {}), captchaToken: pulled.captcha };
    }
  }

  const nusuk = authPath ? new Nusuk().loadAuth(authPath).loadEntity() : new Nusuk().loadEntity();
  await nusuk.init();

  try {
    const res = await nusuk.request(path, { method, payload });
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
    if (res.json) {
      console.log(`body:`, JSON.stringify(res.json, null, 2));
    } else {
      console.log(`body:`, res.body);
    }
  } finally {
    await nusuk.close();
  }
}

async function cmdCaptchaSet() {
  const token = process.env.CAPTCHA_TOKEN || "";
  writeCaptchaToken(token);
  console.log(`captchaToken ${token ? "updated" : "cleared"} in captcha files`);
}

async function cmdCaptchaShow() {
  const captchaPath = findCaptcha();
  if (!captchaPath) {
    console.log("captcha file not found (tried creds.json, captcha.json)");
    return;
  }
  const data = JSON.parse(readFileSync(captchaPath, "utf8"));
  console.log(data.captchaToken || "(empty)");
}

async function cmdCaptchaSolve(args) {
  const version = args.includes("--v3") ? 3 : 2;
  const solver = new CapSolver();
  console.log(`Solving reCAPTCHA v${version} via CapSolver (${solver.pageUrl})...`);
  const start = Date.now();
  const token = await solver.solve({
    version,
    onStatus: (res) =>
      console.log(`  status: ${res.status || "unknown"} (${((Date.now() - start) / 1000).toFixed(1)}s)`),
  });
  writeCaptchaToken(token);
  console.log(`\n  captchaToken saved (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  console.log(`  token: ${token.slice(0, 28)}...`);
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
  const targetStr = targetIdx !== -1 ? args[targetIdx + 1] : null;
  const pathIdx = args.indexOf("--path");
  const path = pathIdx !== -1 ? args[pathIdx + 1] : "/umrah/groups_apis/api/Groups/SendToIssueVisa";
  const methodIdx = args.indexOf("--method");
  const method = methodIdx !== -1 ? args[methodIdx + 1].toUpperCase() : "POST";
  const countIdx = args.indexOf("--count");
  const count = parsePositiveCount(countIdx !== -1 ? args[countIdx + 1] : undefined);
  const dataIdx = args.indexOf("--data");
  const dataStr = dataIdx !== -1 ? args[dataIdx + 1] : null;
  let payload = undefined;
  if (dataStr !== null) {
    try { payload = JSON.parse(dataStr); }
    catch { payload = dataStr; }
  }

  const useCaptcha = args.includes("--captcha");
  if (useCaptcha) {
    const token = readCaptchaToken();
    if (!token) console.error("Warning: captcha.json not found or empty");
    else payload = { ...(payload || {}), captchaToken: token };
  }

  if (!targetStr) {
    console.error("Usage: nusuk schedule --target HH:MM:SS [--path /api/endpoint] [--count 5]");
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
    const pulled = await autoPull();
    authPath = authPath || (pulled.token ? pulled.authPath : null);
    if (useCaptcha && !payload?.captchaToken && pulled.captcha) {
      payload = { ...(payload || {}), captchaToken: pulled.captcha };
    }
  }
  const nusuk = authPath ? new Nusuk().loadAuth(authPath).loadEntity() : new Nusuk().loadEntity();
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

async function cmdSendVisa(args) {
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const valueFlags = new Set(["--target", "--test-path", "--endpoint"]);
  let groupId;
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.has(args[i])) {
      i++;
    } else if (!args[i].startsWith("-")) {
      groupId = args[i];
      break;
    }
  }
  const targetStr = getArg("--target");
  const target = targetStr ? parseTargetTime(targetStr) : null;
  const testPath = getArg("--test-path");
  const endpoint = getArg("--endpoint");

  if (!groupId) {
    console.error("Usage: nusuk send-visa <groupid> [--target HH:MM:SS] [--no-test]");
    process.exit(1);
  }
  if (targetStr && !target) {
    console.error("Invalid target time. Use HH:MM:SS[.mmm] or HH:MM:SS:mmm");
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

    const sendAt = target ? target.getTime() : Date.now();
    const refreshAt = sendAt - CAPTCHA_REFRESH_AHEAD;
    const firstWait = refreshAt - Date.now();
    const tokenEntityId = nusuk.entityId || entityId;

    if (firstWait > 0) {
      console.log(
        `  refreshing visa captcha at ${formatTime(new Date(refreshAt))} (20s before execute)...`
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
      captcha = readCaptchaToken();
      if (captcha) {
        console.warn("  worker has no new visa captcha — reusing captcha.json");
      } else {
        console.error("  no captcha available (worker or captcha.json) — aborting");
        process.exitCode = 1;
        return;
      }
    }

    const secondWait = sendAt - Date.now();
    if (secondWait > 0) {
      console.log(`  waiting ${ms(secondWait)} until execute (${formatTime(new Date(sendAt))})...`);
      await new Promise((r) => setTimeout(r, secondWait));
    }

    const numericId = Number(groupId);
    const payload = {
      id: Number.isNaN(numericId) ? groupId : numericId,
      captchaToken: readCaptchaToken() || captcha,
    };
    const sendActual = Date.now();
    const res = await nusuk.request(VISA_PATH, { method: "POST", payload });

    console.log(`\n--- Result ---`);
    console.log(`  sent at  : ${formatTime(new Date(sendActual))}`);
    console.log(`  status   : ${res.status}`);
    if (res.timing) console.log(`  timing   : ${ms(res.timing.total)}  ttfb=${ms(res.timing.ttfb ?? "?")}`);
    if (res.json) console.log(`  response :`, JSON.stringify(res.json, null, 2).slice(0, 600));
    else console.log(`  body     :`, String(res.body).slice(0, 600));

    if (res.status !== 200) process.exitCode = 1;
  } finally {
    await nusuk.close();
  }
}
function help() {
  console.log(`
nusuk — Nusuk request handler CLI

Usage:
  nusuk bench [count]                  Run latency benchmark
  nusuk request <path> [method]        Send a request (POST defaults to {})
       [--data '{"key":"val"}']
       [--captcha]
      [--raw-json]
  nusuk schedule --target HH:MM:SS     Schedule request to arrive at server at target time
       [--path /api/path]
       [--method GET]
       [--data '{"key":"val"}']
       [--captcha]
       [--count 5]
      nusuk send-visa <groupid>            Send a visa request, refreshing CAPTCHA
        [--target HH:MM:SS]             20 seconds before the target time
        [--no-test]
        [--test-path /api/path]
  nusuk captcha-set                   Set captcha token (via CAPTCHA_TOKEN env)
  nusuk captcha-show                  Show stored captcha token
  nusuk captcha-solve [--v3]          Solve Nusuk reCAPTCHA via CapSolver
  nusuk pull [--entity <id>]          Pull latest auth token + captcha from the
      [--type login|visa|general]      D1-backed worker into local credential files
       [--endpoint <url>]
    nusuk login [--system-user <id>]    Load latest entity, JWT, and CAPTCHA context
      [--type login|visa|general]
      [--endpoint <url>]

  request/schedule auto-create auth.json + captcha.json from the worker
  when they are missing.

Options:
  --target HH:MM:SS   Server delivery target time (HH:MM:SS.mmm or HH:MM:SS:mmm)
  --path /api/path    API endpoint path (default: SendToIssueVisa)
  --method GET|POST   HTTP method (default: POST)
  --data <json>       JSON payload for the request body
  --captcha           Include captchaToken from captcha.json in payload
  --raw-json          Print only a pretty-formatted JSON response
  --count N           Number of calibration samples (default: 5)
  --no-test           Skip auth verification for send-visa
  --test-path /api    Override the send-visa auth verification endpoint

Environment:
  CREDS_PATH            Path to shared creds.json (default: ./creds.json)
  AUTH_PATH             Path to auth.json (default: ./auth.json)
  CAPTCHA_PATH          Path to captcha.json (default: ./captcha.json)
  CAPTCHA_TOKEN         Captcha token value for captcha-set
  ENTITY_CONFIG_PATH    Path to entity.json (default: ./entity.json)
  ACTIVE_ENTITY_ID      Override entity id (takes priority over config file)
  ACTIVE_ENTITY_TYPE_ID Override entity type id (takes priority over config file)
  WORKER_URL            autha-worker endpoint for "pull" (default: https://autha-worker.decloud.workers.dev)
  WORKER_API_TOKEN      Bearer token required by the autha-worker API
  CAPSOLVER_API_KEY     CapSolver API key for captcha-solve
  CAPSOLVER_SITE_KEY    Override the Nusuk reCAPTCHA site key
  CAPSOLVER_PAGE_URL    Override the Nusuk page URL
  CAPSOLVER_PAGE_ACTION reCAPTCHA v3 action (default: submit)
`);
}

async function main() {
  const [, , cmd, ...args] = process.argv;

  switch (cmd) {
    case "bench":
      await cmdBench(args);
      break;
    case "request":
      await cmdReq(args);
      break;
    case "schedule":
      await cmdSchedule(args);
      break;
    case "send-visa":
      await cmdSendVisa(args);
      break;
    case "captcha-set":
      await cmdCaptchaSet();
      break;
    case "captcha-show":
      await cmdCaptchaShow();
      break;
    case "captcha-solve":
      await cmdCaptchaSolve(args);
      break;
    case "pull":
      await cmdPull(args);
      break;
    case "login":
      await cmdLogin(args);
      break;
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      help();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
