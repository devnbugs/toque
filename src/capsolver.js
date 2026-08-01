/**
 * CapSolver — client for the CapSolver REST API (https://api.capsolver.com).
 *
 * Solves the Masar Nusuk reCAPTCHA and returns the token, which can be stored
 * in captcha.json for use by send-visa / request.
 *
 * Usage:
 *   const solver = new CapSolver();
 *   const token = await solver.solve({ version: 2 });
 */

const API_URL = "https://api.capsolver.com";

export class CapSolver {
  constructor(config = {}) {
    this.clientKey = config.clientKey || process.env.CAPSOLVER_API_KEY || null;
    this.siteKey =
      config.siteKey ||
      process.env.CAPSOLVER_SITE_KEY ||
      "6Le-3OwpAAAAAARztuPscqBNbpEY3okMkd7dCoyx";
    this.pageUrl =
      config.pageUrl ||
      process.env.CAPSOLVER_PAGE_URL ||
      "https://masar.nusuk.sa/umrah/mutamer-group/group-list";
  }

  async _post(path, body) {
    const resp = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => null);
    if (!json) {
      throw new Error(`CapSolver ${path} failed (${resp.status})`);
    }
    return json;
  }

  _assertKey() {
    if (!this.clientKey) {
      throw new Error("CAPSOLVER_API_KEY is required (set the env var)");
    }
  }

  async createTask({ version = 2 } = {}) {
    this._assertKey();
    const task = {
      type:
        version === 3
          ? "ReCaptchaV3TaskProxyLess"
          : "ReCaptchaV2TaskProxyLess",
      websiteURL: this.pageUrl,
      websiteKey: this.siteKey,
    };
    if (version === 3) {
      task.pageAction = process.env.CAPSOLVER_PAGE_ACTION || "submit";
    }
    const res = await this._post("/createTask", {
      clientKey: this.clientKey,
      task,
    });
    if (res.errorId !== 0) {
      throw new Error(
        `CapSolver createTask error ${res.errorId}: ${res.errorDescription || res.errorCode}`
      );
    }
    return res.taskId;
  }

  async getTaskResult(taskId) {
    return this._post("/getTaskResult", {
      clientKey: this.clientKey,
      taskId,
    });
  }

  async solve({ version = 2, interval = 3000, timeout = 120000, onStatus } = {}) {
    const taskId = await this.createTask({ version });
    const start = Date.now();

    for (;;) {
      const res = await this.getTaskResult(taskId);
      if (res.errorId !== 0) {
        throw new Error(
          `CapSolver getTaskResult error ${res.errorId}: ${res.errorDescription || res.errorCode}`
        );
      }
      if (res.status === "ready") {
        const token =
          res.solution?.gRecaptchaResponse ||
          res.solution?.gRecaptchaResponsev3 ||
          null;
        if (!token) throw new Error("CapSolver returned no gRecaptchaResponse");
        return token;
      }
      if (res.status === "failed") {
        throw new Error(`CapSolver task failed: ${res.errorDescription || "unknown"}`);
      }
      if (Date.now() - start > timeout) {
        throw new Error(`CapSolver task timed out after ${timeout}ms`);
      }
      if (onStatus) onStatus(res);
      await new Promise((r) => setTimeout(r, interval));
    }
  }
}
