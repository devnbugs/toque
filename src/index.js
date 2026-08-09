/**
 * Cloudflare Worker entry point.
 *
 * Public-facing gateway for the Toque container. Handles Workflow management
 * endpoints directly and proxies everything else to the container.
 */

import { Container } from "@cloudflare/containers";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { jsonResponse } from "./utils.js";

export class ToqueContainer extends Container {
  defaultPort = 8080;
  // Keep the container always active (no scale-to-zero) so SSH sessions,
  // scheduled tasks, and requests have no cold-start delay.
  sleepAfter = "99999h";
  // Ensure the container has outbound internet access (enabled by default,
  // but made explicit here for clarity — the Nusuk API needs it).
  enableInternet = true;

  // Pass Worker vars to the container as environment variables.
  // ACTIVE_ENTITY_ID and SYSTEM_USER_ID are NOT hardcoded here — they are
  // auto-filled by running `nusuk login` or `nusuk pull` via /cmd, which
  // saves them to entity.json inside the container's filesystem.
  //
  // AUTHA_PROXY_URL: when set, the container's AuthaWorker client routes
  // auth/captcha pulls through this Worker's /autha/* service-binding proxy
  // instead of calling the autha-worker over the public internet. The Worker
  // injects WORKER_API_TOKEN via the binding, so the container doesn't need
  // to send it. Falls back to WORKER_URL (direct) when unset.
  envVars = {
    WORKER_URL: env.WORKER_URL,
    WORKER_API_TOKEN: env.WORKER_API_TOKEN,
    AUTHA_PROXY_URL: env.AUTHA_PROXY_URL || (env.TOQUE_WORKER_URL ? `${env.TOQUE_WORKER_URL}/autha` : ""),
    CAPMONSTER_API_KEY: env.CAPMONSTER_API_KEY,
    CAPSOLVER_API_KEY: env.CAPSOLVER_API_KEY,
  };

  onStart() {
    console.log(JSON.stringify({ message: "toque container started" }));
  }

  onStop() {
    console.log(JSON.stringify({ message: "toque container stopped" }));
  }

  onError(error) {
    console.error(
      JSON.stringify({
        message: "toque container error",
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Cloudflare Access authentication
// ---------------------------------------------------------------------------
//
// When Cloudflare Access (Zero Trust) is in front of this Worker, every
// request carries a signed JWT in the `Cf-Access-Jwt-Assertion` header.
// We validate it against the team's public keys to prove the request came
// through Access and not a malicious third party.
//
// For programmatic clients (curl, scripts) that can't go through the browser
// flow, we also accept a bearer token in the `X-API-Key` header that matches
// the `TOQUE_API_KEY` secret. This keeps the API protected without requiring
// a browser session for every call.
//
// When Cloudflare Access is enabled with Managed OAuth, non-browser clients
// (CLIs, scripts, AI agents) receive a 401 with a WWW-Authenticate header
// pointing to the Access OAuth discovery endpoints. The client opens a
// browser to authenticate, receives an OAuth access token, and presents it
// as the Cf-Access-Jwt-Assertion header on subsequent requests.
//
// Configuration (set via `wrangler secret put` or vars in wrangler.jsonc):
//   TEAM_DOMAIN   — https://<your-team>.cloudflareaccess.com
//   POLICY_AUD    — the AUD tag from your Access application
//   TOQUE_API_KEY — optional shared secret for X-API-Key header auth
//
// When TEAM_DOMAIN is not set, authentication is disabled (open mode, useful
// for initial setup or when Access is enforced by a Cloudflare Access policy
// on the route itself).

let jwksCache = null;

function getJwks() {
  if (!jwksCache && env.TEAM_DOMAIN) {
    jwksCache = createRemoteJWKSet(
      new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)
    );
  }
  return jwksCache;
}

/** Paths that never require authentication (health checks, docs). */
const PUBLIC_PATHS = new Set(["/health"]);

/**
 * Build a 401 response with WWW-Authenticate header for Managed OAuth.
 * When Access is enabled with Managed OAuth, non-browser clients use the
 * OAuth 2.0 authorization code flow. The WWW-Authenticate header points
 * them to the discovery endpoint.
 */
function unauthorizedResponse(url) {
  const headers = {};
  if (env.TEAM_DOMAIN) {
    // Point non-browser clients to the OAuth discovery endpoint.
    // Access intercepts this and serves the RFC 8414 metadata.
    headers["WWW-Authenticate"] = `Bearer realm="toque", error="invalid_token"`;
  }
  return new Response(
    JSON.stringify({
      ok: false,
      error: "Authentication required",
      hint: env.TEAM_DOMAIN
        ? "Use the OAuth 2.0 authorization code flow via Cloudflare Access, or provide an X-API-Key header."
        : "Set TEAM_DOMAIN in wrangler config to enable Cloudflare Access auth.",
    }, null, 2),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    }
  );
}

/**
 * Validate the incoming request against Cloudflare Access or the API key.
 * Returns null on success, or a 401/403 Response on failure.
 */
async function authenticate(request, url) {
  // Open mode: no TEAM_DOMAIN configured → skip auth entirely
  if (!env.TEAM_DOMAIN) return null;

  // Public paths bypass auth (health checks, docs)
  if (PUBLIC_PATHS.has(url.pathname)) return null;

  // 1. Cloudflare Access JWT (browser + OAuth flow + service token)
  const accessJwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (accessJwt) {
    try {
      const jwks = getJwks();
      const verifyOptions = { issuer: env.TEAM_DOMAIN };
      if (env.POLICY_AUD) verifyOptions.audience = env.POLICY_AUD;
      await jwtVerify(accessJwt, jwks, verifyOptions);
      return null; // valid Access token
    } catch (err) {
      console.error(
        JSON.stringify({
          message: "invalid Cloudflare Access token",
          path: url.pathname,
          error: err instanceof Error ? err.message : String(err),
        })
      );
      return jsonResponse(403, {
        ok: false,
        error: "Invalid Cloudflare Access token",
        detail: err.message,
      });
    }
  }

  // 2. API key fallback (X-API-Key header for scripts/curl)
  if (env.TOQUE_API_KEY) {
    const apiKey = request.headers.get("X-API-Key");
    if (apiKey) {
      // Timing-safe comparison to prevent timing side-channel attacks
      const provided = new TextEncoder().encode(apiKey);
      const expected = new TextEncoder().encode(env.TOQUE_API_KEY);
      if (provided.length === expected.length) {
        const valid = await crypto.subtle.timingSafeEqual(provided, expected);
        if (valid) return null; // valid API key
      }
    }
  }

  // No valid credential found — return 401 with WWW-Authenticate
  return unauthorizedResponse(url);
}

/**
 * VisaScheduleWorkflow — durable scheduled visa send using Cloudflare Workflows.
 *
 * Instead of holding a setTimeout in the container (which is lost if the
 * container sleeps or restarts), this Workflow runs in the Worker runtime
 * with durable execution. It:
 *   1. Optionally pulls fresh auth/captcha from the autha-worker
 *   2. Sleeps until the target time using step.sleep()
 *   3. Sends the visa request to the container's /send endpoint
 *   4. Returns the result
 *
 * The Workflow survives Worker restarts, container sleep/wake cycles, and
 * automatically retries failed steps.
 */
export class VisaScheduleWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { targetTime, groupId, captcha, captchaType, payload, pullBefore } =
      event.payload;

    // Step 1: Optionally pull fresh credentials before the scheduled send
    if (pullBefore) {
      await step.do("pull fresh credentials", async () => {
        const container = env.TOQUE_CONTAINER.getByName("toque");
        const resp = await container.fetch(
          new Request("https://internal/pull", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh: true }),
          })
        );
        const json = await resp.json();
        return { ok: json.ok, status: resp.status };
      });
    }

    // Step 2: Durable sleep until the target time.
    // Use step.sleep with a relative duration string to avoid sleepUntil
    // serialization issues with Date objects in steps.
    const targetMs = new Date(targetTime).getTime();
    const waitSeconds = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
    if (waitSeconds > 0) {
      await step.sleep("wait until target time", `${waitSeconds} seconds`);
    }

    // Step 3: Send the visa request to the container
    return step.do(
      "send visa request",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        const container = env.TOQUE_CONTAINER.getByName("toque");
        const sendBody = {
          groupId,
          captcha: captcha !== false,
          captchaType: captchaType || "visa",
          payload,
        };
        const resp = await container.fetch(
          new Request("https://internal/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sendBody),
          })
        );
        const json = await resp.json();
        return {
          ok: json.ok,
          status: resp.status,
          data: json.data,
          timing: json.timing,
          firedAt: new Date().toISOString(),
        };
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Workflow endpoint helpers
// ---------------------------------------------------------------------------

/**
 * Parse a target time string into a Date.
 * Accepts ISO strings and HH:MM:SS[.mmm] / HH:MM:SS:mmm (today, or tomorrow
 * if the time has already passed today).
 */
function parseTargetTime(targetTime) {
  if (typeof targetTime === "string" && /^\d{1,2}:\d{2}:\d{2}(?:(?:\.|:)\d{1,3})?$/.test(targetTime)) {
    const parts = targetTime.split(":");
    const h = parts[0];
    const m = parts[1];
    let s = parts[2];
    let ms = 0;
    if (parts[2].includes(".")) {
      [s, ms] = parts[2].split(".");
    } else if (parts.length === 4) {
      ms = parts[3];
    }
    const target = new Date();
    target.setHours(Number(h), Number(m), Number(s), Number(String(ms || "").padEnd(3, "0")));
    if (target.getTime() <= Date.now()) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }
  return new Date(targetTime);
}

async function createWorkflowInstance(body) {
  const { targetTime, groupId } = body;
  if (!targetTime) {
    return jsonResponse(400, { ok: false, error: "targetTime is required (ISO string or HH:MM:SS[.mmm])" });
  }
  if (!groupId) {
    return jsonResponse(400, { ok: false, error: "groupId is required" });
  }

  const target = parseTargetTime(targetTime);
  if (isNaN(target.getTime())) {
    return jsonResponse(400, { ok: false, error: "Invalid targetTime" });
  }

  const instance = await env.VISA_SCHEDULE_WORKFLOW.create({
    payload: {
      targetTime: target.toISOString(),
      groupId: String(groupId),
      captcha: body.captcha !== false,
      captchaType: body.captchaType || "visa",
      payload: body.payload || null,
      pullBefore: body.pullBefore !== false,
    },
  });

  return jsonResponse(200, {
    ok: true,
    instanceId: instance.id,
    targetTime: target.toISOString(),
    groupId: String(groupId),
  });
}

async function getWorkflowStatus(instanceId) {
  if (!instanceId) {
    return jsonResponse(400, { ok: false, error: "instanceId query param is required" });
  }
  try {
    const instance = await env.VISA_SCHEDULE_WORKFLOW.get(instanceId);
    const status = await instance.status();
    return jsonResponse(200, { ok: true, instanceId, status });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: err.message });
  }
}

async function terminateWorkflow(instanceId) {
  if (!instanceId) {
    return jsonResponse(400, { ok: false, error: "instanceId is required" });
  }
  try {
    const instance = await env.VISA_SCHEDULE_WORKFLOW.get(instanceId);
    await instance.terminate();
    return jsonResponse(200, { ok: true, instanceId, terminated: true });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// API documentation
// ---------------------------------------------------------------------------

const API_DOCS = [
  {
    method: "ANY",
    path: "/* (authentication)",
    description:
      "All endpoints (except /health) require authentication via Cloudflare Access (Managed OAuth) or X-API-Key header. " +
      "When TEAM_DOMAIN is set, non-browser clients receive a 401 with WWW-Authenticate pointing to the OAuth 2.0 " +
      "discovery endpoint. The client opens a browser to authenticate, receives an access token, and presents it " +
      "as the Cf-Access-Jwt-Assertion header. Browser requests are handled transparently by Access.",
    auth: "Cf-Access-Jwt-Assertion (OAuth 2.0 flow) OR X-API-Key",
  },
  {
    method: "GET",
    path: "/help",
    description: "Show this API documentation with all endpoints, usage, and examples",
  },
  { method: "GET", path: "/", description: "Alias for /help — shows API documentation" },
  {
    method: "POST",
    path: "/schedule/workflow",
    description: "Create a durable Cloudflare Workflow instance for scheduled visa send",
    body: {
      targetTime: "string (required — ISO string or HH:MM:SS[.mmm] / HH:MM:SS:mmm)",
      groupId: "string (required — group ID)",
      captcha: "boolean (optional — default true)",
      captchaType: "string (optional — visa|login|general, default: visa)",
      payload: "object (optional — custom visa payload)",
      pullBefore: "boolean (optional — pull fresh creds before send, default true)",
    },
    example:
      'curl -X POST https://toque.decloud.workers.dev/schedule/workflow -H "Content-Type: application/json" -d \'{"targetTime": "21:00:00:000", "groupId": "12345", "captcha": true}\'',
    response: { ok: true, instanceId: "abc-123", targetTime: "ISO", groupId: "12345" },
  },
  {
    method: "GET",
    path: "/schedule/workflow/status",
    description: "Check the status of a Workflow instance",
    params: { instanceId: "string (required — workflow instance ID)" },
    example: "curl 'https://toque.decloud.workers.dev/schedule/workflow/status?instanceId=abc-123'",
    response: { ok: true, instanceId: "abc-123", status: "{ status, steps, ... }" },
  },
  {
    method: "POST",
    path: "/schedule/workflow/terminate",
    description: "Terminate a running Workflow instance",
    body: { instanceId: "string (required — workflow instance ID)" },
    example:
      'curl -X POST https://toque.decloud.workers.dev/schedule/workflow/terminate -H "Content-Type: application/json" -d \'{"instanceId": "abc-123"}\'',
    response: { ok: true, instanceId: "abc-123", terminated: true },
  },
  {
    method: "ANY",
    path: "/autha/*",
    description:
      "Internal proxy to the autha-worker via a service binding. " +
      "The /autha/ prefix is stripped before forwarding (e.g. /autha/api/entity/123/context → /api/entity/123/context). " +
      "The WORKER_API_TOKEN is injected automatically by the Worker, so callers don't need to send it. " +
      "Used by the container to pull auth/captcha without a public internet round-trip.",
    auth: "internal (container → Worker → service binding)",
  },
  {
    method: "ANY",
    path: "/* (all other paths)",
    description:
      "All other requests are proxied to the Toque container, which handles: /pull, /info, /send, /api, /request, /groups, /captcha/solve, /schedule, /cmd, /cmd/list, /api-list, /health",
    note: "See the container's /help endpoint for full docs: curl https://toque.decloud.workers.dev/help",
  },
];

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleWorkflowRoutes(url, request) {
  if (url.pathname === "/schedule/workflow" && request.method === "POST") {
    try {
      return await createWorkflowInstance(await request.json());
    } catch (err) {
      return jsonResponse(500, { ok: false, error: err.message });
    }
  }

  if (url.pathname === "/schedule/workflow/status" && request.method === "GET") {
    return getWorkflowStatus(url.searchParams.get("instanceId"));
  }

  if (url.pathname === "/schedule/workflow/terminate" && request.method === "POST") {
    try {
      const body = await request.json();
      return terminateWorkflow(body.instanceId);
    } catch (err) {
      return jsonResponse(500, { ok: false, error: err.message });
    }
  }

  return null;
}

/**
 * Proxy /autha/* requests to the autha-worker via a service binding.
 *
 * The service binding (env.AUTHA_WORKER) sends requests directly within
 * Cloudflare's network — no public internet round-trip. The /autha/ prefix
 * is stripped, so `/autha/api/entity/123/context` becomes
 * `/api/entity/123/context` on the autha-worker.
 *
 * The WORKER_API_TOKEN is injected automatically from the Worker's secret,
 * so the container doesn't need to send it over the network. If the
 * incoming request already has an Authorization header, it's preserved
 * (allows the CLI to use its own token when running locally).
 */
function proxyToAuthaWorker(request, url) {
  if (!env.AUTHA_WORKER) {
    return jsonResponse(500, {
      ok: false,
      error: "AUTHA_WORKER service binding not configured",
    });
  }

  // Strip the /autha/ prefix
  const targetPath = url.pathname.replace(/^\/autha/, "") + url.search;

  // Build the forwarded request — preserve method, body, and most headers
  const headers = new Headers(request.headers);
  // Inject the API token if not already present
  if (!headers.has("Authorization") && env.WORKER_API_TOKEN) {
    headers.set("Authorization", `Bearer ${env.WORKER_API_TOKEN}`);
  }

  const proxyRequest = new Request(
    new URL(targetPath, "https://autha-worker.internal"),
    {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : null,
      redirect: "manual",
    }
  );

  return env.AUTHA_WORKER.fetch(proxyRequest);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- Authentication (Cloudflare Access / API key) ---
    // Skip auth for the internal /autha/ proxy path — the container calls
    // this proxy to reach the autha-worker, and the proxy injects the
    // WORKER_API_TOKEN via the service binding. The container itself has no
    // X-API-Key to send (it's internal), so auth would block it.
    const isAuthaProxy = url.pathname.startsWith("/autha/");
    if (!isAuthaProxy) {
      const authError = await authenticate(request, url);
      if (authError) return authError;
    }

    // --- Help / API docs (GET / and GET /help) ---
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/help")) {
      return jsonResponse(200, {
        ok: true,
        service: "toque-worker",
        baseUrl: "https://toque.decloud.workers.dev",
        endpoints: API_DOCS,
      });
    }

    // --- Workflow management endpoints ---
    const workflowResponse = await handleWorkflowRoutes(url, request);
    if (workflowResponse) return workflowResponse;

    // --- Autha-worker proxy (service binding) ---
    // Forwards /autha/* requests to the autha-worker via a service binding,
    // so the container can reach it within Cloudflare's network instead of
    // over the public internet. The /autha/ prefix is stripped before
    // forwarding. The container's AuthaWorker client points WORKER_URL at
    // this Worker's /autha path when AUTHA_PROXY_MODE is set.
    if (url.pathname.startsWith("/autha/")) {
      return proxyToAuthaWorker(request, url);
    }

    // --- Proxy everything else to the Toque container ---
    if (!env.TOQUE_CONTAINER) {
      return jsonResponse(500, { ok: false, error: "TOQUE_CONTAINER binding not configured" });
    }

    try {
      const container = env.TOQUE_CONTAINER.getByName("toque");
      // Clone the request so the original body stream stays intact for the proxy
      const response = await container.fetch(new Request(request));
      // Log proxy errors in the background without blocking the response
      if (!response.ok) {
        ctx.waitUntil(
          Promise.resolve().then(() =>
            console.error(
              JSON.stringify({
                message: "container proxy returned non-ok status",
                path: url.pathname,
                status: response.status,
              })
            )
          )
        );
      }
      return response;
    } catch (err) {
      console.error(
        JSON.stringify({
          message: "container proxy failed",
          path: url.pathname,
          error: err instanceof Error ? err.message : String(err),
        })
      );
      return jsonResponse(500, { ok: false, error: err.message });
    }
  },
};
