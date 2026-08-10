import test from "node:test";
import assert from "node:assert/strict";
import { CapMonsterSolver } from "../src/capmonster.js";

test("CapMonsterSolver requires an API key", () => {
  const oldKey = process.env.CAPMONSTER_API_KEY;
  delete process.env.CAPMONSTER_API_KEY;
  try {
    const solver = new CapMonsterSolver();
    assert.throws(() => solver.getClient(), /CAPMONSTER_API_KEY is required/);
  } finally {
    if (oldKey) process.env.CAPMONSTER_API_KEY = oldKey;
  }
});

test("CapMonsterSolver uses default Nusuk site key and page URL", () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  assert.equal(solver.siteKey, "6Le-3OwpAAAAAARztuPscqBNbpEY3okMkd7dCoyx");
  assert.equal(solver.pageUrl, "https://masar.nusuk.sa/umrah/mutamer-group/group-list");
});

test("CapMonsterSolver allows overriding site key and page URL", () => {
  const solver = new CapMonsterSolver({
    clientKey: "test-key",
    siteKey: "custom-site-key",
    pageUrl: "https://custom.example.com",
  });
  assert.equal(solver.siteKey, "custom-site-key");
  assert.equal(solver.pageUrl, "https://custom.example.com");
});

test("CapMonsterSolver creates a client lazily", () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  assert.equal(solver._client, null);
  // Inject a fake client to verify lazy caching without invoking the real SDK
  // (the SDK uses CommonJS `module` global which fails under ESM in tests).
  const fakeClient = { solve: async () => "token" };
  solver._client = fakeClient;
  assert.equal(solver.getClient(), fakeClient);
});

test("CapMonsterSolver.solve dispatches to v2 by default", async () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  let called = null;
  solver.solveRecaptchaV2 = async (opts) => {
    called = "v2";
    return "v2-token";
  };
  solver.solveRecaptchaV3 = async (opts) => {
    called = "v3";
    return "v3-token";
  };
  const token = await solver.solve({ version: 2 });
  assert.equal(called, "v2");
  assert.equal(token, "v2-token");
});

test("CapMonsterSolver.solve dispatches to v3 when version=3", async () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  let called = null;
  solver.solveRecaptchaV2 = async (opts) => {
    called = "v2";
    return "v2-token";
  };
  solver.solveRecaptchaV3 = async (opts) => {
    called = "v3";
    return "v3-token";
  };
  const token = await solver.solve({ version: 3 });
  assert.equal(called, "v3");
  assert.equal(token, "v3-token");
});

test("CapMonsterSolver.solve dispatches to Turnstile when type=turnstile", async () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  let called = null;
  solver.solveTurnstile = async (opts) => {
    called = "turnstile";
    return "ts-token";
  };
  const token = await solver.solve({ type: "turnstile" });
  assert.equal(called, "turnstile");
  assert.equal(token, "ts-token");
});

test("CapMonsterSolver.solve dispatches to Enterprise v2 when enterprise=true", async () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  let called = null;
  solver.solveRecaptchaV2Enterprise = async (opts) => {
    called = "v2ent";
    return "v2ent-token";
  };
  solver.solveRecaptchaV2 = async (opts) => {
    called = "v2";
    return "v2-token";
  };
  const token = await solver.solve({ version: 2, enterprise: true });
  assert.equal(called, "v2ent");
  assert.equal(token, "v2ent-token");
});

test("CapMonsterSolver.solve dispatches to Enterprise v3 when version=3 and enterprise=true", async () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  let called = null;
  solver.solveRecaptchaV3Enterprise = async (opts) => {
    called = "v3ent";
    return "v3ent-token";
  };
  solver.solveRecaptchaV3 = async (opts) => {
    called = "v3";
    return "v3-token";
  };
  const token = await solver.solve({ version: 3, enterprise: true });
  assert.equal(called, "v3ent");
  assert.equal(token, "v3ent-token");
});

test("CapMonsterSolver.solve accepts Nusuk captcha types (visa/login/general)", async () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  let called = null;
  solver.solveRecaptchaV2 = async (opts) => {
    called = "v2";
    return "v2-token";
  };
  // "visa" should route to reCAPTCHA v2
  const token = await solver.solve({ type: "visa" });
  assert.equal(called, "v2");
  assert.equal(token, "v2-token");
});

test("CapMonsterSolver.solve throws on unknown type", async () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  await assert.rejects(() => solver.solve({ type: "unknown" }), /Unknown captcha type/);
});

test("CapMonsterSolver.solve dispatches to custom when type=custom", async () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  let called = null;
  solver.solveCustom = async (task, timeouts) => {
    called = task;
    return { token: "custom-token" };
  };
  const result = await solver.solve({ type: "custom", task: { type: "CustomTask" } });
  assert.deepEqual(called, { type: "CustomTask" });
  assert.deepEqual(result, { token: "custom-token" });
});

test("CapMonsterSolver.getBalance returns balance object", async () => {
  const solver = new CapMonsterSolver({ clientKey: "test-key" });
  solver._client = { getBalance: async () => ({ balance: 1.5 }) };
  const result = await solver.getBalance();
  assert.deepEqual(result, { balance: 1.5 });
});

test("CapMonsterSolver uses env vars for pageAction and minScore", () => {
  const oldAction = process.env.CAPMONSTER_PAGE_ACTION;
  const oldScore = process.env.CAPMONSTER_MIN_SCORE;
  process.env.CAPMONSTER_PAGE_ACTION = "login";
  process.env.CAPMONSTER_MIN_SCORE = "0.9";
  try {
    const solver = new CapMonsterSolver({ clientKey: "test-key" });
    assert.equal(solver.pageAction, "login");
    assert.equal(solver.minScore, 0.9);
  } finally {
    if (oldAction) process.env.CAPMONSTER_PAGE_ACTION = oldAction;
    else delete process.env.CAPMONSTER_PAGE_ACTION;
    if (oldScore) process.env.CAPMONSTER_MIN_SCORE = oldScore;
    else delete process.env.CAPMONSTER_MIN_SCORE;
  }
});
