import { readFileSync } from "fs";
import { launch } from "cloakbrowser";
import { parseJwt, requireJwt } from "./jwt.js";

const DEFAULT_BASE_URL = "https://masar.nusuk.sa";

export class Nusuk {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    const base = new URL(this.baseUrl);
    this.browserOptions = config.browserOptions || { headless: true };
    this.defaultHeaders = {
      Accept: "application/json, text/plain, */*",
      Origin: config.origin || base.origin,
      Referer: config.referer || new URL("/umrah/reception-area/dashboard/uo", base).toString(),
      ...(config.defaultHeaders || {}),
    };
    this.browser = null;
    this.page = null;
  }

  loadAuth(path) {
    const credsPath = process.env.CREDS_PATH || "creds.json";
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      parsed = null;
    }
    if (!parseJwt(parsed?.response?.data?.authInfo?.userToken)) {
      try {
        parsed = JSON.parse(readFileSync(credsPath, "utf8"));
      } catch {
        throw new Error("auth file missing response.data.authInfo.userToken");
      }
    }
    const authInfo = parsed?.response?.data?.authInfo;
    const token = requireJwt(authInfo?.userToken, "response.data.authInfo.userToken");
    this.setAuthToken(token);
    if (parsed?.entityId) {
      this.setEntityId(parsed.entityId);
      if (parsed.entityTypeId && !this.entityTypeId) {
        this.setEntityTypeId(parsed.entityTypeId);
      }
    }
    return this;
  }

  setEntityId(entityId) {
    if (entityId) {
      this.entityId = String(entityId);
      this.defaultHeaders["activeentityid"] = String(entityId);
    }
    return this;
  }

  setEntityTypeId(entityTypeId) {
    if (entityTypeId) {
      this.entityTypeId = String(entityTypeId);
      this.defaultHeaders["activeentitytypeid"] = String(entityTypeId);
    }
    return this;
  }

  setAuthToken(token) {
    const validated = requireJwt(token, "auth token");
    this.defaultHeaders["Authorization"] = `Bearer ${validated}`;
    return this;
  }

  loadCaptcha(path) {
    const credsPath = process.env.CREDS_PATH || "creds.json";
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      parsed = null;
    }
    if (!parsed?.captchaToken) {
      try {
        parsed = JSON.parse(readFileSync(credsPath, "utf8"));
      } catch {
        throw new Error("captcha file missing captchaToken");
      }
    }
    if (!parsed?.captchaToken) {
      throw new Error("captcha file missing captchaToken");
    }
    this.captchaToken = parsed.captchaToken;
    return this;
  }

  loadEntity(config = {}) {
    const filePath = config.path || process.env.ENTITY_CONFIG_PATH || "entity.json";
    let file = {};
    try {
      file = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {}

    const id = config.activeEntityId || process.env.ACTIVE_ENTITY_ID || file.activeEntityId;
    const typeId = config.activeEntityTypeId || process.env.ACTIVE_ENTITY_TYPE_ID || file.activeEntityTypeId;

    if (id && !this.entityId) this.setEntityId(id);
    if (typeId && !this.entityTypeId) this.setEntityTypeId(typeId);
    return this;
  }

  async init() {
    this.browser = await launch(this.browserOptions);
    this.page = await this.browser.newPage();
    return this;
  }

  async pageInfo() {
    return {
      status: this.page ? (await this.page.goto(this.baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      })).status() : null,
      url: this.page ? this.page.url() : null,
      title: this.page ? await this.page.title() : null,
    };
  }

  async _ensureOrigin() {
    const currentUrl = this.page.url();
    const { origin } = new URL(this.baseUrl);
    let currentOrigin = null;
    try {
      currentOrigin = new URL(currentUrl).origin;
    } catch {}
    if (currentOrigin !== origin) {
      await this.page.goto(this.baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    }
  }

  async request(path, { method = "GET", payload = null, headers = {}, credentials = "include", mode = "cors", redirect = "follow" } = {}) {
    if (!this.page) {
      throw new Error("Nusuk not initialized. Call await nusuk.init() first.");
    }

    const requestUrl = new URL(path, this.baseUrl);
    const allowedOrigin = new URL(this.baseUrl).origin;
    if (requestUrl.origin !== allowedOrigin) {
      throw new Error(`Refusing cross-origin request to ${requestUrl.origin}`);
    }

    await this._ensureOrigin();
    const requestHeaders = { ...this.defaultHeaders, ...headers };

    return this.page.evaluate(
      async ({ url, options }) => {
        performance.clearResourceTimings();
        const fetchStart = performance.now();
        const res = await fetch(url, options);
        const fetchEnd = performance.now();
        const text = await res.text();
        const responseHeaders = {};
        res.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        let jsonBody = null;
        try {
          jsonBody = text ? JSON.parse(text) : null;
        } catch {
          jsonBody = null;
        }

        const entries = performance.getEntriesByType("resource");
        const entry = entries.find((e) => e.name === url || res.url.includes(new URL(e.name).pathname));
        const timing = {
          total: Math.round(fetchEnd - fetchStart),
        };
        if (entry) {
          timing.ttfb = Math.round(entry.responseStart - entry.requestStart);
          if (entry.secureConnectionStart > 0) {
            timing.tlsHandshake = Math.round(entry.connectEnd - entry.secureConnectionStart);
          }
        }

        return {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          url: res.url,
          headers: responseHeaders,
          body: text,
          json: jsonBody,
          timing,
        };
      },
      {
        url: requestUrl.toString(),
        options: (() => {
          const opts = {
            method,
            credentials,
            mode,
            redirect,
            headers: requestHeaders,
          };

          if (payload !== null && payload !== undefined) {
            const hasContentType = Object.keys(requestHeaders).some(
              (k) => k.toLowerCase() === "content-type"
            );
            if (!hasContentType) {
              opts.headers["Content-Type"] = "application/json";
            }
            opts.body = typeof payload === "string" ? payload : JSON.stringify(payload);
          }

          return opts;
        })(),
      }
    );
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
