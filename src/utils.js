/**
 * Shared utilities used across the Worker, container server, and CLI.
 *
 * Centralizes the JSON/HTML response formatter, private JSON file writer,
 * and small helpers that were previously duplicated across modules.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, resolve } from "path";

/**
 * Build a styled HTML page that renders JSON with syntax highlighting.
 * Used by both the Worker and the container server so browser visits get
 * a readable page while API clients get raw JSON.
 */
function jsonToHtml(json) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Toque API</title>
<style>
  body { margin: 0; background: #1e1e1e; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; }
  pre { padding: 20px; color: #d4d4d4; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .key { color: #569cd6; }
  .string { color: #ce9178; }
  .number { color: #b5cea8; }
  .boolean { color: #569cd6; }
  .null { color: #569cd6; }
</style>
</head>
<body>
<pre>${json
    .replace(/("(.*?)":)/g, '<span class="key">$1</span>')
    .replace(/: ("(.*?)")/g, ': <span class="string">$1</span>')
    .replace(/: (\\d+)/g, ': <span class="number">$1</span>')
    .replace(/: (true|false)/g, ': <span class="boolean">$1</span>')
    .replace(/: null/g, ': <span class="null">null</span>')}</pre>
</body>
</html>`;
}

/**
 * Universal JSON response helper.
 *
 * Works in three contexts:
 *  - Cloudflare Worker fetch handler: pass a Request (has .headers.get)
 *  - Node http server handler:       pass req/res (req has .headers.accept)
 *  - No request context:              omit request to always get JSON
 *
 * Returns a Response (Worker) or writes to res and returns undefined (server).
 */
export function jsonResponse(statusOrRes, bodyOrStatus, bodyOrReq, requestOrUndefined) {
  // Worker form: jsonResponse(status, body, request)
  if (typeof statusOrRes === "number") {
    const status = statusOrRes;
    const body = bodyOrStatus;
    const request = bodyOrReq;
    const json = JSON.stringify(body, null, 2);
    const accept = request?.headers?.get?.("Accept") || "";
    if (accept.includes("text/html")) {
      return new Response(jsonToHtml(json), {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response(json, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Server form: jsonResponse(res, status, body, req)
  const res = statusOrRes;
  const status = bodyOrStatus;
  const body = bodyOrReq;
  const req = requestOrUndefined;
  const json = JSON.stringify(body, null, 2);
  const accept = req?.headers?.accept || req?.headers?.get?.("accept") || "";
  if (accept.includes("text/html")) {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(jsonToHtml(json));
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

/**
 * Atomically write a JSON file with restrictive permissions (0600).
 *
 * Writes to a temp file first, then renames into place — safe against
 * partial writes. Creates parent directories as needed.
 */
export function writePrivateJson(path, data) {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true, mode: 0o700 });
  const temporaryPath = resolve(
    dirname(absolutePath),
    `.${basename(absolutePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporaryPath, absolutePath);
    chmodSync(absolutePath, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {}
    throw error;
  }
}

/**
 * Read and parse a JSON file, returning null on any error.
 */
export function readJsonFile(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Read and parse a JSON file if it exists, otherwise return the fallback.
 */
export function readJsonIfExists(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return readJsonFile(path, fallback);
}

/**
 * Small helper to format milliseconds as a readable string.
 */
export function ms(value) {
  return `${value}ms`;
}

/**
 * Format a Date as HH:MM:SS.mmm for log output.
 */
export function formatTime(date) {
  return (
    date.toTimeString().slice(0, 8) +
    "." +
    String(date.getMilliseconds()).padStart(3, "0")
  );
}
