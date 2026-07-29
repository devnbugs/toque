#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { Nusuk } from "../src/nusuk.js";

function ms(ms) {
  return `${ms}ms`;
}

function formatTime(date) {
  return date.toTimeString().slice(0, 8) + "." + String(date.getMilliseconds()).padStart(3, "0");
}

function parseTarget(str) {
  let parts = str.split(":");
  if (parts.length < 3 || parts.length > 4) return null;
  const ms = parts.length === 4 ? Number(parts[3]) : 0;
  const secParts = parts[2].split(".");
  const s = Number(secParts[0]);
  const msFromSec = Number(secParts[1]) || 0;
  const [h, m] = parts.map(Number);
  if ([h, m, s].some(isNaN)) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, s, ms || msFromSec);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target;
}

function findAuth() {
  const candidates = [
    process.env.AUTH_PATH,
    "auth.json",
    resolve(process.cwd(), "auth.json"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
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
    if (p && existsSync(p)) return p;
  }
  return null;
}

function readCaptchaToken() {
  const p = findCaptcha();
  if (!p) return null;
  try { return JSON.parse(readFileSync(p, "utf8")).captchaToken || null; }
  catch { return null; }
}

async function cmdBench(args) {
  const count = parseInt(args[0] || "5", 10);
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
  const clean = dataIdx !== -1 ? [...args.slice(0, dataIdx), ...args.slice(dataIdx + 2)] : [...args].filter((a) => a !== "--captcha");
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

  const authPath = findAuth();
  const nusuk = authPath ? new Nusuk().loadAuth(authPath).loadEntity() : new Nusuk().loadEntity();
  await nusuk.init();

  try {
    const res = await nusuk.request(path, { method, payload });
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
  const captchaPath = process.env.CAPTCHA_PATH || "captcha.json";
  const existing = existsSync(captchaPath)
    ? JSON.parse(readFileSync(captchaPath, "utf8"))
    : {};
  existing.captchaToken = process.env.CAPTCHA_TOKEN || "";
  writeFileSync(captchaPath, JSON.stringify(existing, null, 2) + "\n");
  console.log(`captchaToken ${existing.captchaToken ? "updated" : "cleared"} in ${captchaPath}`);
}

async function cmdCaptchaShow() {
  const captchaPath = findCaptcha();
  if (!captchaPath) {
    console.log("captcha.json not found");
    return;
  }
  const data = JSON.parse(readFileSync(captchaPath, "utf8"));
  console.log(data.captchaToken || "(empty)");
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
  const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) || 5 : 5;
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
  const target = parseTarget(targetStr);
  if (!target) {
    console.error("Invalid target time. Use HH:MM:SS[.mmm] or HH:MM:SS:mmm");
    process.exit(1);
  }

  const authPath = findAuth();
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

function help() {
  console.log(`
nusuk — Nusuk request handler CLI

Usage:
  nusuk bench [count]                  Run latency benchmark
  nusuk request <path> [method]        Send a request (POST defaults to {})
       [--data '{"key":"val"}']
       [--captcha]
  nusuk schedule --target HH:MM:SS     Schedule request to arrive at server at target time
       [--path /api/path]
       [--method GET]
       [--data '{"key":"val"}']
       [--captcha]
       [--count 5]
  nusuk captcha-set                   Set captcha token (via CAPTCHA_TOKEN env)
  nusuk captcha-show                  Show stored captcha token

Options:
  --target HH:MM:SS   Server delivery target time (HH:MM:SS.mmm or HH:MM:SS:mmm)
  --path /api/path    API endpoint path (default: SendToIssueVisa)
  --method GET|POST   HTTP method (default: POST)
  --data <json>       JSON payload for the request body
  --captcha           Include captchaToken from captcha.json in payload
  --count N           Number of calibration samples (default: 5)

Environment:
  AUTH_PATH           Path to auth.json (default: ./auth.json)
  CAPTCHA_PATH        Path to captcha.json (default: ./captcha.json)
  CAPTCHA_TOKEN       Captcha token value for captcha-set
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
    case "captcha-set":
      await cmdCaptchaSet();
      break;
    case "captcha-show":
      await cmdCaptchaShow();
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
