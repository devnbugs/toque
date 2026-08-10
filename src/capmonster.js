/**
 * CapMonster Cloud captcha solver — uses the official @zennolab_com/capmonstercloud-client
 * SDK to solve CAPTCHAs for the Masar Nusuk platform.
 *
 * Supports:
 *   - reCAPTCHA v2 (RecaptchaV2TaskProxyless) — invisible & visible
 *   - reCAPTCHA v2 Enterprise (RecaptchaV2EnterpriseTaskProxyless)
 *   - reCAPTCHA v3 (RecaptchaV3TaskProxyless) — with pageAction & minScore
 *   - reCAPTCHA v3 Enterprise (RecaptchaV3EnterpriseTaskProxyless)
 *   - Cloudflare Turnstile (TurnstileTask)
 *   - Custom task payloads via CommonCaptcha
 *
 * API reference: https://docs.capmonster.cloud/docs/captchas/
 *
 * Usage:
 *   const solver = new CapMonsterSolver();
 *   const token = await solver.solveRecaptchaV2();
 *
 * Or via the unified solve() method:
 *   const token = await solver.solve({ version: 2, type: "visa" });
 *
 * Environment variables:
 *   CAPMONSTER_API_KEY    — CapMonster Cloud API key (required)
 *   CAPMONSTER_SITE_KEY   — reCAPTCHA/Turnstile site key (default: Nusuk's key)
 *   CAPMONSTER_PAGE_URL   — page URL where the captcha appears
 *   CAPMONSTER_PAGE_ACTION — page action for reCAPTCHA v3 (default: "submit")
 *   CAPMONSTER_MIN_SCORE  — minimum score for v3 (default: 0.7)
 *   CAPMONSTER_SERVICE_URL — API base URL (default: https://api.capmonster.cloud)
 */

// Import from the CJS build — the ESM build has a `module.require` bug
// in CapMonsterCloudClientFactory.CreateUserAgentString() that crashes
// under native ESM. The CJS build works correctly in both ESM and CJS.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const {
  CapMonsterCloudClientFactory,
  ClientOptions,
  RecaptchaV2Request,
  RecaptchaV2EnterpriseRequest,
  RecaptchaV3ProxylessRequest,
  RecaptchaV3EnterpriseRequest,
  TurnstileRequest,
  CommonCaptchaRequest,
} = require("@zennolab_com/capmonstercloud-client");

// Default Nusuk reCAPTCHA site key and page URL
const DEFAULT_SITE_KEY = "6Le-3OwpAAAAAARztuPscqBNbpEY3okMkd7dCoyx";
const DEFAULT_PAGE_URL = "https://masar.nusuk.sa/umrah/mutamer-group/group-list";
const DEFAULT_PAGE_ACTION = "submit";
const DEFAULT_MIN_SCORE = 0.7;
const DEFAULT_SERVICE_URL = "https://api.capmonster.cloud";

export class CapMonsterSolver {
  /**
   * @param {object} [config]
   * @param {string} [config.clientKey] — CapMonster Cloud API key.
   * @param {string} [config.siteKey] — Captcha site key.
   * @param {string} [config.pageUrl] — Page URL where captcha appears.
   * @param {string} [config.pageAction] — Page action for reCAPTCHA v3.
   * @param {number} [config.minScore] — Minimum score for v3 (0.1–0.9).
   * @param {string} [config.serviceUrl] — API base URL.
   */
  constructor(config = {}) {
    this.clientKey = config.clientKey || process.env.CAPMONSTER_API_KEY || null;
    this.siteKey = config.siteKey || process.env.CAPMONSTER_SITE_KEY || DEFAULT_SITE_KEY;
    this.pageUrl = config.pageUrl || process.env.CAPMONSTER_PAGE_URL || DEFAULT_PAGE_URL;
    this.pageAction = config.pageAction || process.env.CAPMONSTER_PAGE_ACTION || DEFAULT_PAGE_ACTION;
    this.minScore = config.minScore ?? (process.env.CAPMONSTER_MIN_SCORE ? Number(process.env.CAPMONSTER_MIN_SCORE) : DEFAULT_MIN_SCORE);
    this.serviceUrl = config.serviceUrl || process.env.CAPMONSTER_SERVICE_URL || DEFAULT_SERVICE_URL;
    this._client = null;
  }

  _assertKey() {
    if (!this.clientKey) {
      throw new Error("CAPMONSTER_API_KEY is required (set the env var or pass clientKey in config)");
    }
  }

  /**
   * Lazily create the CapMonster Cloud client singleton.
   * @returns {CapMonsterCloudClient}
   */
  getClient() {
    this._assertKey();
    if (!this._client) {
      this._client = CapMonsterCloudClientFactory.Create(
        new ClientOptions({
          clientKey: this.clientKey,
          serviceUrl: this.serviceUrl,
        })
      );
    }
    return this._client;
  }

  /**
   * Check the account balance.
   * @returns {Promise<{balance: number}>} Balance info.
   */
  async getBalance() {
    const client = this.getClient();
    const result = await client.getBalance();
    return { balance: result.balance };
  }

  // ─── reCAPTCHA v2 ───────────────────────────────────────────────────

  /**
   * Solve reCAPTCHA v2 (proxyless).
   * @param {object} [options]
   * @param {string} [options.websiteURL] - Override page URL.
   * @param {string} [options.websiteKey] - Override site key.
   * @param {boolean} [options.isInvisible] - Whether the captcha is invisible.
   * @param {string} [options.userAgent] - Browser User-Agent.
   * @param {string} [options.recaptchaDataSValue] - data-s parameter value.
   * @param {number} [options.timeout=180000] - Solve timeout in ms.
   * @returns {Promise<string>} gRecaptchaResponse token.
   */
  async solveRecaptchaV2(options = {}) {
    const client = this.getClient();
    const request = new RecaptchaV2Request({
      websiteURL: options.websiteURL || this.pageUrl,
      websiteKey: options.websiteKey || this.siteKey,
      isInvisible: options.isInvisible || false,
      userAgent: options.userAgent,
      recaptchaDataSValue: options.recaptchaDataSValue,
    });
    const result = await client.Solve(request, {
      timeout: options.timeout || 180000,
    });
    if (result.error) {
      throw new Error(`CapMonster reCAPTCHA v2 error: ${result.error}`);
    }
    const token = result.solution?.gRecaptchaResponse;
    if (!token) {
      throw new Error("CapMonster returned no gRecaptchaResponse for reCAPTCHA v2");
    }
    return token;
  }

  /**
   * Solve reCAPTCHA v2 Enterprise (proxyless).
   * @param {object} [options] - Same as solveRecaptchaV2.
   * @returns {Promise<string>} gRecaptchaResponse token.
   */
  async solveRecaptchaV2Enterprise(options = {}) {
    const client = this.getClient();
    const request = new RecaptchaV2EnterpriseRequest({
      websiteURL: options.websiteURL || this.pageUrl,
      websiteKey: options.websiteKey || this.siteKey,
      isInvisible: options.isInvisible || false,
      userAgent: options.userAgent,
    });
    const result = await client.Solve(request, {
      timeout: options.timeout || 180000,
    });
    if (result.error) {
      throw new Error(`CapMonster reCAPTCHA v2 Enterprise error: ${result.error}`);
    }
    const token = result.solution?.gRecaptchaResponse;
    if (!token) {
      throw new Error("CapMonster returned no gRecaptchaResponse for reCAPTCHA v2 Enterprise");
    }
    return token;
  }

  // ─── reCAPTCHA v3 ───────────────────────────────────────────────────

  /**
   * Solve reCAPTCHA v3 (proxyless).
   * @param {object} [options]
   * @param {string} [options.websiteURL] - Override page URL.
   * @param {string} [options.websiteKey] - Override site key.
   * @param {string} [options.pageAction] - Page action (default: "submit").
   * @param {number} [options.minScore] - Minimum score (0.1–0.9, default: 0.7).
   * @param {number} [options.timeout=180000] - Solve timeout in ms.
   * @returns {Promise<string>} gRecaptchaResponse token.
   */
  async solveRecaptchaV3(options = {}) {
    const client = this.getClient();
    const request = new RecaptchaV3ProxylessRequest({
      websiteURL: options.websiteURL || this.pageUrl,
      websiteKey: options.websiteKey || this.siteKey,
      pageAction: options.pageAction || this.pageAction,
      minScore: options.minScore ?? this.minScore,
    });
    const result = await client.Solve(request, {
      timeout: options.timeout || 180000,
    });
    if (result.error) {
      throw new Error(`CapMonster reCAPTCHA v3 error: ${result.error}`);
    }
    const token = result.solution?.gRecaptchaResponse;
    if (!token) {
      throw new Error("CapMonster returned no gRecaptchaResponse for reCAPTCHA v3");
    }
    return token;
  }

  /**
   * Solve reCAPTCHA v3 Enterprise (proxyless).
   * @param {object} [options] - Same as solveRecaptchaV3.
   * @returns {Promise<string>} gRecaptchaResponse token.
   */
  async solveRecaptchaV3Enterprise(options = {}) {
    const client = this.getClient();
    const request = new RecaptchaV3EnterpriseRequest({
      websiteURL: options.websiteURL || this.pageUrl,
      websiteKey: options.websiteKey || this.siteKey,
      pageAction: options.pageAction || this.pageAction,
      minScore: options.minScore ?? this.minScore,
    });
    const result = await client.Solve(request, {
      timeout: options.timeout || 180000,
    });
    if (result.error) {
      throw new Error(`CapMonster reCAPTCHA v3 Enterprise error: ${result.error}`);
    }
    const token = result.solution?.gRecaptchaResponse;
    if (!token) {
      throw new Error("CapMonster returned no gRecaptchaResponse for reCAPTCHA v3 Enterprise");
    }
    return token;
  }

  // ─── Cloudflare Turnstile ───────────────────────────────────────────

  /**
   * Solve Cloudflare Turnstile.
   * @param {object} [options]
   * @param {string} [options.websiteURL] - Override page URL.
   * @param {string} [options.websiteKey] - Turnstile site key.
   * @param {string} [options.userAgent] - Browser User-Agent.
   * @param {number} [options.timeout=180000] - Solve timeout in ms.
   * @returns {Promise<string>} Turnstile token.
   */
  async solveTurnstile(options = {}) {
    const client = this.getClient();
    const request = new TurnstileRequest({
      websiteURL: options.websiteURL || this.pageUrl,
      websiteKey: options.websiteKey || this.siteKey,
      userAgent: options.userAgent,
    });
    const result = await client.Solve(request, {
      timeout: options.timeout || 180000,
    });
    if (result.error) {
      throw new Error(`CapMonster Turnstile error: ${result.error}`);
    }
    const token = result.solution?.token;
    if (!token) {
      throw new Error("CapMonster returned no token for Turnstile");
    }
    return token;
  }

  // ─── Custom task ────────────────────────────────────────────────────

  /**
   * Solve a custom captcha task via CommonCaptcha.
   * @param {object} task - Full task payload (type, websiteURL, websiteKey, etc).
   * @param {object} [timeouts] - Optional timeout config.
   * @returns {Promise<object>} Solution object.
   */
  async solveCustom(task, timeouts = {}) {
    const client = this.getClient();
    const request = new CommonCaptchaRequest({ task });
    const result = await client.Solve(request, {
      timeout: timeouts.timeout || 180000,
    });
    if (result.error) {
      throw new Error(`CapMonster custom task error: ${result.error}`);
    }
    return result.solution;
  }

  // ─── Unified solve ──────────────────────────────────────────────────

  /**
   * Unified solve method — dispatches to the right solver based on type/version.
   *
   * @param {object} [options]
   * @param {number} [options.version=2] - reCAPTCHA version (2 or 3).
   * @param {string} [options.type="recaptcha"] - Captcha type: "recaptcha", "turnstile", "custom".
   * @param {boolean} [options.enterprise] - Use Enterprise variant.
   * @param {string} [options.captchaType] - Nusuk captcha type for compat ("visa", "login", "general").
   * @param {number} [options.timeout=180000] - Solve timeout in ms.
   * @param {object} [options.task] - Custom task payload (when type="custom").
   * @returns {Promise<string|object>} Captcha token (or solution object for custom).
   */
  async solve({ version = 2, type = "recaptcha", enterprise = false, captchaType, timeout, task } = {}) {
    // "visa"/"login"/"general" are Nusuk captcha types — they all use reCAPTCHA
    const isRecaptcha = type === "recaptcha" || ["visa", "login", "general"].includes(type);

    if (type === "turnstile") {
      return this.solveTurnstile({ timeout });
    }

    if (type === "custom" && task) {
      return this.solveCustom(task, { timeout });
    }

    if (isRecaptcha) {
      if (version === 3) {
        return enterprise
          ? this.solveRecaptchaV3Enterprise({ timeout })
          : this.solveRecaptchaV3({ timeout });
      }
      return enterprise
        ? this.solveRecaptchaV2Enterprise({ timeout })
        : this.solveRecaptchaV2({ timeout });
    }

    throw new Error(`Unknown captcha type: ${type}`);
  }
}

/**
 * Convenience function: solve a captcha and return the token.
 * @param {object} [options] - Same as CapMonsterSolver.solve().
 * @returns {Promise<string>} Captcha token.
 */
export async function solveCaptcha(options = {}) {
  const solver = new CapMonsterSolver();
  return solver.solve(options);
}
