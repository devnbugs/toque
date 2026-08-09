# Named API Request Conventions

Named requests live in `src/requests.js` as entries in the `REQUESTS` object.
They are exposed through the CLI (`nusuk api <name>`) and the HTTP API
(`POST /api`).

## Entry Shape

```js
"request-name": Object.freeze({
  name: "request-name",          // CLI-safe, lowercase, hyphenated
  description: "Short text",      // shown in `nusuk api list`
  path: "/umrah/.../Endpoint",   // same-origin Nusuk path only
  method: "POST",                // HTTP method
  payload: Object.freeze({}),    // default body, or omit for no body
  captcha: false,                // true to inject captchaToken automatically
}),
```

## Rules

- **Path must be same-origin.** `Nusuk.request()` rejects absolute external
  URLs. Use a Nusuk path beginning with `/umrah/`.
- **`captcha: true`** injects the saved `captchaToken` into the payload
  automatically (as `captchaToken` for catalog requests, or `recaptchaToken`
  for visa payloads via `buildVisaPayload`).
- **Frozen payloads.** Use `Object.freeze()` on the entry and its `payload`
  to prevent accidental mutation across calls.
- **Name normalization.** `getRequest()` lowercases and trims the name, so
  `VERIFY-SUBSCRIPTION` resolves to `verify-subscription`.
- **`--raw-json`** prints the complete raw JSON response instead of
  formatted/summarized output. This is handled by the CLI, not the catalog.

## Adding a Request

1. Add the entry to `REQUESTS` in `src/requests.js`.
2. Add a test in `test/requests.test.js`:
   ```js
   test("request catalog exposes my-request as POST", () => {
     const request = getRequest("my-request");
     assert.deepEqual(request, {
       name: "my-request",
       description: "...",
       path: "/umrah/...",
       method: "POST",
       payload: {},
       captcha: false,
     });
   });
   ```
3. Verify: `nusuk api list` shows it; `nusuk api my-request` runs it.

## HTTP Endpoint

`POST /api` with body `{ name: "my-request" }` runs the catalog entry via
`handleApi` in `src/server.js`. No server changes needed for new entries.
