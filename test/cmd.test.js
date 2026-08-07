import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SERVER_PATH = "src/server.js";

let serverProc;
let baseUrl;
let tmpDir;

async function startServer(env = {}) {
  tmpDir = mkdtempSync(join(tmpdir(), "toque-cmd-"));
  const port = 8190 + Math.floor(Math.random() * 100);
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [SERVER_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    });
    let started = false;
    serverProc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (!started && text.includes("listening on port")) {
        started = true;
        baseUrl = `http://localhost:${port}`;
        resolve();
      }
    });
    serverProc.stderr.on("data", (chunk) => {
      if (!started) reject(new Error(chunk.toString()));
    });
    serverProc.on("error", reject);
    setTimeout(() => {
      if (!started) reject(new Error("Server did not start within 5s"));
    }, 5000);
  });
}

function stopServer() {
  if (serverProc) {
    serverProc.kill("SIGTERM");
    serverProc = null;
  }
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    tmpDir = null;
  }
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  return res.json();
}

async function postCmd(body) {
  return fetchJson("/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("cmd endpoint returns command catalog on /cmd/list", async () => {
  await startServer();
  try {
    const result = await fetchJson("/cmd/list");
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.commands));
    assert.ok(result.commands.length >= 20);
    assert.ok(Array.isArray(result.blocked));
  } finally {
    stopServer();
  }
});

test("cmd endpoint rejects unknown commands", async () => {
  await startServer();
  try {
    const result = await postCmd({ command: "badcmd" });
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown command/);
  } finally {
    stopServer();
  }
});

test("cmd endpoint accepts argv format and runs help", async () => {
  await startServer();
  try {
    const result = await postCmd({ argv: ["help"] });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Toque/);
  } finally {
    stopServer();
  }
});

test("cmd endpoint exposes captcha-watch, captcha-start, captcha-status, captcha-stop in catalog", async () => {
  await startServer();
  try {
    const result = await fetchJson("/cmd/list");
    const names = result.commands.map((c) => c.name);
    assert.ok(names.includes("captcha-watch"));
    assert.ok(names.includes("captcha-start"));
    assert.ok(names.includes("captcha-status"));
    assert.ok(names.includes("captcha-stop"));
    // Nothing should be blocked anymore — all handled in-process
    assert.equal(result.blocked.length, 0);
  } finally {
    stopServer();
  }
});

test("captcha-status returns not running when no task is active", async () => {
  await startServer();
  try {
    const result = await postCmd({ command: "captcha-status" });
    assert.equal(result.ok, true);
    assert.equal(result.status.running, false);
    assert.equal(result.status.pulls, 0);
  } finally {
    stopServer();
  }
});

test("captcha-start requires entity ID", async () => {
  await startServer({ ACTIVE_ENTITY_ID: "" });
  try {
    const result = await postCmd({ command: "captcha-start", args: ["--type", "visa"] });
    assert.equal(result.ok, false);
    assert.match(result.error, /Entity ID required/i);
  } finally {
    stopServer();
  }
});

test("captcha-watch requires entity ID", async () => {
  await startServer({ ACTIVE_ENTITY_ID: "" });
  try {
    const result = await postCmd({ command: "captcha-watch", args: ["--max-duration", "1000"] });
    assert.equal(result.ok, false);
    assert.match(result.error, /Entity ID required/i);
  } finally {
    stopServer();
  }
});

test("captcha-stop returns status even when nothing is running", async () => {
  await startServer();
  try {
    const result = await postCmd({ command: "captcha-stop" });
    assert.equal(result.ok, true);
    assert.equal(result.status.running, false);
  } finally {
    stopServer();
  }
});
