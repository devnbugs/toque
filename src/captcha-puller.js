import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { AuthaWorker } from "./worker.js";
import { writePrivateJson } from "./utils.js";

// Re-export for backward compatibility — the CLI and other modules import
// writePrivateJson from here. The canonical implementation lives in utils.js.
export { writePrivateJson };

export const CAPTCHA_TYPES = Object.freeze(["visa", "login", "general"]);

export function normalizeCaptchaType(value = "visa") {
  const type = String(value).trim().toLowerCase();
  if (!CAPTCHA_TYPES.includes(type)) {
    throw new Error(`Invalid CAPTCHA type: ${value}. Use visa, login, or general`);
  }
  return type;
}

export function parseInterval(value, defaultValue = 5000) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const match = /^(\d+)(ms|s|m)?$/i.exec(String(value).trim());
  if (!match) throw new Error("Interval must be a positive duration such as 5000, 5s, or 1m");
  const amount = Number(match[1]);
  const unit = (match[2] || "ms").toLowerCase();
  const multiplier = unit === "m" ? 60000 : unit === "s" ? 1000 : 1;
  const interval = amount * multiplier;
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 3600000) {
    throw new Error("Interval must be between 1 second and 1 hour");
  }
  return interval;
}

export function readPidFile(path) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    return null;
  }
}

export function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function pullCaptchaOnce({
  entityId,
  type = "visa",
  endpoint,
  outputPath = process.env.CAPTCHA_PATH || "captcha.json",
  worker,
  strict = true,
} = {}) {
  const normalizedType = normalizeCaptchaType(type);
  const client = worker || new AuthaWorker({ entityId, endpoint });
  const eid = entityId || client.entityId;
  if (!eid) throw new Error("Entity ID required (pass --entity or configure entity.json)");

  const token = await client.fetchLatestCaptcha(eid, normalizedType, {
    strict,
    refresh: true,
  });
  if (!token) return { updated: false, token: null, type: normalizedType, entityId: String(eid) };

  const absoluteOutput = resolve(outputPath);
  let existing = {};
  if (existsSync(absoluteOutput)) {
    existing = JSON.parse(readFileSync(absoluteOutput, "utf8"));
  }
  if (existing.captchaToken === token && existing.captchaType === normalizedType) {
    return { updated: false, token, type: normalizedType, entityId: String(eid), outputPath: absoluteOutput };
  }

  writePrivateJson(absoluteOutput, {
    ...existing,
    [normalizedType]: token,
    captchaToken: token,
    captchaType: normalizedType,
    entityId: String(eid),
    updatedAt: new Date().toISOString(),
  });
  return { updated: true, token, type: normalizedType, entityId: String(eid), outputPath: absoluteOutput };
}

function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolveDelay) => {
    const timer = setTimeout(resolveDelay, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolveDelay();
    }, { once: true });
  });
}

export async function runCaptchaPullLoop({
  interval = 5000,
  signal,
  quiet = false,
  logger = console,
  ...pullOptions
} = {}) {
  let failures = 0;
  while (!signal?.aborted) {
    try {
      const result = await pullCaptchaOnce(pullOptions);
      failures = 0;
      if (!quiet && result.updated) {
        logger.log(`[${new Date().toISOString()}] ${result.type} CAPTCHA refreshed for entity ${result.entityId}`);
      }
    } catch (error) {
      failures += 1;
      logger.error(`[${new Date().toISOString()}] CAPTCHA pull failed: ${error.message}`);
    }
    if (signal?.aborted) break;
    const retryDelay = failures
      ? Math.min(interval * (2 ** Math.min(failures - 1, 4)), 60000)
      : interval;
    await abortableDelay(retryDelay, signal);
  }
}
