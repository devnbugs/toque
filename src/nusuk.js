import { readFileSync } from "fs";
import { launch } from "cloakbrowser";

const DEFAULT_BASE_URL = "https://masar.nusuk.sa";

export class Nusuk {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.browserOptions = config.browserOptions || { headless: true };
    this.defaultHeaders = {
      Accept: "application/json, text/plain, */*",
      Origin: config.origin || "https://masar.nusuk.sa",
      Referer: config.referer || "https://masar.nusuk.sa/umrah/reception-area/dashboard/uo",
      ...(config.defaultHeaders || {}),
    };
    this.browser = null;
    this.page = null;
  }

  loadAuth(path) {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    const authInfo = parsed?.response?.data?.authInfo;
    if (!authInfo?.userToken) {
      throw new Error("auth.json missing response.data.authInfo.userToken");
    }
    this.defaultHeaders["Authorization"] = `Bearer ${authInfo.userToken}`;
    return this;
  }

  loadCaptcha(path) {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.captchaToken) {
      throw new Error("captcha.json missing captchaToken");
    }
    this.captchaToken = parsed.captchaToken;
    return this;
  }

  loadEntity(config = {}) {
    const id = config.activeEntityId || process.env.ACTIVE_ENTITY_ID;
    const typeId = config.activeEntityTypeId || process.env.ACTIVE_ENTITY_TYPE_ID;
    if (id) this.defaultHeaders["activeentityid"] = String(id);
    if (typeId) this.defaultHeaders["activeentitytypeid"] = String(typeId);
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
    if (!currentUrl || !currentUrl.startsWith(origin)) {
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
        url: new URL(path, this.baseUrl).toString(),
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
