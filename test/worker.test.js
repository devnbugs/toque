import assert from "node:assert/strict";
import test from "node:test";
import { AuthaWorker } from "../src/worker.js";

test("fetchLatestCaptcha validates type before making a request", async () => {
  const worker = new AuthaWorker({ entityId: "123", apiToken: "test" });
  worker.fetchContext = async () => {
    throw new Error("should not be called");
  };
  await assert.rejects(
    worker.fetchLatestCaptcha(undefined, "unknown"),
    /Invalid CAPTCHA type/
  );
});

test("fetchLatestCaptcha selects visa, login, and general exactly in strict mode", async () => {
  const worker = new AuthaWorker({ entityId: "123", apiToken: "test" });
  const refreshValues = [];
  worker.fetchContext = async (_entityId, { refresh }) => {
    refreshValues.push(refresh);
    return {
      captcha: {
        visa: { captchaToken: "visa-token" },
        login: { captchaToken: "login-token" },
        latest: { captchaToken: "general-token" },
      },
    };
  };

  assert.equal(
    await worker.fetchLatestCaptcha(undefined, "visa", { strict: true, refresh: true }),
    "visa-token"
  );
  assert.equal(
    await worker.fetchLatestCaptcha(undefined, "login", { strict: true, refresh: true }),
    "login-token"
  );
  assert.equal(
    await worker.fetchLatestCaptcha(undefined, "general", { strict: true, refresh: true }),
    "general-token"
  );
  assert.deepEqual(refreshValues, [true, true, true]);
});
