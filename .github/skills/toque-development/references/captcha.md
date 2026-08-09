# CAPTCHA Reference

CAPTCHA tokens are stored in `captcha.json` with typed fields and a generic
fallback. Three types are supported: `visa`, `login`, `general`.

## captcha.json Shape

```json
{
  "visa": "...",
  "login": "...",
  "general": "...",
  "captchaToken": "...",
  "captchaType": "visa",
  "entityId": "525513",
  "updatedAt": "2026-08-08T12:00:00.000Z"
}
```

`loadCaptcha(path, type)` reads the typed field first, then falls back to
`captchaToken`, then to the other typed fields.

## Sources

### 1. Pull from autha-worker (`nusuk pull`)

`nusuk pull` makes one optimized request to
`/api/entity/{entityId}/context` on the autha-worker, which returns the
latest auth token, CAPTCHA variants, and entity headers. Toque updates
`auth.json`, `captcha.json`, and `entity.json` from that response.

Requires `WORKER_URL` and `WORKER_API_TOKEN` env vars.

### 2. Solve via CapSolver (`nusuk captcha solve`)

`src/capsolver.js` wraps the CapSolver REST API. Creates a reCAPTCHA v2 or v3
task, polls for the result, and returns the `gRecaptchaResponse` token.

```bash
CAPSOLVER_API_KEY=... nusuk captcha solve
CAPSOLVER_API_KEY=... nusuk captcha solve --v3
```

Env vars: `CAPSOLVER_API_KEY` (required), `CAPSOLVER_SITE_KEY`,
`CAPSOLVER_PAGE_URL`, `CAPSOLVER_PAGE_ACTION`.

### 3. Set manually (`nusuk captcha set <token>`)

Stores a token directly in `captcha.json`. Fails safely (exit 1) if no token
is provided — never clears an existing file.

## Background Refresh

`src/captcha-puller.js` provides a pull loop for continuous refresh:

- **`captcha watch`** — runs in the foreground (for process supervisors).
  Bounded by `--max-duration` (default 60s, max 300s).
- **`captcha start`** — launches a detached, silent background process.
  Pulls immediately, then waits for the configured interval.
- **`captcha status`** / **`captcha stop`** — check or stop the background
  refresher.

### Strict Mode

Type-specific pulls are strict by default — a VISA pull never silently
stores a login CAPTCHA. Use `--fallback` to permit cross-type fallback.

### Concurrency

Use separate `--output` and `--pid-file` for each concurrently running
CAPTCHA type:

```bash
nusuk captcha start --type visa --output captcha-visa.json --pid-file .visa.pid
nusuk captcha start --type login --output captcha-login.json --pid-file .login.pid
```

### Loop Behavior

- Pulls immediately, then waits for the interval.
- Repeated tokens are not rewritten (avoids unnecessary disk writes).
- Transient failures retry with bounded backoff.
- `runCaptchaPullLoop` accepts an `AbortController` signal for clean shutdown.

## In-Process Container Management

On the container, CAPTCHA commands run in-process (not as subprocesses) for
safety over HTTP. See `captchaTask` in `src/server.js`:

- `captchaTaskStart(options)` — starts the loop with an `AbortController`,
  tracks pulls/errors/lastResult.
- `captchaTaskStatus()` — returns running state, uptime, pull/error counts.
- `captchaTaskStop()` — aborts the controller.
- `captchaWatchBounded(options)` — bounded foreground watch with a max
  duration and results array.

## Env Vars

| Variable | Default | Description |
|---|---|---|
| `CAPTCHA_PATH` | `captcha.json` | Path to captcha file |
| `CAPTCHA_TOKEN` | — | Captcha token value for `captcha-set` |
| `CAPTCHA_PULL_TYPE` | `visa` | Background pull type |
| `CAPTCHA_PULL_INTERVAL` | `5000` | Poll interval (ms or `5s`/`1m`) |
| `CAPTCHA_PULL_PID` | `.nusuk-captcha.pid` | Background puller PID file |
| `CAPSOLVER_API_KEY` | — | CapSolver API key |
| `CAPSOLVER_SITE_KEY` | Nusuk key | reCAPTCHA site key |
| `CAPSOLVER_PAGE_URL` | Group list | Page URL for solving |
| `CAPSOLVER_PAGE_ACTION` | `submit` | reCAPTCHA v3 page action |

## Interval Parsing

`parseInterval(value, default)` accepts:
- `5000` (ms)
- `5s` (seconds)
- `1m` (minutes)
- Bounded between 1 second and 1 hour.
