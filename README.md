# toque — Nusuk Request Handler

CLI tool and Node.js module for making authenticated requests to [Masar Nusuk](https://masar.nusuk.sa) APIs via a stealth headless browser ([CloakBrowser](https://github.com/CloakHQ/CloakBrowser) — a source-level patched Chromium that passes bot detection).

## Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  Cloudflare  │────▶│  Cloudflare Worker   │────▶│  Toque Container  │
│  Container   │     │  (src/index.js)      │     │  (src/server.js)  │
│  (headless   │     │  - Workflow mgmt    │     │  - HTTP API       │
│   browser)   │     │  - Proxy to container│     │  - CLI runner     │
└──────────────┘     └─────────────────────┘     └──────────────────┘
                            │                            │
                            ▼                            ▼
                     Cloudflare Workflows          Nusuk API
                     (durable scheduling)          (masar.nusuk.sa)
```

- **Worker** (`src/index.js`) — public-facing gateway. Handles Workflow management endpoints and proxies everything else to the container.
- **Container** (`src/server.js`) — runs the headless browser and Nusuk API logic. Exposes JSON endpoints for pull, info, send, schedule, captcha, and CLI commands.
- **CLI** (`bin/nusuk.js`) — local command-line tool for the same operations.
- **Workflows** — durable scheduled visa sends that survive container sleep/restart.

## Install

Requires Node.js 20 or later.

```bash
npm install
```

## Authentication

The Worker supports two authentication methods, both built on Cloudflare's
Zero Trust / Access platform:

### 1. Cloudflare Access (browser + service tokens)

When `TEAM_DOMAIN` is set, every request must carry a valid
`Cf-Access-Jwt-Assertion` header — a signed JWT that Cloudflare Access
injects after the user authenticates. The Worker validates the JWT against
your team's public keys at `<TEAM_DOMAIN>/cdn-cgi/access/certs`.

**Setup:**

1. Create a Cloudflare Zero Trust account and note your team name
2. Create an Access application for the Worker URL
3. Set the secrets:
   ```bash
   npx wrangler secret put TEAM_DOMAIN    # https://<your-team>.cloudflareaccess.com
   npx wrangler secret put POLICY_AUD     # AUD tag from the Access app
   ```
4. Or set them as vars in `wrangler.jsonc` (non-secret values)

When `TEAM_DOMAIN` is not set, authentication is disabled (open mode).

### 2. API Key (programmatic access)

For scripts and `curl` that can't go through the browser flow, set a shared
secret and pass it in the `X-API-Key` header:

```bash
npx wrangler secret put TOQUE_API_KEY
```

```bash
curl -H "X-API-Key: your-secret-key" https://toque.decloud.workers.dev/info
```

### Public endpoints

`/health` is always public (no auth required) for uptime checks.

## Deployment

### Prerequisites

- Docker (or Colima) running locally
- `CLOUDFLARE_API_TOKEN` env var set (or `npx wrangler login`)
- `WORKER_API_TOKEN` secret set: `npx wrangler secret put WORKER_API_TOKEN`
- (Optional) `TEAM_DOMAIN`, `POLICY_AUD`, `TOQUE_API_KEY` secrets for auth
- npm dependencies installed (`npm ci`)

### Build & deploy

```bash
# Full deploy: build container image, push to Cloudflare registry, deploy Worker
npm run deploy

# Build and push only (no Worker deploy)
npm run deploy:build-only

# Local dev mode
npm run deploy:dev

# Roll back to a previous image
npm run deploy:rollback -- <image-ref>

# Manage running containers
npm run containers:list
npm run containers:images
npm run containers:ssh
```

The deploy script builds the Docker image, pushes it to Cloudflare's managed
registry, patches `wrangler.jsonc` with the new image reference, and deploys
the Worker. The CloakBrowser stealth Chromium binary is pre-downloaded during
the Docker build so the first request doesn't pay the ~200MB download cost.

## CLI Usage

Run `nusuk` with no arguments to open a guided menu. Direct commands remain
available for scripts and experienced users.

```
nusuk                                   Open the guided menu
nusuk login                             Install latest user credentials
nusuk pull                              Refresh auth, entity, and CAPTCHA
nusuk info                              Show dashboard company information
nusuk send <group-id>                   Send a visa request
nusuk request <path> [method]           Send a custom API request
nusuk api <name>                        Run a saved request from the catalog
nusuk groups list                       Show group names and IDs
nusuk schedule --target HH:MM:SS        Schedule a request
nusuk bench [count]                     Run a latency benchmark
nusuk captcha <action>                  Manage CAPTCHA
nusuk help [command]                    Show focused help
```

CAPTCHA actions are `pull`, `watch`, `start`, `status`, `stop`, `set`, `show`,
and `solve`. Run `nusuk help captcha` for their options.

### Examples

```bash
# Benchmark latency
nusuk bench 5

# Open the guided menu
nusuk

# Show dashboard company information
nusuk info

# Print only the complete formatted JSON response
nusuk info --raw-json

# Make an API request
nusuk request /umrah/reports_apis/api/Dashboard/DashboardCompanyInfo POST

# Verify the current subscription status (POST with an empty JSON body)
nusuk api verify-subscription

# Get group statistics for the active entity (POST with an empty JSON body)
nusuk api groups-statistics

# List the first 10 groups as names and IDs
nusuk groups list

# Print the complete GetGroupList JSON response
nusuk api group-list --raw-json

# List all saved requests
nusuk api list

# Schedule a request to arrive at exactly 22:00:00.500
nusuk schedule --target 22:00:00:500 \
  --path /umrah/reports_apis/api/Dashboard/GetMonthlyVisaIndicator

# Schedule with custom payload and captcha
nusuk schedule --target 22:00:00 --data '{"key":"value"}' --captcha

# Schedule a visa send using Cloudflare Workflows (durable, no blocking)
nusuk send-visa schedule 21:00:00:000 <group-id> --captcha --workflow

# Check the status of a workflow instance
nusuk workflow status <instanceId>

# Terminate a workflow instance
nusuk workflow terminate <instanceId>

# Solve and store a fresh captcha
CAPSOLVER_API_KEY=... nusuk captcha solve

# Silently refresh only VISA CAPTCHA every five seconds in the background
nusuk captcha start --type visa --interval 5s --quiet

# Use separate outputs when running different CAPTCHA types
nusuk captcha start --type login --output captcha-login.json \
  --pid-file .nusuk-captcha-login.pid --quiet

# Check or stop a background puller
nusuk captcha status
nusuk captcha stop
```

### Compatibility aliases

Older commands remain supported: `send-visa`, `captcha-set`, `captcha-show`, and
`captcha-solve`. New usage should prefer `send` and grouped `captcha` actions.
Expected input errors are concise; set `NUSUK_DEBUG=1` only when a stack trace is
needed for troubleshooting. Non-interactive executions never wait for prompts.

Running `nusuk send` without a group ID in an interactive terminal fetches the
group list and displays a numbered selector. The selected record's actual `id`
is passed to the visa payload. Scripts should continue to provide the ID
directly with `nusuk send <group-id>`.

## Adding simple requests

Named requests live in `src/requests.js`. Add one entry to `REQUESTS` and it is
automatically available through `nusuk api list` and `nusuk api <name>`:

```js
"verify-subscription": Object.freeze({
  name: "verify-subscription",
  description: "Verify the current UO subscription status",
  path: "/umrah/contracts_apis/api/UoSubscription/VerifySubscriptionStatus",
  method: "POST",
  payload: Object.freeze({}),
  captcha: false,
}),
```

Use a Nusuk path rather than an external URL. Set `captcha: true` when the
request body requires the saved `captchaToken`. The existing authenticated
browser session, entity headers, response formatting, and `--raw-json` behavior
are reused automatically.

## Scripts

```bash
node senReq.js                      # Original entry point (SendToIssueVisa POST)
node reqTook.js [--target HH:MM:SS] # Standalone benchmark/scheduler
```

## Config Files

| File | Purpose | Git |
|---|---|---|
| `auth.json` | Auth tokens (`response.data.authInfo.userToken`) | ignored |
| `entity.json` | Local entity headers (`activeEntityId`, `activeEntityTypeId`) | ignored |
| `entity.example.json` | Safe entity configuration template | tracked |
| `captcha.json` | Typed captcha tokens (`visa`, `login`, `general`) and fallback `captchaToken` | ignored |

`captcha.json` may contain typed fields for each captcha type and a generic fallback token:

```json
{
  "visa": "...",
  "login": "...",
  "general": "...",
  "captchaToken": "..."
}
```

## Environment Variables

Copy `.env.example` to `.env` and fill in local values. `.env` is ignored by
Git and loaded automatically by the CLI and standalone scripts.

| Variable | Default | Description |
|---|---|---|
| `AUTH_PATH` | `auth.json` | Path to auth file |
| `ENTITY_CONFIG_PATH` | `entity.json` | Path to entity config file |
| `ACTIVE_ENTITY_ID` | — | Overrides entity ID (auto-filled by `nusuk login`/`nusuk pull` into `entity.json`) |
| `ACTIVE_ENTITY_TYPE_ID` | — | Overrides entity type ID |
| `SYSTEM_USER_ID` | — | System user ID (auto-filled by `nusuk login`/`nusuk pull` into `entity.json`) |
| `CAPTCHA_PATH` | `captcha.json` | Path to captcha file |
| `CAPTCHA_TOKEN` | — | Captcha token value for `captcha-set` |
| `WORKER_URL` | Autha Worker URL | Worker API endpoint used by `pull` |
| `WORKER_API_TOKEN` | — | Required bearer token for Worker reads |
| `TEAM_DOMAIN` | — | Cloudflare Access team domain (e.g. `https://myteam.cloudflareaccess.com`). Set to enable JWT auth. |
| `POLICY_AUD` | — | Cloudflare Access application AUD tag (required when `TEAM_DOMAIN` is set) |
| `TOQUE_API_KEY` | — | Shared secret for `X-API-Key` header auth (programmatic access) |
| `CAPSOLVER_API_KEY` | — | CapSolver API key for `captcha-solve` |
| `CAPSOLVER_SITE_KEY` | Nusuk key | reCAPTCHA site key used when solving |
| `CAPSOLVER_PAGE_URL` | Group list | Page URL used when solving |
| `CAPSOLVER_PAGE_ACTION` | `submit` | reCAPTCHA v3 page action |
| `CAPTCHA_PULL_TYPE` | `visa` | Background pull type: `visa`, `login`, or `general` |
| `CAPTCHA_PULL_INTERVAL` | `5000` | Poll interval in milliseconds, or duration such as `5s` |
| `CAPTCHA_PULL_PID` | `.nusuk-captcha.pid` | Background puller PID metadata file |

## D1 Worker integration

`nusuk pull` uses one optimized request to
`/api/entity/{entityId}/context`. The response contains the latest auth token,
CAPTCHA variants, and automatically captured entity headers. Toque updates
`auth.json`, `captcha.json`, and `entity.json` from that response.

`nusuk login` asks for `systemUserId` when it is not supplied with
`--system-user`. It resolves that user's latest captured entity automatically,
validates the JWT, selects the requested CAPTCHA type, and updates all three
local files.

### Background CAPTCHA puller

The CAPTCHA puller supports three distinct types: `visa`, `login`, and
`general`. Type-specific pulls are strict by default, so a VISA pull never
silently stores a login CAPTCHA. Add `--fallback` to permit cross-type fallback.

`captcha watch` runs in the foreground for process supervisors. `captcha start`
launches the same watcher as a detached, silent process. It pulls immediately,
then waits for the configured interval. Repeated tokens are not rewritten, and
transient failures retry with bounded backoff. Use a separate `--output` and
`--pid-file` for each concurrently running CAPTCHA type.

## Programmatic API

```js
import { Nusuk } from "./src/nusuk.js";

const nusuk = new Nusuk()
  .loadAuth("auth.json")       // sets Authorization header
  .loadEntity()                 // reads entity.json for entity headers
  .loadCaptcha("captcha.json", "visa"); // loads typed captcha token

await nusuk.init();

const res = await nusuk.request("/api/path", {
  method: "POST",
  payload: { key: "value" },
  headers: { "X-Custom": "val" },
});

console.log(res.status, res.json);

await nusuk.close();
```

### Nusuk options

```js
new Nusuk({
  baseUrl: "https://masar.nusuk.sa",            // default
  headless: true,                                 // default
  referer: "https://masar.nusuk.sa/dashboard",    // default: dashboard/uo
  origin: "https://masar.nusuk.sa",              // default
  defaultHeaders: { "X-Custom": "val" },
});
```

## Timing & Scheduling

The scheduler uses a 4-phase approach for precise server-arrival timing:

1. **Warm-up** (2 req) — primes connection, captures real TTFB
2. **Calibration** (N req) — computes min/avg/stddev of TTFB
3. **Mid-refresh** (2 req at 60%) — adjusts for latency drift on long waits
4. **Execute** — fires at `target - (weighted_1way + jitter_buffer)`

Weighted one-way: `(min_ttfb × 0.6 + avg_ttfb × 0.4) ÷ 2`

## Project Structure

```
├── bin/nusuk.js        # CLI entry point
├── src/index.js        # Cloudflare Worker (gateway + Workflows)
├── src/server.js       # Container HTTP server (JSON API)
├── src/nusuk.js        # Nusuk class (programmatic API)
├── src/worker.js       # AuthaWorker — D1-backed auth/captcha client
├── src/captcha-puller.js # Background CAPTCHA refresher
├── src/capsolver.js    # CapSolver client
├── src/requests.js     # Named request catalog
├── src/scheduling.js   # Send-time scheduling logic
├── src/timing.js       # Request timing helpers
├── src/validation.js   # Input validation (target time, counts)
├── src/groups.js       # Group list extraction & formatting
├── src/visa-payload.js # Visa payload builder
├── src/jwt.js          # JWT parsing & validation
├── src/utils.js        # Shared utilities (JSON response, file I/O, formatting)
├── senReq.js           # Original entry point
├── reqTook.js          # Standalone benchmark/scheduler
├── Dockerfile          # Container image (Node.js + browser deps)
├── scripts/deploy.sh   # Build, push, and deploy script
├── wrangler.jsonc      # Cloudflare Worker/Container config
├── entity.json         # Entity configuration
├── package.json
└── .gitignore
```
