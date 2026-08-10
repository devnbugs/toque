/**
 * CapSolver — uses the official @captcha-libs/capsolver SDK for fast,
 * concurrent captcha solving on the Masar Nusuk platform.
 *
 * Supports:
 *   - reCAPTCHA v2 (ReCaptchaV2TaskProxyLess)
 *   - reCAPTCHA v2 Enterprise (ReCaptchaV2EnterpriseTaskProxyLess)
 *   - reCAPTCHA v3 (ReCaptchaV3TaskProxyLess)
 *   - reCAPTCHA v3 Enterprise (ReCaptchaV3EnterpriseTaskProxyLess)
 *   - Cloudflare Turnstile (AntiTurnstileTaskProxyLess)
 *
 * The SDK handles task creation, polling, and result retrieval internally,
 * eliminating the manual polling loop from the previous REST API approach.
 *
 * Usage:
 *   const solver = new CapSolver();
 *   const token = await solver.solve({ version: 2 });
 *
 * Environment variables:
 *   CAPSOLVER_API_KEY    — CapSolver API key (required)
 *   CAPSOLVER_SITE_KEY   — reCAPTCHA site key (default: Nusuk's key)
 *   CAPSOLVER_PAGE_URL   — page URL where the captcha appears
 *   CAPSOLVER_PAGE_ACTION — page action for reCAPTCHA v3 (default: "submit")
 *   CAPSOLVER_MIN_SCORE  — minimum score for v3 (default: 0.7)
 */

import {
  CapSolver as CapSolverClient,
  ReCaptchaV2TaskProxyLess,
  ReCaptchaV2EnterpriseTaskProxyLess,
  ReCaptchaV3TaskProxyLess,
  ReCaptchaV3EnterpriseTaskProxyLess,
  AntiTurnstileTaskProxyLess,
} from "@captcha-libs/capsolver";

const DEFAULT_SITE_KEY = "6Le-3OwpAAAAAARztuPscqBNbpEY3okMkd7dCoyx";
const DEFAULT_PAGE_URL = "https://masar.nusuk.sa/umrah/mutamer-group/group-list";
const DEFAULT_PAGE_ACTION = "submit";
const DEFAULT_MIN_SCORE = 0.7;

export class CapSolver {
  /**
   * @param {object} [config]
   * @param {string} [config.clientKey] — CapSolver API key.
   * @param {string} [config.siteKey] — Captcha site key.
   * @param {string} [config.pageUrl] — Page URL where captcha appears.
   * @param {string} [config.pageAction] — Page action for reCAPTCHA v3.
   * @param {number} [config.minScore] — Minimum score for v3 (0.1–0.9).
   * @param {number} [config.pollingInterval] — Poll interval in ms (default: 2000).
   * @param {number} [config.timeout] — Solve timeout in ms (default: 180000).
   */
  constructor(config = {}) {
    this.clientKey = config.clientKey || process.env.CAPSOLVER_API_KEY || null;
    this.siteKey = config.siteKey || process.env.CAPSOLVER_SITE_KEY || DEFAULT_SITE_KEY;
    this.pageUrl = config.pageUrl || process.env.CAPSOLVER_PAGE_URL || DEFAULT_PAGE_URL;
    this.pageAction = config.pageAction || process.env.CAPSOLVER_PAGE_ACTION || DEFAULT_PAGE_ACTION;
    this.minScore = config.minScore ?? (process.env.CAPSOLVER_MIN_SCORE ? Number(process.env.CAPSOLVER_MIN_SCORE) : DEFAULT_MIN_SCORE);
    this.pollingInterval = config.pollingInterval ?? 2000;
    this.timeout = config.timeout ?? 180000;
    this._client = null;
  }

  _assertKey() {
    if (!this.clientKey) {
      throw new Error("CAPSOLVER_API_KEY is required (set the env var or pass clientKey in config)");
    }
  }

  /**
   * Lazily create the CapSolver SDK client singleton.
   * @returns {CapSolverClient}
   */
  getClient() {
    this._assertKey();
    if (!this._client) {
      this._client = new CapSolverClient({
        clientKey: this.clientKey,
        pollingInterval: this.pollingInterval,
        timeout: this.timeout,
      });
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
   * @returns {Promise<string>} gRecaptchaResponse token.
   */
  async solveRecaptchaV2(options = {}) {
    const client = this.getClient();
    const task = new ReCaptchaV2TaskProxyLess({
      websiteURL: options.websiteURL || this.pageUrl,
      websiteKey: options.websiteKey || this.siteKey,
      isInvisible: options.isInvisible || false,
    });
    const result = await client.solve(task);
    const token = result.solution?.gRecaptchaResponse;
    if (!token) {
      throw new Error("CapSolver returned no gRecaptchaResponse for reCAPTCHA v2");
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
    const task = new ReCaptchaV2EnterpriseTaskProxyLess({
      websiteURL: options.websiteURL || this.pageUrl,
      websiteKey: options.websiteKey || this.siteKey,
      isInvisible: options.isInvisible || false,
    });
    const result = await client.solve(task);
    const token = result.solution?.gRecaptchaResponse;
    if (!token) {
      throw new Error("CapSolver returned no gRecaptchaResponse for reCAPTCHA v2 Enterprise");
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
   * @param {number} [options.minScore] - Minimum score (0.1–0.9).
   * @returns {Promise<string>} gRecaptchaResponse token.
   */
  async solveRecaptchaV3(options = {}) {
    const client = this.getClient();
    const task = new ReCaptchaV3TaskProxyLess({
      websiteURL: options.websiteURL || this.pageUrl,
      websiteKey: options.websiteKey || this.siteKey,
      pageAction: options.pageAction || this.pageAction,
      minScore: options.minScore ?? this.minScore,
    });
    const result = await client.solve(task);
    const token = result.solution?.gRecaptchaResponse;
    if (!token) {
      throw new Error("CapSolver returned no gRecaptchaResponse for reCAPTCHA v3");
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
    const task = new ReCaptchaV3EnterpriseTaskProxyLess({
      websiteURL: options.websiteURL || this.pageUrl,
      websiteKey: options.websiteKey || this.siteKey,
      pageAction: options.pageAction || this.pageAction,
      minScore: options.minScore ?? this.minScore,
    });
    const result = await client.solve(task);
    const token = result.solution?.gRecaptchaResponse;
    if (!token) {
      throw new Error("CapSolver returned no gRecaptchaResponse for reCAPTCHA v3 Enterprise");
    }
    return token;
  }

  // ─── Cloudflare Turnstile ───────────────────────────────────────────

  /**
   * Solve Cloudflare Turnstile.
   * @param {object} [options]
   * @param {string} [options.websiteURL] - Override page URL.
   * @param {string} [options.websiteKey] - Turnstile site key.
   * @returns {Promise<string>} Turnstile token.
   */
  async solveTurnstile(options = {}) {
    const client = this.getClient();
    const task = new AntiTurnstileTaskProxyLess({
      websiteURL: options.websiteURL || this.pageUrl,
      websiteKey: options.websiteKey || this.siteKey,
    });
    const result = await client.solve(task);
    const token = result.solution?.token || result.solution?.gRecaptchaResponse;
    if (!token) {
      throw new Error("CapSolver returned no token for Turnstile");
    }
    return token;
  }

  // ─── Unified solve ──────────────────────────────────────────────────

  /**
   * Unified solve method — dispatches to the right solver based on type/version.
   *
   * @param {object} [options]
   * @param {number} [options.version=2] - reCAPTCHA version (2 or 3).
   * @param {string} [options.type="recaptcha"] - Captcha type: "recaptcha", "turnstile".
   * @param {boolean} [options.enterprise] - Use Enterprise variant.
   * @param {string} [options.captchaType] - Nusuk captcha type for compat ("visa", "login", "general").
   * @param {number} [options.timeout] - Solve timeout in ms.
   * @returns {Promise<string>} Captcha token.
   */
  async solve({ version = 2, type = "recaptcha", enterprise = false, captchaType, timeout } = {}) {
    // "visa"/"login"/"general" are Nusuk captcha types — they all use reCAPTCHA
    const isRecaptcha = type === "recaptcha" || ["visa", "login", "general"].includes(type);

    if (type === "turnstile") {
      return this.solveTurnstile({ timeout });
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
