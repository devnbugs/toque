/**
 * Nusuk instance pool — keeps warmed browser instances alive across requests.
 *
 * Creating a new Chromium instance per request costs 300-800ms. This pool
 * maintains initialized Nusuk objects that have already navigated to the
 * Nusuk origin, so each request only pays the actual network latency.
 *
 * Usage:
 *   const pool = getNusukPool();
 *   const result = await pool.withNusuk(body, async (nusuk) => {
 *     return nusuk.request("/umrah/...", { method: "POST", payload });
 *   });
 */

import { Nusuk } from "./nusuk.js";
import { log } from "./log.js";

const DEFAULT_MIN_POOL_SIZE = 1;
const DEFAULT_MAX_POOL_SIZE = 3;
const WARM_IDLE_MS = 30_000;
const IDLE_CLOSE_MS = 120_000;

class NusukPool {
  constructor(options = {}) {
    this.minSize = options.minSize || DEFAULT_MIN_POOL_SIZE;
    this.maxSize = options.maxSize || DEFAULT_MAX_POOL_SIZE;
    this.warmIdleMs = options.warmIdleMs || WARM_IDLE_MS;
    this.idleCloseMs = options.idleCloseMs || IDLE_CLOSE_MS;
    this.baseUrl = options.baseUrl || process.env.NUSUK_BASE_URL || "https://masar.nusuk.sa";
    this.origin = options.origin || process.env.NUSUK_ORIGIN;
    this.referer = options.referer || process.env.NUSUK_REFERER;
    this.browserOptions = options.browserOptions || {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--single-process",
      ],
    };

    this.available = [];
    this.inUse = new Set();
    this.warming = new Set();
    this.closed = false;
    this.idleTimer = null;
    this.ensureMinInstances();
  }

  ensureMinInstances() {
    const needed = this.minSize - (this.available.length + this.inUse.size + this.warming.size);
    if (needed > 0) {
      for (let i = 0; i < needed; i++) {
        this.warmOne().catch(() => {});
      }
    }
  }

  async warmOne() {
    if (this.closed) return null;
    const nusuk = new Nusuk({
      baseUrl: this.baseUrl,
      origin: this.origin,
      referer: this.referer,
      browserOptions: this.browserOptions,
    });
    const promise = nusuk.init().then(async () => {
      // Navigate to the origin and fire a HEAD request so the browser has an
      // active connection, TLS session, and keep-alive socket ready.
      await nusuk.warm();
      return nusuk;
    });
    this.warming.add(promise);
    try {
      await promise;
      if (!this.closed) {
        this.available.push(nusuk);
        log.info("nusuk.pool.warm", "Warmed Nusuk instance", {
          available: this.available.length,
          inUse: this.inUse.size,
        });
      } else {
        await nusuk.close();
      }
      return nusuk;
    } catch (err) {
      log.error("nusuk.pool.warm.error", "Failed to warm Nusuk instance", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this.warming.delete(promise);
    }
  }

  async warm(count = this.minSize) {
    const target = Math.max(1, Math.min(this.maxSize, Number(count) || this.minSize));
    const needed = Math.max(0, target - (this.available.length + this.inUse.size + this.warming.size));
    const promises = [];
    for (let i = 0; i < needed; i++) {
      promises.push(this.warmOne().catch(() => null));
    }
    await Promise.all(promises);
    return this.available.length + this.inUse.size;
  }

  async acquire() {
    if (this.closed) throw new Error("Nusuk pool is closed");

    // Return an already-warmed instance immediately
    if (this.available.length > 0) {
      const nusuk = this.available.shift();
      this.inUse.add(nusuk);
      this.ensureMinInstances();
      return nusuk;
    }

    // If we're below max size, warm a new one and return it
    const total = this.available.length + this.inUse.size + this.warming.size;
    if (total < this.maxSize) {
      const nusuk = await this.warmOne();
      if (nusuk) {
        // warmOne() pushes to available; move it to inUse
        const idx = this.available.indexOf(nusuk);
        if (idx !== -1) this.available.splice(idx, 1);
        this.inUse.add(nusuk);
        this.ensureMinInstances();
        return nusuk;
      }
    }

    // Wait for an instance to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for Nusuk instance from pool"));
      }, 30000);
      const check = () => {
        if (this.closed) {
          clearTimeout(timeout);
          reject(new Error("Nusuk pool is closed"));
          return;
        }
        if (this.available.length > 0) {
          clearTimeout(timeout);
          const nusuk = this.available.shift();
          this.inUse.add(nusuk);
          resolve(nusuk);
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });
  }

  release(nusuk) {
    this.inUse.delete(nusuk);
    if (this.closed) {
      nusuk.close().catch(() => {});
      return;
    }
    // Keep the page warm by re-walking the origin if it drifted
    nusuk.warm().catch(() => {});
    this.available.push(nusuk);
    this.ensureMinInstances();
    this.scheduleIdleCleanup();
  }

  scheduleIdleCleanup() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.cleanupIdle(), this.idleCloseMs);
  }

  cleanupIdle() {
    if (this.closed) return;
    // Close excess instances above minSize that have been idle too long
    while (this.available.length > this.minSize) {
      const nusuk = this.available.pop();
      nusuk.close().catch(() => {});
    }
    this.ensureMinInstances();
  }

  async withNusuk(body, callback) {
    if (typeof body === "function") {
      callback = body;
      body = {};
    }
    const nusuk = await this.acquire();
    try {
      // Apply per-request configuration without re-initializing the browser
      const skipAuth = body.skipAuth === true;
      const authToken = body.authToken || process.env.AUTH_TOKEN || process.env.NUSUK_AUTH_TOKEN;
      if (authToken) {
        nusuk.setAuthToken(authToken);
      } else if (!skipAuth) {
        nusuk.loadAuth();
      }

      nusuk.loadEntity({
        activeEntityId: body.activeEntityId || process.env.ACTIVE_ENTITY_ID,
        activeEntityTypeId: body.activeEntityTypeId || process.env.ACTIVE_ENTITY_TYPE_ID,
      });

      const skipCaptcha = body.skipCaptcha === true;
      const captchaType = body.captchaType || process.env.CAPTCHA_TYPE || "visa";
      const captchaToken = body.captchaToken || process.env.CAPTCHA_TOKEN;
      if (captchaToken) {
        nusuk.captchaToken = captchaToken;
      } else if (!skipCaptcha) {
        nusuk.loadCaptcha(undefined, captchaType);
      }

      return await callback(nusuk);
    } finally {
      this.release(nusuk);
    }
  }

  async close() {
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await Promise.all([
      ...this.available.map((n) => n.close().catch(() => {})),
      ...[...this.inUse].map((n) => n.close().catch(() => {})),
    ]);
    this.available = [];
    this.inUse.clear();
  }

  status() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      warming: this.warming.size,
      minSize: this.minSize,
      maxSize: this.maxSize,
    };
  }
}

let globalPool = null;
let globalPoolKey = "";

function poolKey(options) {
  return JSON.stringify({
    baseUrl: options.baseUrl || process.env.NUSUK_BASE_URL,
    origin: options.origin || process.env.NUSUK_ORIGIN,
    referer: options.referer || process.env.NUSUK_REFERER,
  });
}

export function getNusukPool(options = {}) {
  const key = poolKey(options);
  if (!globalPool || globalPoolKey !== key) {
    if (globalPool) {
      globalPool.close().catch(() => {});
    }
    globalPool = new NusukPool(options);
    globalPoolKey = key;
  }
  return globalPool;
}

export function resetNusukPool() {
  if (globalPool) {
    globalPool.close().catch(() => {});
    globalPool = null;
    globalPoolKey = "";
  }
}
