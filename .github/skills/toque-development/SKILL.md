---
name: toque-development
description: 'Develop, test, deploy, and schedule features in the toque Nusuk request handler. Use when: adding API requests, CLI commands, or HTTP endpoints; writing or running tests; deploying the container and Worker to Cloudflare; configuring CAPTCHA pulling/solving; setting up timed visa sends or durable Workflows; debugging Nusuk API interactions; or working with the auth/captcha/entity config files.'
argument-hint: 'feature | test | deploy | schedule | captcha'
---

# Toque Development

Toque is a CLI tool and Node.js module for making authenticated requests to
Masar Nusuk APIs via a stealth headless browser. It runs as a Cloudflare
Worker (gateway) fronting a Cloudflare Container (headless browser + API
logic), with a local CLI mirroring the same operations.

## Architecture at a Glance

```
Cloudflare Worker (src/index.js)  →  Toque Container (src/server.js)  →  Nusuk API
       gateway + Workflows              HTTP API + CLI runner            masar.nusuk.sa
```

- **Worker** (`src/index.js`) — public gateway. Handles Workflow management
  endpoints directly and proxies everything else to the container.
- **Container** (`src/server.js`) — runs the headless browser and Nusuk API
  logic. Exposes JSON endpoints and a unified `/cmd` runner.
- **CLI** (`bin/nusuk.js`) — local command-line tool mirroring the same
  operations. The container's `/cmd` endpoint spawns this CLI as a subprocess.
- **Nusuk class** (`src/nusuk.js`) — programmatic API used by both the CLI
  and the container server.

## When to Use

- Adding a named API request, CLI command, or HTTP endpoint
- Writing or running tests (`node --test`)
- Building and deploying the container + Worker to Cloudflare
- Configuring CAPTCHA pulling, solving, or background refresh
- Setting up timed visa sends or durable Cloudflare Workflows
- Debugging Nusuk API interactions or auth/captcha/entity config

## Procedures

### 1. Add a Named API Request

Named requests live in `src/requests.js` as frozen entries in the `REQUESTS`
object. Each becomes available via `nusuk api list` and `nusuk api <name>`,
and through the `/api` HTTP endpoint.

1. Add an entry to `REQUESTS` in `src/requests.js`:
   ```js
   "my-request": Object.freeze({
     name: "my-request",
     description: "Short description shown in nusuk api list",
     path: "/umrah/some_apis/api/Some/Endpoint",  // same-origin Nusuk path only
     method: "POST",
     payload: Object.freeze({}),
     captcha: false,  // true to inject captchaToken automatically
   }),
   ```
2. Add a test in `test/requests.test.js` asserting the entry shape.
3. Verify: `nusuk api list` shows it; `nusuk api my-request` runs it.

See [request conventions](./references/requests.md) for path validation,
captcha injection, and `--raw-json` behavior.

### 2. Add a CLI Command

CLI commands are defined in `bin/nusuk.js`. The container's `/cmd` endpoint
spawns the CLI as a subprocess, so every CLI command is automatically
available over HTTP.

1. Add the command to the `CMD_CATALOG` in `src/server.js` with allowed args
   and a description (this powers `/cmd/list` and validation).
2. Implement the command handler in `bin/nusuk.js` following the existing
   pattern: parse args, build a `Nusuk` instance, run the operation, print
   concise output. Never print stack traces unless `NUSUK_DEBUG=1` is set.
3. Add a test in `test/cli.test.js` using `spawnSync` to run the CLI in a
   temp directory with isolated env vars.
4. If the command should run in-process on the container (safer over HTTP
   than spawning a subprocess), add a handler branch in `handleCmd` in
   `src/server.js` — see the `captcha-*` commands for the pattern.

See [CLI conventions](./references/cli.md) for arg parsing, error handling,
non-interactive mode, and the `/cmd` subprocess vs in-process decision.

### 3. Add an HTTP Endpoint

HTTP endpoints live in `src/server.js`. The Worker proxies all non-Workflow
paths to the container.

1. Write an `async function handleX(body)` in `src/server.js` following the
   existing handlers (e.g. `handleInfo`, `handleSend`). Use `withNusuk(body, ...)`
   for handlers that need an authenticated browser session.
2. Register the route in the `ROUTES` map.
3. Add documentation to the `API_DOCS` array in `src/server.js`.
4. If the endpoint should be handled by the Worker directly (e.g. Workflow
   management), add it to the router in `src/index.js` instead.
5. Add a test in `test/cmd.test.js` that starts the server on a random port
   and asserts the response shape.

See [endpoint conventions](./references/endpoints.md) for `withNusuk`,
`jsonResponse`, auth, and the Worker proxy.

### 4. Write and Run Tests

Tests use Node's built-in test runner (`node --test`). No external test
framework.

1. Add a test file in `test/` matching the source module name
   (e.g. `test/foo.test.js` for `src/foo.js`).
2. Use `import test from "node:test"` and `import assert from "node:assert/strict"`.
3. For CLI tests, use `spawnSync(process.execPath, [CLI, ...args])` in a
   `mkdtempSync` directory with isolated `AUTH_PATH`/`CAPTCHA_PATH` env vars.
4. For server tests, spawn `src/server.js` on a random port (8190+) and fetch.
5. Run all tests: `npm test` (or `node --test`).
6. Run a single file: `node --test test/requests.test.js`.
7. Syntax-check all source: `npm run check`.

See [testing conventions](./references/testing.md) for patterns, fixtures,
and isolation rules.

### 5. Build and Deploy

Deployment builds a Docker image, pushes it to Cloudflare's managed registry,
patches `wrangler.jsonc` with the new image reference, and deploys the Worker.

1. Ensure Docker is running and `CLOUDFLARE_API_TOKEN` is set (or
   `npx wrangler login` done).
2. Full deploy: `npm run deploy`
3. Build and push only (no Worker deploy): `npm run deploy:build-only`
4. Local dev mode: `npm run deploy:dev`
5. Roll back to a previous image: `npm run deploy:rollback -- <image-ref>`
6. Manage running containers: `npm run containers:list`,
   `npm run containers:images`, `npm run containers:ssh`

CI auto-deploys on push to `dev` via `.github/workflows/deploy.yml`.

See [deployment guide](./references/deploy.md) for the full pipeline,
secrets, and rollback procedure.

### 6. Configure CAPTCHA

CAPTCHA tokens are stored in `captcha.json` with typed fields (`visa`,
`login`, `general`) and a generic `captchaToken` fallback.

- **Pull** from the autha-worker: `nusuk pull` (refreshes auth, entity, and
  CAPTCHA in one request)
- **Solve** via CapSolver: `CAPSOLVER_API_KEY=... nusuk captcha solve`
- **Background refresh**: `nusuk captcha start --type visa --interval 5s`
- **Watch in foreground**: `nusuk captcha watch --type visa --interval 5s`
- **Status/stop**: `nusuk captcha status` / `nusuk captcha stop`
- **Set manually**: `nusuk captcha set <token>`
- **Show**: `nusuk captcha show`

Type-specific pulls are strict by default — a VISA pull never silently stores
a login CAPTCHA. Use `--fallback` for cross-type fallback. Use separate
`--output` and `--pid-file` for each concurrently running type.

See [CAPTCHA reference](./references/captcha.md) for the puller loop,
CapSolver integration, and in-process container management.

### 7. Schedule a Timed Visa Send

Two scheduling modes:

**In-container (blocking)** — `nusuk schedule --target HH:MM:SS[.mmm]` or
the `/schedule` endpoint. Uses a 4-phase timing approach (warm-up,
calibration, mid-refresh, execute) for precise server-arrival timing. Lost
if the container sleeps or restarts.

**Durable Workflow** — `nusuk send-visa schedule HH:MM:SS <group-id>
--workflow` or the `/schedule/workflow` endpoint. Runs in the Worker
runtime with `step.sleep()`, survives container sleep/restart, and retries
failed steps automatically.

See [scheduling reference](./references/scheduling.md) for the timing
algorithm, Workflow lifecycle, and target-time parsing.

## Config Files

| File | Purpose | Git |
|---|---|---|
| `auth.json` | Auth tokens (`response.data.authInfo.userToken`) | ignored |
| `entity.json` | Entity headers (`activeEntityId`, `activeEntityTypeId`, `systemUserId`) | ignored |
| `entity.example.json` | Safe entity config template | tracked |
| `captcha.json` | Typed captcha tokens + `captchaToken` fallback | ignored |
| `.env` | Local env vars (loaded by CLI and scripts) | ignored |

Precedence for entity config: explicit param > env var > `entity.json` file
(per field). Auth: `AUTH_TOKEN`/`NUSUK_AUTH_TOKEN` env var > `auth.json` file.

## Key Conventions

- **ES modules** — all source uses `import`/`export` (package.json `"type": "module"`).
- **No external test framework** — use `node:test` and `node:assert/strict`.
- **Frozen objects** — catalog entries use `Object.freeze()` to prevent mutation.
- **Concise errors** — user-facing errors are one line; stack traces only with `NUSUK_DEBUG=1`.
- **Non-interactive safety** — CLI commands never wait for prompts when stdin is not a TTY.
- **Atomic file writes** — `writePrivateJson()` writes to a temp file then renames, with `0600` perms.
- **Same-origin only** — `Nusuk.request()` rejects cross-origin URLs before browser evaluation.
- **Shared utilities** — `jsonResponse()`, `writePrivateJson()`, `ms()`, `formatTime()` live in `src/utils.js`.

## Quick Commands

```bash
npm test                    # run all tests
npm run check               # syntax-check all source
npm run deploy              # build + push + deploy
npm run deploy:dev          # local dev mode
npm run container           # run container server locally
nusuk                       # interactive guided menu
nusuk help [command]        # focused help
```
