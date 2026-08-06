/**
 * Cloudflare Worker entry point.
 *
 * Routes incoming HTTP requests to the Toque container. The container runs
 * the headless browser and Nusuk API logic; this Worker is the public-facing
 * gateway.
 */

import { Container } from "cloudflare:containers";

export class ToqueContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "60s";

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
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse(200, { ok: true, service: "toque-worker" });
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
