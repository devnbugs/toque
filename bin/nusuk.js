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
  const parts = str.split(":");
  if (parts.length !== 3) return null;
  const secParts = parts[2].split(".");
  const s = Number(secParts[0]);
  const ms = Number(secParts[1]) || 0;
  const [h, m] = parts.map(Number);
  if ([h, m, s].some(isNaN)) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, s, ms);
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

async function cmdBench(args) {
  const count = parseInt(args[0] || "5", 10);
  const authPath = findAuth();
  const nusuk = authPath ? new Nusuk().loadAuth(authPath) : new Nusuk();
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
    const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

    console.log(`\n--- Latency Stats ---`);
    console.log(`  total RTT : min=${ms(Math.min(...totals))}  avg=${ms(avg(totals))}  max=${ms(Math.max(...totals))}`);
    if (ttfbVals.length) {
      console.log(`  ttfb      : min=${ms(Math.min(...ttfbVals))}  avg=${ms(avg(ttfbVals))}  max=${ms(Math.max(...ttfbVals))}`);
    }
    const oneway = ttfbVals.length ? avg(ttfbVals) : Math.round(avg(totals) / 2);
    console.log(`  one-way ~ : ${ms(oneway)}`);
  } finally {
    await nusuk.close();
  }
}

async function cmdReq(args) {
  if (!args.length) {
    console.error("Usage: nusuk request <path> [method]");
    process.exit(1);
  }
  const path = args[0];
  const method = (args[1] || "GET").toUpperCase();

  const authPath = findAuth();
  const nusuk = authPath ? new Nusuk().loadAuth(authPath) : new Nusuk();
  await nusuk.init();

  try {
    const res = await nusuk.request(path, { method });
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

async function cmdSchedule(args) {
  const targetIdx = args.indexOf("--target");
  const targetStr = targetIdx !== -1 ? args[targetIdx + 1] : null;
  const pathIdx = args.indexOf("--path");
  const path = pathIdx !== -1 ? args[pathIdx + 1] : "/umrah/groups_apis/api/Groups/SendToIssueVisa";
  const countIdx = args.indexOf("--count");
  const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) || 5 : 5;

  if (!targetStr) {
    console.error("Usage: nusuk schedule --target HH:MM:SS [--path /api/endpoint] [--count 5]");
    process.exit(1);
  }
  const target = parseTarget(targetStr);
  if (!target) {
    console.error("Invalid target time. Use HH:MM:SS format.");
    process.exit(1);
  }

  const authPath = findAuth();
  const nusuk = authPath ? new Nusuk().loadAuth(authPath) : new Nusuk();
  await nusuk.init();

  try {
    console.log(`\nSending ${count} calibration requests...\n`);
    const samples = [];
    for (let i = 0; i < count; i++) {
      const res = await nusuk.request("/manifest.json");
      samples.push(res.timing);
      console.log(`  req ${i + 1}: total=${ms(res.timing.total)}  ttfb=${ms(res.timing.ttfb ?? "?")}  status=${res.status}`);
    }

    const totals = samples.map((s) => s.total);
    const ttfbVals = samples.map((s) => s.ttfb).filter(Boolean);
    const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const oneway = ttfbVals.length ? avg(ttfbVals) : Math.round(avg(totals) / 2);
    const safety = 200;
    const sendAhead = oneway + safety;
    const sendAt = new Date(target.getTime() - sendAhead);

    console.log(`\n--- Schedule ---`);
    console.log(`  target arrival : ${formatTime(target)}`);
    console.log(`  send request at: ${formatTime(sendAt)}  (${ms(sendAhead)} ahead)`);

    const wait = sendAt.getTime() - Date.now();
    if (wait > 0) {
      console.log(`  waiting ${ms(wait)}...`);
      await new Promise((r) => setTimeout(r, wait));
      const res = await nusuk.request(path, { method: "POST" });
      const arrived = new Date();
      const drift = arrived.getTime() - target.getTime();
      console.log(`\n  request sent`);
      console.log(`  arrived at     : ${formatTime(arrived)}.${String(arrived.getMilliseconds()).padStart(3, "0")}`);
      console.log(`  server time    : ${formatTime(target)}`);
      console.log(`  drift          : ${drift >= 0 ? "+" : ""}${drift}ms`);
      console.log(`  response status: ${res.status}`);
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
  nusuk request <path> [method]        Send a request
  nusuk schedule --target HH:MM:SS     Schedule a request at target time
       [--path /api/path]
       [--count 5]
  nusuk captcha-set                   Set captcha token (via CAPTCHA_TOKEN env)
  nusuk captcha-show                  Show stored captcha token

Options:
  --target HH:MM:SS   Target server arrival time (with optional .mmm ms)
  --path /api/path    API endpoint path (default: SendToIssueVisa)
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
