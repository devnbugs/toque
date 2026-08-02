import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  normalizeCaptchaType,
  parseInterval,
  pullCaptchaOnce,
  runCaptchaPullLoop,
} from "../src/captcha-puller.js";

test("normalizes supported CAPTCHA types and rejects unknown values", () => {
  assert.equal(normalizeCaptchaType(" VISA "), "visa");
  assert.equal(normalizeCaptchaType("login"), "login");
  assert.equal(normalizeCaptchaType("GENERAL"), "general");
  assert.throws(() => normalizeCaptchaType("other"), /Invalid CAPTCHA type/);
});

test("parses bounded polling intervals", () => {
  assert.equal(parseInterval(undefined), 5000);
  assert.equal(parseInterval("1s"), 1000);
  assert.equal(parseInterval("2m"), 120000);
  assert.throws(() => parseInterval("500ms"), /between 1 second and 1 hour/);
  assert.throws(() => parseInterval("nope"), /positive duration/);
});

test("pullCaptchaOnce requests an exact refreshed type and avoids duplicate writes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "toque-captcha-"));
  const outputPath = join(directory, "captcha.json");
  const calls = [];
  const worker = {
    entityId: "123",
    async fetchLatestCaptcha(entityId, type, options) {
      calls.push({ entityId, type, options });
      return "token-1";
    },
  };

  try {
    const first = await pullCaptchaOnce({ worker, type: "login", outputPath });
    const second = await pullCaptchaOnce({ worker, type: "login", outputPath });
    assert.equal(first.updated, true);
    assert.equal(second.updated, false);
    assert.deepEqual(calls[0], {
      entityId: "123",
      type: "login",
      options: { strict: true, refresh: true },
    });
    const saved = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(saved.captchaToken, "token-1");
    assert.equal(saved.captchaType, "login");
    assert.equal(saved.entityId, "123");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runCaptchaPullLoop stops cleanly after abort", async () => {
  const controller = new AbortController();
  let calls = 0;
  const worker = {
    entityId: "123",
    async fetchLatestCaptcha() {
      calls += 1;
      controller.abort();
      return null;
    },
  };

  await runCaptchaPullLoop({
    worker,
    type: "general",
    interval: 1000,
    quiet: true,
    signal: controller.signal,
  });
  assert.equal(calls, 1);
});
