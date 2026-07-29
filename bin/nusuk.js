#!/usr/bin/env node

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { Nusuk } from "../src/nusuk.js";

function ms(ms) {
  return `${ms}ms`;
}

function formatTime(date) {
  return date.toTimeString().slice(0, 8);
}

function parseTarget(str) {
  const parts = str.split(":");
  if (parts.length !== 3) return null;
  const [h, m, s] = parts.map(Number);
  if ([h, m, s].some(isNaN)) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, s, 0);
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

Options:
  --target HH:MM:SS   Target server arrival time
  --path /api/path    API endpoint path (default: SendToIssueVisa)
  --count N           Number of calibration samples (default: 5)

Environment:
  AUTH_PATH           Path to auth.json (default: ./auth.json)
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
