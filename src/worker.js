/**
 * AuthaWorker — client for the D1-backed autha-worker REST API.
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
import { parseJwt } from "./jwt.js";

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
    this._contextCache = new Map();
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

  async fetchContext(entityId, { refresh = false } = {}) {
    const eid = entityId || this.entityId;
    if (!eid) throw new Error("Entity ID required (pass entityId or --entity)");
    if (!refresh && this._contextCache.has(eid)) return this._contextCache.get(eid);
    const context = await this._get(`/api/entity/${encodeURIComponent(eid)}/context`);
    this._contextCache.set(eid, context);
    return context;
  }

  async fetchUserContext(systemUserId) {
    const uid = String(systemUserId || this.systemUserId || "").trim();
    if (!uid) throw new Error("System user ID is required");
    return this._get(`/api/user/${encodeURIComponent(uid)}/context`);
  }

  /**
   * Pull the latest auth token (Bearer) captured for an entity.
   * Searches the newest AUTH_TOKEN / SYNC records and extracts the token.
   */
  async fetchLatestAuthToken(entityId) {
    const eid = entityId || this.entityId;
    if (!eid) throw new Error("Entity ID required (pass entityId or --entity)");

    try {
      const context = await this.fetchContext(eid);
      const token = this.extractToken(context.auth);
      if (token) return token;
    } catch {
      // Fall back to the legacy endpoint during staged Worker upgrades.
    }

    try {
      const json = await this._get(`/entity/${eid}/token/latest`);
      const token = this.extractToken(json.latestAuthToken);
      if (token) return token;
    } catch {
      // Fall back to the record scan below.
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
        const token = this.extractToken(rec.record);
        if (token) return token;
      } catch {
        // record may have been purged/deleted — skip and try the next
      }
    }
    return null;
  }

  /**
   * Pull the latest captcha token captured for an entity.
  * type: "login" | "visa" | "general". Falls back across types unless strict.
   */
  async fetchLatestCaptcha(entityId, type = "visa", { strict = false } = {}) {
    const eid = entityId || this.entityId;
    if (!eid) throw new Error("Entity ID required (pass entityId or --entity)");

    try {
      const context = await this.fetchContext(eid);
      const captcha = context.captcha || {};
      const preferred = type === "login"
        ? captcha.login
        : type === "general"
          ? captcha.latest
          : captcha.visa;
      const order = strict
        ? [preferred]
        : type === "login"
          ? [captcha.login, captcha.latest, captcha.visa]
          : type === "general"
            ? [captcha.latest, captcha.visa, captcha.login]
            : [captcha.visa, captcha.latest, captcha.login];
      const found = order.find((entry) => entry?.captchaToken);
      if (found) return found.captchaToken;
    } catch {
      // Fall back to individual endpoints during staged Worker upgrades.
    }

    const order = strict
      ? [type]
      : type === "login"
        ? ["login", "general", "visa"]
        : type === "general"
          ? ["general", "visa", "login"]
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

  extractToken(record) {
    if (!record || typeof record !== "object") return null;
    const candidates = [
      record.token,
      record.payload?.token,
      record.payload?.authToken,
      record.headers?.request?.authorization,
      record.headers?.captured?.authorization,
      record.headers?.authorization,
      record.authHeader,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        const parsed = parseJwt(c);
        if (parsed) return parsed.token;
      }
    }
    return null;
  }
}
