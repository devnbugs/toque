# AGENTS.md

Toque is a CLI + Node.js module for authenticated requests to Masar Nusuk
(`masar.nusuk.sa`) APIs via a stealth headless browser (CloakBrowser). It runs
as a Cloudflare Worker gateway fronting a Cloudflare Container that runs the
browser, with a local CLI mirroring the same operations.

**Read first:** [`.github/skills/toque-development/SKILL.md`](./.github/skills/toque-development/SKILL.md)
for step-by-step procedures (add a request, CLI command, endpoint, test,
deploy, schedule, configure CAPTCHA) and linked references. The
[README](./README.md) has full CLI usage, env vars, and config-file docs.

## Architecture

```
Cloudflare Worker (src/index.js) → Toque Container (src/server.js) → Nusuk API
   gateway + Workflows + auth          HTTP API + CLI runner + browser
```

- **Worker** (`src/index.js`) — public gateway. Auth (Cloudflare Access JWT or
  `X-API-Key`), Workflow management endpoints, proxies everything else to the
  container via `env.TOQUE_CONTAINER.getByName("toque").fetch()`.
- **Container** (`src/server.js`) — Node `http` server on port 8080. Runs the
  browser, exposes JSON endpoints, and a unified `/cmd` runner that spawns
  `bin/nusuk.js` as a subprocess.
- **CLI** (`bin/nusuk.js`) — local tool; every command is also available over
  HTTP via `/cmd`.
- **Nusuk class** (`src/nusuk.js`) — programmatic API; all requests go through
  `page.evaluate()` so they inherit the browser's cookies/fingerprint/TLS.

## Build, Test, Check

```bash
npm test                 # node --test — runs all test/*.test.js
node --test test/foo.test.js   # single file
npm run check            # node --check on bin, src, and root scripts
npm run deploy           # build image, push to CF registry, patch wrangler.jsonc, deploy
npm run deploy:dev       # wrangler dev
npm run deploy:build-only
npm run deploy:rollback -- <image-ref>
```

CI auto-deploys on push to `dev` via `.github/workflows/deploy.yml`.

## Conventions (must follow)

- **ES modules only** — `package.json` has `"type": "module"`. Use `import`/`export`.
- **Tests: `node:test` only** — never add Jest/Vitest/Mocha. Use flat top-level
  `test()` calls (no `describe`/`it`). Import `node:test` and `node:assert/strict`.
- **Mock the browser, never launch it** — in tests, replace `nusuk.page` with a
  stub `{ url: () => string, evaluate: async () => result }`. Don't call `nusuk.init()`.
- **Mock AuthaWorker** by replacing `worker.fetchContext` or passing a fake
  `worker` object with `async fetchLatestCaptcha(...)`.
- **Temp files in tests** — `mkdtempSync(join(tmpdir(), "toque-<prefix>-"))`
  and `rmSync(dir, { recursive: true, force: true })` in `finally`.
- **Frozen catalog entries** — `Object.freeze()` request entries (and their
  payloads) in `src/requests.js`.
- **Concise user errors** — one line; stack traces only when `NUSUK_DEBUG=1`.
  CLI commands must never wait for prompts when stdin is not a TTY.
- **Same-origin only** — `Nusuk.request()` rejects cross-origin URLs.
- **Structured logs** — `JSON.stringify({ message, ... })`, never plain strings
  (Worker/container).
- **Atomic file writes** — `writePrivateJson()` in `src/utils.js` writes to a
  temp file then renames with `0600` perms. Use it for `auth.json`/`captcha.json`/`entity.json`.
- **Shared utils** — `jsonResponse()`, `writePrivateJson()`, `ms()`,
  `formatTime()` live in `src/utils.js`; reuse rather than re-implementing.

## Gotchas

- **`wrangler.jsonc` is JSONC with comments** — `scripts/deploy.sh` has a
  custom patcher that strips `//` and `/* */` comments and trailing commas
  before writing the image ref. If you add a comment-only line that leaves a
  trailing comma, the patcher must handle it (it does via
  `replace(/,(\s*[\]}])/g, "$1")`). Don't switch the file to plain JSON.
- **Cache-busting is essential for benchmarks** — `Nusuk.request()` needs
  `cacheBust: true` or repeated requests hit browser cache (`ttfb=0ms`).
- **Browser deps differ by Ubuntu** — `setup.sh` and the Dockerfile install
  Chromium libs; Ubuntu 24.04 uses the `t64` suffix (`libasound2t64`). Fonts
  are required for canvas emoji rendering used in anti-bot detection.
- **`cloakbrowser install` in Docker** — pre-downloads ~200MB Chromium at
  build time; `|| true` so the build survives if the download is unavailable.
- **Worker (`src/index.js`) has no direct test file** — it's exercised
  indirectly through the modules it delegates to. Add logic to tested modules
  where possible.
- **Config file precedence** — explicit param > env var > file, per field.
  `auth.json`, `entity.json`, `captcha.json`, `.env` are gitignored;
  `entity.example.json` is the tracked template.

## Config & Env

See the README's [Environment Variables](./README.md#environment-variables)
table. Key secrets for the Worker: `TEAM_DOMAIN`, `POLICY_AUD` (Cloudflare
Access JWT auth), `TOQUE_API_KEY` (`X-API-Key` fallback), `WORKER_API_TOKEN`.
When `TEAM_DOMAIN` is unset, auth is disabled (open mode) — only `/health` is
always public.

## Adding Things

Follow the procedures in the [skill](./.github/skills/toque-development/SKILL.md):
- [Named API request](./.github/skills/toque-development/SKILL.md#1-add-a-named-api-request)
  → `src/requests.js`
- [CLI command](./.github/skills/toque-development/SKILL.md#2-add-a-cli-command)
  → `bin/nusuk.js` + `CMD_CATALOG` in `src/server.js`
- [HTTP endpoint](./.github/skills/toque-development/SKILL.md#3-add-an-http-endpoint)
  → `src/server.js` (`ROUTES` map) or `src/index.js` for Worker-handled paths

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
