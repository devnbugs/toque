# HTTP Endpoint Conventions

HTTP endpoints live in `src/server.js`. The Worker (`src/index.js`) handles
Workflow management directly and proxies all other paths to the container.

## Adding an Endpoint

1. **Write a handler** in `src/server.js`:
   ```js
   async function handleX(body) {
     // validate body
     // use withNusuk(body, async (nusuk) => { ... }) for browser-backed calls
     return { ok: true, data: result };
   }
   ```
2. **Register the route** in the `ROUTES` map:
   ```js
   const ROUTES = {
     // ...existing routes...
     "/my-endpoint": handleX,
   };
   ```
3. **Document it** in the `API_DOCS` array (method, path, description, body,
   example, response).
4. **Add a test** in `test/cmd.test.js` that starts the server on a random
   port and asserts the response shape.

## withNusuk

For handlers that need an authenticated browser session:

```js
async function handleX(body) {
  return withNusuk(body, async (nusuk) => {
    const res = await nusuk.request("/umrah/path", {
      method: "POST",
      payload: { ... },
    });
    return { ok: res.ok, status: res.status, data: res.json, timing: res.timing };
  });
}
```

`withNusuk` builds a `Nusuk` instance from `buildNusuk(body)` (which reads env
vars and body overrides), calls `init()`, runs the callback, and always calls
`close()` in a `finally` block.

## buildNusuk

`buildNusuk(body)` constructs a `Nusuk` instance with:
- `baseUrl` from `body.baseUrl` or `NUSUK_BASE_URL`
- Auth token from `body.authToken` or `AUTH_TOKEN`/`NUSUK_AUTH_TOKEN`, else `loadAuth()`
- Entity from `body.activeEntityId`/`body.activeEntityTypeId` or env, else `loadEntity()`
- Captcha from `body.captchaToken` or `CAPTCHA_TOKEN`, else `loadCaptcha()`

## jsonResponse

`jsonResponse(res, status, body, req)` writes JSON to the Node http server
response. If the request `Accept` header includes `text/html`, it returns a
styled syntax-highlighted HTML page instead. The same helper works in the
Worker context (pass a number status and Request).

## Auth (Worker)

The Worker (`src/index.js`) validates requests via:
1. **Cloudflare Access JWT** (`Cf-Access-Jwt-Assertion` header) — verified
   against the team's JWKS when `TEAM_DOMAIN` is set.
2. **API key** (`X-API-Key` header) — matches `TOQUE_API_KEY` secret.
3. **Open mode** — when `TEAM_DOMAIN` is unset, auth is disabled.

`/health` is always public. All other paths require auth when configured.

## /cmd Endpoint

`POST /cmd` runs any CLI command as a subprocess (or in-process for captcha
commands). Body: `{ command, args }` or `{ argv: [...] }`. See
`/cmd/list` for the catalog. Timeout defaults to 30s, max 300s.

## Worker vs Container Routing

- **Worker handles directly**: `/schedule/workflow`, `/schedule/workflow/status`,
  `/schedule/workflow/terminate`, `/.well-known/oauth-authorization-server`
- **Container handles** (proxied by Worker): `/pull`, `/info`, `/send`, `/api`,
  `/api-list`, `/request`, `/groups`, `/captcha/solve`, `/schedule`, `/cmd`,
  `/cmd/list`, `/health`, `/help`
