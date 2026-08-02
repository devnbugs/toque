/**
 * AuthaWorker — client for the autha-worker Cloudflare Worker KV REST API.
 *
 * Pulls the latest captured auth token and captcha token that the browser
 * extension saved to the worker, so toque can use them for actions without
 * manually copying files.
 *
 * Usage:
 *   const worker = new AuthaWorker({ entityId: "525513" });
 *   const token   = await worker.fetchLatestAuthToken();
 *   const captcha = await worker.fetchLatestCaptcha("visa");
 */

import { readFileSync } from "fs";

const DEFAULT_ENDPOINT = "https://autha-worker.decloud.workers.dev";

export class AuthaWorker {
  constructor(config = {}) {
    this.endpoint = (
      config.endpoint ||
      process.env.WORKER_URL ||
      DEFAULT_ENDPOINT
    ).replace(/\/+$/, "");
    this.entityId =
      config.entityId || process.env.ACTIVE_ENTITY_ID || this._readEntityFile()?.activeEntityId || null;
    this.systemUserId =
      config.systemUserId ||
      process.env.SYSTEM_USER_ID ||
      this._readEntityFile()?.systemUserId ||
      "default";
    this.apiToken = config.apiToken || process.env.WORKER_API_TOKEN || "";
  }

  _readEntityFile() {
    const filePath = process.env.ENTITY_CONFIG_PATH || "entity.json";
    try {
      return JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  async _get(path) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.endpoint}${path}${sep}systemUserId=${encodeURIComponent(this.systemUserId)}`;
    if (!this.apiToken) {
      throw new Error("WORKER_API_TOKEN is required");
    }
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiToken}`,
      },
    });
    let json = null;
    try {
      json = await resp.json();
    } catch {
      json = null;
    }
    if (!resp.ok || !json?.ok) {
      throw new Error(
        `Worker GET ${path} failed (${resp.status}): ${json?.error || resp.statusText}`
      );
    }
    return json;
  }

  /**
   * Pull the latest auth token (Bearer) captured for an entity.
   * Searches the newest AUTH_TOKEN / SYNC records and extracts the token.
   */
  async fetchLatestAuthToken(entityId) {
    const eid = entityId || this.entityId;
    if (!eid) throw new Error("Entity ID required (pass entityId or --entity)");

    try {
      const json = await this._get(`/entity/${eid}/token/latest`);
      const token = this._extractToken(json.latestAuthToken);
      if (token) return token;
    } catch {
      // fall back to the record scan below
    }

    const list = await this._get(
      `/records?prefix=${encodeURIComponent(`entity_${eid}_`)}&limit=200`
    );

    const candidates = (list.records || [])
      .filter((r) => {
        const action = String(r.metadata?.action || "").toUpperCase();
        return action.includes("AUTH_TOKEN") || action.includes("SYNC");
      })
      .sort((a, b) => (b.metadata?.timestamp || 0) - (a.metadata?.timestamp || 0))
      .slice(0, 10);

    for (const r of candidates) {
      try {
        const rec = await this._get(`/records/${encodeURIComponent(r.key)}`);
        const token = this._extractToken(rec.record);
        if (token) return token;
      } catch {
        // record may have been purged/deleted — skip and try the next
      }
    }
    return null;
  }

  /**
   * Pull the latest captcha token captured for an entity.
   * type: "login" | "visa" | "general". Falls back across types.
   */
  async fetchLatestCaptcha(entityId, type = "visa") {
    const eid = entityId || this.entityId;
    if (!eid) throw new Error("Entity ID required (pass entityId or --entity)");

    const order =
      type === "login"
        ? ["login", "general", "visa"]
        : ["visa", "login", "general"];

    for (const t of order) {
      const path =
        t === "login"
          ? `/entity/${eid}/captcha/login`
          : t === "visa"
            ? `/entity/${eid}/captcha/visa`
            : `/entity/${eid}/captcha`;
      try {
        const json = await this._get(path);
        const latest = json.latestCaptcha || json.fallbackGeneralCaptcha || null;
        if (latest?.captchaToken) return latest.captchaToken;
      } catch {
        // try the next captcha type
      }
    }
    return null;
  }

  _extractToken(record) {
    if (!record || typeof record !== "object") return null;
    const candidates = [
      record.payload?.token,
      record.payload?.authToken,
      record.headers?.request?.authorization,
      record.headers?.captured?.authorization,
      record.headers?.authorization,
      record.authHeader,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        return c.replace(/^Bearer\s+/i, "").trim();
      }
    }
    return null;
  }
}
