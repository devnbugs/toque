/**
 * Structured logger for the Toque Worker, container server, and CLI.
 *
 * Emits single-line JSON to stdout/stderr so Cloudflare Observability and
 * `wrangler tail` can parse, filter, and aggregate events. Every log line
 * carries a stable schema:
 *
 *   {
 *     "ts": "2026-08-10T00:31:25.123Z",   // ISO timestamp
 *     "level": "info",                     // info | warn | error | debug
 *     "event": "container.started",        // stable dotted event name
 *     "msg": "Toque container started",    // human-readable summary
 *     "path": "/api",                      // optional request path
 *     "status": 200,                       // optional status code
 *     "durationMs": 42,                    // optional duration
 *     "error": "...",                      // optional error message
 *     "meta": { ... }                      // optional free-form context
 *   }
 *
 * Usage:
 *   import { log } from "./log.js";
 *   log.info("container.started", "Toque container started");
 *   log.warn("captcha.stale", "captcha older than 60s", { ageMs: 72000 });
 *   log.error("proxy.failed", "container proxy failed", { error: err.message, path });
 *   log.debug("auth.token", "loaded JWT", { entityId });  // only with NUSUK_DEBUG=1
 *
 * The CLI can also use the human-friendly `log.cli()` formatter which prints
 * prefixed lines (✓/✗/→/•) instead of JSON, controlled by NUSUK_LOG_FORMAT.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function nowIso() {
  return new Date().toISOString();
}

function emit(level, fields) {
  const minLevel = process.env.NUSUK_DEBUG === "1" ? LEVELS.debug : LEVELS.info;
  if (LEVELS[level] < minLevel) return;

  const payload = { ts: nowIso(), level, ...fields };

  // Single-line JSON — safe for `wrangler tail` and log aggregators.
  const line = JSON.stringify(payload);

  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

/**
 * Build a log entry with a stable event name and human message.
 * Extra context is merged in; known keys (path, status, durationMs, error,
 * meta) are passed through, everything else goes under `meta`.
 */
function entry(event, msg, context = {}) {
  const known = { event, msg };
  const meta = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null) continue;
    if (key in known || key === "path" || key === "status" || key === "durationMs" || key === "error" || key === "entityId" || key === "cmd" || key === "instanceId") {
      known[key] = value;
    } else {
      meta[key] = value;
    }
  }
  if (Object.keys(meta).length) known.meta = meta;
  return known;
}

export const log = {
  debug(event, msg, context) {
    emit("debug", entry(event, msg, context));
  },
  info(event, msg, context) {
    emit("info", entry(event, msg, context));
  },
  warn(event, msg, context) {
    emit("warn", entry(event, msg, context));
  },
  error(event, msg, context) {
    emit("error", entry(event, msg, context));
  },

  /**
   * Human-friendly CLI formatter. Prints prefixed single lines:
   *   ✓  success
   *   ✗  failure
   *   →  action / network
   *   •  info / detail
   *   ⚠  warning
   *   ⏱  timing
   *
   * Respects NUSUK_LOG_FORMAT=json to emit structured JSON instead.
   */
  cli(prefix, msg, context = {}) {
    if (process.env.NUSUK_LOG_FORMAT === "json") {
      const event = context.event || "cli";
      emit("info", entry(event, msg, context));
      return;
    }
    const icons = {
      ok: "✓",
      fail: "✗",
      action: "→",
      info: "•",
      warn: "⚠",
      time: "⏱",
      send: "➤",
      recv: "⬇",
    };
    const icon = icons[prefix] || "•";
    const parts = [icon, msg];
    if (context.detail) parts.push(`— ${context.detail}`);
    process.stdout.write(parts.join("  ") + "\n");
  },
};
