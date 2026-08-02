# toque — Nusuk Request Handler

CLI tool and Node.js module for making authenticated requests to [Masar Nusuk](https://masar.nusuk.sa) APIs via a stealth headless browser (CloakBrowser).

## Install

```bash
npm install
```

## CLI Usage

```
nusuk bench [count]                     Run latency benchmark
nusuk request <path> [method]           Send a request (POST defaults to {})
       [--data '{"key":"val"}']
       [--captcha]
nusuk schedule --target HH:MM:SS        Schedule request for server arrival
       [--path /api/path]
       [--method GET]
       [--data '{"key":"val"}']
       [--captcha]
       [--count 5]
nusuk captcha-set                       Set captcha token (via CAPTCHA_TOKEN env)
nusuk captcha-show                      Show stored captcha token
nusuk pull --entity <id>                Pull auth, CAPTCHA, and entity context from D1
nusuk login                             Ask for system user ID and install latest D1 context
```

### Examples

```bash
# Benchmark latency
nusuk bench 5

# Make an API request
nusuk request /umrah/reports_apis/api/Dashboard/DashboardCompanyInfo POST

# Schedule a request to arrive at exactly 22:00:00.500
nusuk schedule --target 22:00:00:500 \
  --path /umrah/reports_apis/api/Dashboard/GetMonthlyVisaIndicator

# Schedule with custom payload and captcha
nusuk schedule --target 22:00:00 --data '{"key":"value"}' --captcha
```

## Scripts

```bash
node senReq.js                      # Original entry point (SendToIssueVisa POST)
node reqTook.js [--target HH:MM:SS] # Standalone benchmark/scheduler
```

## Config Files

| File | Purpose | Git |
|---|---|---|
| `creds.json` | Merged creds file (auth + captcha together) | ignored |
| `auth.json` | Auth tokens (`response.data.authInfo.userToken`) — fallback if not in `creds.json` | ignored |
| `entity.json` | Entity headers (`activeEntityId`, `activeEntityTypeId`) | tracked |
| `captcha.json` | Captcha token (`captchaToken`) — fallback if not in `creds.json` | ignored |

`creds.json` combines both auth and captcha in one file:

```json
{
  "captchaToken": "...",
  "response": {
    "data": {
      "authInfo": {
        "userToken": "..."
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CREDS_PATH` | `creds.json` | Path to shared creds file (checked first) |
| `AUTH_PATH` | `auth.json` | Path to auth file (fallback) |
| `ENTITY_CONFIG_PATH` | `entity.json` | Path to entity config file |
| `ACTIVE_ENTITY_ID` | — | Overrides entity ID (takes priority over file) |
| `ACTIVE_ENTITY_TYPE_ID` | — | Overrides entity type ID |
| `CAPTCHA_PATH` | `captcha.json` | Path to captcha file (fallback) |
| `CAPTCHA_TOKEN` | — | Captcha token value for `captcha-set` |
| `WORKER_URL` | Autha Worker URL | Worker API endpoint used by `pull` |
| `WORKER_API_TOKEN` | — | Required bearer token for Worker reads |

## D1 Worker integration

`nusuk pull` uses one optimized request to
`/api/entity/{entityId}/context`. The response contains the latest auth token,
CAPTCHA variants, and automatically captured entity headers. Toque updates
`auth.json`, `captcha.json`, and `entity.json` from that response.

`nusuk login` asks for `systemUserId` when it is not supplied with
`--system-user`. It resolves that user's latest captured entity automatically,
validates the JWT, selects the requested CAPTCHA type, and updates all three
local files.

## Programmatic API

```js
import { Nusuk } from "./src/nusuk.js";

const nusuk = new Nusuk()
  .loadAuth("auth.json")       // sets Authorization header (falls back to creds.json)
  .loadEntity()                 // reads entity.json for entity headers
  .loadCaptcha("captcha.json"); // stores captchaToken (falls back to creds.json)

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
├── src/nusuk.js        # Nusuk class (programmatic API)
├── senReq.js           # Original entry point
├── reqTook.js          # Standalone benchmark/scheduler
├── creds.json          # Shared auth + captcha credentials (gitignored)
├── entity.json         # Entity configuration
├── package.json
└── .gitignore
```
