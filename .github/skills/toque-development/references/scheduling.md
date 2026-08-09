# Scheduling Reference

Two scheduling modes for timed visa sends: in-container (blocking) and
durable Cloudflare Workflows.

## Target Time Parsing

`parseTargetTime(value, now)` in `src/validation.js` accepts:
- `HH:MM:SS` — hours, minutes, seconds
- `HH:MM:SS.mmm` or `HH:MM:SS:mmm` — with milliseconds
- Rejects out-of-range values (hours > 23, minutes > 59, seconds > 59)
- Rejects times already elapsed today (returns `null`)
- Normalizes fractional ms: `.5` → `500`, `.05` → `50`

The Worker's `parseTargetTime` (in `src/index.js`) accepts the same formats
plus ISO strings, and rolls over to the next day if the time has passed.

## In-Container Scheduling (Blocking)

`nusuk schedule --target HH:MM:SS[.mmm]` or `POST /schedule`.

Uses a 4-phase approach for precise server-arrival timing:

1. **Warm-up** (2 req) — primes the connection, captures real TTFB
2. **Calibration** (N req) — computes min/avg/stddev of TTFB
3. **Mid-refresh** (2 req at 60%) — adjusts for latency drift on long waits
4. **Execute** — fires at `target - (weighted_1way + jitter_buffer)`

### Weighted One-Way Latency

```
oneWayMs = (min_ttfb × 0.6 + avg_ttfb × 0.4) ÷ 2
sendAheadMs = oneWayMs + jitterBufferMs + clientOverheadMs
sendAt = targetTime - sendAheadMs
```

Defaults: `jitterBufferMs = 40`, `clientOverheadMs = 80`.

`computeSendSchedule(targetTime, samples, options)` in `src/scheduling.js`
returns `{ targetTime, oneWayMs, jitterBufferMs, clientOverheadMs,
sendAheadMs, sendAt, serverArrivalMs }`.

### Limitation

Lost if the container sleeps or restarts. For durability, use Workflows.

## Durable Cloudflare Workflows

`VisaScheduleWorkflow` in `src/index.js` runs in the Worker runtime with
durable execution. Survives Worker restarts, container sleep/wake cycles,
and automatically retries failed steps.

### Create an Instance

```bash
nusuk send-visa schedule 21:00:00:000 <group-id> --captcha --workflow
```

Or via HTTP:

```bash
curl -X POST https://toque.vortex.name.ng/schedule/workflow \
  -H "Content-Type: application/json" \
  -d '{"targetTime": "21:00:00:000", "groupId": "12345", "captcha": true}'
```

Body fields:
- `targetTime` (required) — ISO string or `HH:MM:SS[.mmm]`
- `groupId` (required) — group ID
- `captcha` (optional, default `true`) — inject captchaToken
- `captchaType` (optional, default `visa`) — `visa`|`login`|`general`
- `payload` (optional) — custom visa payload
- `pullBefore` (optional, default `true`) — pull fresh creds before send

### Workflow Steps

1. **Pull fresh credentials** (if `pullBefore`) — calls the container's
   `/pull` endpoint with `{ refresh: true }`.
2. **Durable sleep** — `step.sleep("wait until target time", "<N> seconds")`.
   Uses a relative duration string to avoid `sleepUntil` serialization issues
   with Date objects.
3. **Send visa request** — calls the container's `/send` endpoint with
   retries: `{ limit: 3, delay: "5 seconds", backoff: "exponential" }`.

### Manage Instances

```bash
# Check status
nusuk workflow status <instanceId>
curl 'https://toque.vortex.name.ng/schedule/workflow/status?instanceId=abc-123'

# Terminate
nusuk workflow terminate <instanceId>
curl -X POST https://toque.vortex.name.ng/schedule/workflow/terminate \
  -H "Content-Type: application/json" -d '{"instanceId": "abc-123"}'
```

### Why step.sleep (not sleepUntil)

The Workflow uses `step.sleep` with a relative duration string
(`"<N> seconds"`) rather than `step.sleepUntil` with a Date, because Date
objects can have serialization issues in Workflow steps. The wait duration is
computed as `Math.max(0, Math.ceil((targetMs - Date.now()) / 1000))`.

## Timing Helpers

`src/timing.js` provides `summarizeRequestTiming({ sendAt,
responseReceivedAt, response })` which surfaces the response `Date` header
and computes `elapsedMs`. Used by the CLI's `bench` command and request
handlers that return `timing` in their response.
