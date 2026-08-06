/**
 * HTTP server entry point for the Cloudflare Container.
 *
 * Exposes the Nusuk CLI operations as JSON endpoints so a Cloudflare Worker
 * can route requests to the container. The container is stateless: auth,
 * entity, and captcha values are read from environment variables or request
 * bodies, not from local files.
 */

import { createServer } from "http";
import { Nusuk } from "./nusuk.js";
import { AuthaWorker } from "./worker.js";
import { CapSolver } from "./capsolver.js";
import { buildVisaPayload } from "./visa-payload.js";
import { getRequest, listRequests } from "./requests.js";
import { extractGroups, formatGroups, normalizeGroupId } from "./groups.js";
import { computeSendSchedule } from "./scheduling.js";
import { parsePositiveCount, parseTargetTime } from "./validation.js";

const PORT = Number(process.env.PORT || 8080);

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function buildNusuk(body = {}) {
  const nusuk = new Nusuk({
    baseUrl: body.baseUrl || process.env.NUSUK_BASE_URL,
    origin: body.origin || process.env.NUSUK_ORIGIN,
    referer: body.referer || process.env.NUSUK_REFERER,
    browserOptions: { headless: true },
  });

  const authToken = body.authToken || process.env.AUTH_TOKEN || process.env.NUSUK_AUTH_TOKEN;
  if (authToken) {
    nusuk.setAuthToken(authToken);
  } else {
    nusuk.loadAuth();
  }

  nusuk.loadEntity({
    activeEntityId: body.activeEntityId || process.env.ACTIVE_ENTITY_ID,
    activeEntityTypeId: body.activeEntityTypeId || process.env.ACTIVE_ENTITY_TYPE_ID,
  });

  const captchaType = body.captchaType || process.env.CAPTCHA_TYPE || "visa";
  const captchaToken = body.captchaToken || process.env.CAPTCHA_TOKEN;
  if (captchaToken) {
    nusuk.captchaToken = captchaToken;
  } else {
    nusuk.loadCaptcha(undefined, captchaType);
  }

  return nusuk;
}

async function withNusuk(body, callback) {
  const nusuk = buildNusuk(body);
  await nusuk.init();
  try {
    return await callback(nusuk);
  } finally {
    await nusuk.close();
  }
}

async function handlePull(body) {
  requireEnv(["WORKER_URL", "WORKER_API_TOKEN", "ACTIVE_ENTITY_ID"]);
  const worker = new AuthaWorker({
    endpoint: process.env.WORKER_URL,
    apiToken: process.env.WORKER_API_TOKEN,
    entityId: body.activeEntityId || process.env.ACTIVE_ENTITY_ID,
    systemUserId: body.systemUserId || process.env.SYSTEM_USER_ID,
  });
  const context = await worker.fetchContext(undefined, { refresh: Boolean(body.refresh) });
  return { ok: true, context };
}

async function handleInfo(body) {
  return withNusuk(body, async (nusuk) => {
    const res = await nusuk.request(
      "/umrah/reports_apis/api/Dashboard/DashboardCompanyInfo",
      { method: "POST", payload: {} }
    );
    return { ok: res.ok, status: res.status, data: res.json };
  });
}

async function handleSend(body) {
  const groupId = normalizeGroupId(body.groupId);
  if (!groupId) {
    throw new Error("groupId is required");
  }
  return withNusuk(body, async (nusuk) => {
    const payload = buildVisaPayload(body.payload, groupId, nusuk.captchaToken);
    const res = await nusuk.request(
      "/umrah/visa_apis/api/Visa/SendToIssueVisa",
      { method: "POST", payload }
    );
    return { ok: res.ok, status: res.status, data: res.json, timing: res.timing };
  });
}

async function handleApi(body) {
  const name = String(body.name || "").trim().toLowerCase();
  const request = getRequest(name);
  if (!request) {
    throw new Error(`Unknown API request: ${body.name}`);
  }
  return withNusuk(body, async (nusuk) => {
    const payload = request.captcha
      ? { ...request.payload, captchaToken: nusuk.captchaToken }
      : request.payload;
    const res = await nusuk.request(request.path, {
      method: request.method,
      payload,
    });
    return { ok: res.ok, status: res.status, data: res.json, timing: res.timing };
  });
}

async function handleRequest(body) {
  if (!body.path) throw new Error("path is required");
  return withNusuk(body, async (nusuk) => {
    const res = await nusuk.request(body.path, {
      method: body.method || "GET",
      payload: body.payload,
      headers: body.headers || {},
    });
    return { ok: res.ok, status: res.status, data: res.json || res.body, timing: res.timing };
  });
}

async function handleGroups(body) {
  return withNusuk(body, async (nusuk) => {
    const limit = parsePositiveCount(body.limit) || 10;
    const offset = parsePositiveCount(body.offset) || 0;
    const res = await nusuk.request("/umrah/groups_apis/api/Groups/GetGroupList", {
      method: "POST",
      payload: {
        limit,
        offset,
        filterList: [],
        sortColumn: null,
        sortCriteria: [],
        noCount: true,
      },
    });
    const groups = extractGroups(res.json);
    return {
      ok: res.ok,
      status: res.status,
      groups: formatGroups(groups),
      raw: body.raw ? res.json : undefined,
    };
  });
}

async function handleCaptchaSolve(body) {
  requireEnv(["CAPSOLVER_API_KEY"]);
  const solver = new CapSolver({
    apiKey: process.env.CAPSOLVER_API_KEY,
    siteKey: body.siteKey || process.env.CAPSOLVER_SITE_KEY,
    pageUrl: body.pageUrl || process.env.CAPSOLVER_PAGE_URL,
    pageAction: body.pageAction || process.env.CAPSOLVER_PAGE_ACTION,
  });
  const token = await solver.solve();
  return { ok: true, token };
}

async function handleSchedule(body) {
  const target = parseTargetTime(body.target);
  if (!target) throw new Error("target time is required (HH:MM:SS[.mmm])");
  const groupId = normalizeGroupId(body.groupId);
  if (!groupId) throw new Error("groupId is required");

  return withNusuk(body, async (nusuk) => {
    const schedule = computeSendSchedule(target);
    const payload = buildVisaPayload(body.payload, groupId, nusuk.captchaToken);

    if (schedule.waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, schedule.waitMs));
    }

    const res = await nusuk.request(
      "/umrah/visa_apis/api/Visa/SendToIssueVisa",
      { method: "POST", payload }
    );
    return {
      ok: res.ok,
      status: res.status,
      data: res.json,
      timing: res.timing,
      scheduledAt: schedule.target.toISOString(),
      firedAt: new Date().toISOString(),
    };
  });
}

async function handleListApis() {
  return { ok: true, requests: listRequests() };
}

const ROUTES = {
  "/": async () => ({ ok: true, service: "toque-container" }),
  "/health": async () => ({ ok: true }),
  "/pull": handlePull,
  "/info": handleInfo,
  "/send": handleSend,
  "/api": handleApi,
  "/request": handleRequest,
  "/groups": handleGroups,
  "/captcha/solve": handleCaptchaSolve,
  "/schedule": handleSchedule,
  "/api-list": handleListApis,
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const handler = ROUTES[url.pathname];

  if (!handler) {
    return jsonResponse(res, 404, { ok: false, error: `Unknown route: ${url.pathname}` });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.method === "POST" ? await parseBody(req) : {};
    const result = await handler(body);
    jsonResponse(res, result.status && !result.ok ? result.status : 200, result);
  } catch (err) {
    jsonResponse(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Toque container listening on port ${PORT}`);
});
