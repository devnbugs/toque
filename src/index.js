/**
 * Cloudflare Worker entry point.
 *
 * Routes incoming HTTP requests to the Toque container. The container runs
 * the headless browser and Nusuk API logic; this Worker is the public-facing
 * gateway.
 */

import { Container } from "@cloudflare/containers";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { env } from "cloudflare:workers";

export class ToqueContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "60s";

  // Pass Worker secrets and vars to the container as environment variables.
  // ACTIVE_ENTITY_ID and SYSTEM_USER_ID are NOT hardcoded here — they are
  // auto-filled by running `nusuk login` or `nusuk pull` via /cmd, which
  // saves them to entity.json inside the container's filesystem.
  envVars = {
    WORKER_URL: env.WORKER_URL,
    WORKER_API_TOKEN: env.WORKER_API_TOKEN,
  };

  onStart() {
    console.log("Toque container started");
  }

  onStop() {
    console.log("Toque container stopped");
  }

  onError(error) {
    console.error("Toque container error:", error);
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * VisaScheduleWorkflow — durable scheduled visa send using Cloudflare Workflows.
 *
 * Instead of holding a setTimeout in the container (which is lost if the
 * container sleeps or restarts), this Workflow runs in the Worker runtime
 * with durable execution. It:
 *   1. Optionally pulls fresh auth/captcha from the autha-worker
 *   2. Sleeps until the target time using step.sleepUntil()
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

    // Step 2: Durable sleep until the target time
    const targetDate = new Date(targetTime);
    await step.sleepUntil("wait until target time", targetDate);

    // Step 3: Send the visa request to the container
    const result = await step.do(
      "send visa request",
      {
        retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
      },
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

    return result;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- Help / API docs (GET / and GET /help) ---
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/help")) {
      return jsonResponse(200, {
        ok: true,
        service: "toque-worker",
        baseUrl: "https://toque.decloud.workers.dev",
        endpoints: [
          {
            method: "GET",
            path: "/help",
            description: "Show this API documentation with all endpoints, usage, and examples",
          },
          {
            method: "GET",
            path: "/",
            description: "Alias for /help — shows API documentation",
          },
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
            example: 'curl -X POST https://toque.decloud.workers.dev/schedule/workflow -H "Content-Type: application/json" -d \'{"targetTime": "21:00:00:000", "groupId": "12345", "captcha": true}\'',
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
            example: 'curl -X POST https://toque.decloud.workers.dev/schedule/workflow/terminate -H "Content-Type: application/json" -d \'{"instanceId": "abc-123"}\'',
            response: { ok: true, instanceId: "abc-123", terminated: true },
          },
          {
            method: "ANY",
            path: "/* (all other paths)",
            description: "All other requests are proxied to the Toque container, which handles: /pull, /info, /send, /api, /request, /groups, /captcha/solve, /schedule, /cmd, /cmd/list, /api-list, /health",
            note: "See the container's /help endpoint for full docs: curl https://toque.decloud.workers.dev/help",
          },
        ],
      });
    }

    // --- Workflow management endpoints ---
    if (url.pathname === "/schedule/workflow" && request.method === "POST") {
      try {
        const body = await request.json();
        const { targetTime, groupId } = body;
        if (!targetTime) {
          return jsonResponse(400, { ok: false, error: "targetTime is required (ISO string or HH:MM:SS[.mmm])" });
        }
        if (!groupId) {
          return jsonResponse(400, { ok: false, error: "groupId is required" });
        }

        // Parse target time — accept ISO string or HH:MM:SS[.mmm] / HH:MM:SS:mmm (today)
        let target;
        if (typeof targetTime === "string" && /^\d{1,2}:\d{2}:\d{2}(?:(?:\.|:)\d{1,3})?$/.test(targetTime)) {
          const parts = targetTime.split(":");
          const h = parts[0];
          const m = parts[1];
          const rest = parts[2];
          let s = rest, ms = 0;
          if (rest.includes(".")) {
            [s, ms] = rest.split(".");
          } else if (parts.length === 4) {
            // HH:MM:SS:mmm format (colon-separated milliseconds)
            s = parts[2];
            ms = parts[3];
          }
          target = new Date();
          target.setHours(Number(h), Number(m), Number(s), Number(String(ms || "").padEnd(3, "0")));
          if (target.getTime() <= Date.now()) {
            target.setDate(target.getDate() + 1);
          }
        } else {
          target = new Date(targetTime);
        }

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
      } catch (err) {
        return jsonResponse(500, { ok: false, error: err.message });
      }
    }

    // Check workflow instance status
    if (url.pathname === "/schedule/workflow/status" && request.method === "GET") {
      const instanceId = url.searchParams.get("instanceId");
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

    // Terminate a workflow instance
    if (url.pathname === "/schedule/workflow/terminate" && request.method === "POST") {
      try {
        const body = await request.json();
        const instanceId = body.instanceId;
        if (!instanceId) {
          return jsonResponse(400, { ok: false, error: "instanceId is required" });
        }
        const instance = await env.VISA_SCHEDULE_WORKFLOW.get(instanceId);
        await instance.terminate();
        return jsonResponse(200, { ok: true, instanceId, terminated: true });
      } catch (err) {
        return jsonResponse(500, { ok: false, error: err.message });
      }
    }

    if (!env.TOQUE_CONTAINER) {
      return jsonResponse(500, { ok: false, error: "TOQUE_CONTAINER binding not configured" });
    }

    try {
      const container = env.TOQUE_CONTAINER.getByName("toque");
      return await container.fetch(request);
    } catch (err) {
      return jsonResponse(500, { ok: false, error: err.message });
    }
  },
};
