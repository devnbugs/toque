# CLI Conventions

The CLI lives in `bin/nusuk.js`. The container's `/cmd` endpoint spawns it as
a subprocess, so every CLI command is automatically available over HTTP.

## Structure

- `bin/nusuk.js` — entry point, command dispatch, arg parsing
- Imports from `src/` for reusable logic (`Nusuk`, `AuthaWorker`, `CapSolver`,
  validation, scheduling, groups, captcha-puller, requests)

## Arg Parsing

The CLI uses a simple manual arg parser. Common patterns:

```js
const dataIdx = args.indexOf("--data");
const dataStr = dataIdx !== -1 ? args[dataIdx + 1] : null;
```

For flags with values, use `getArg(argv, flag)` (defined in `src/server.js`
for the `/cmd` handler; the CLI has its own inline equivalents).

## Error Handling

- **Concise errors.** User-facing errors are one line. Never print stack
  traces unless `NUSUK_DEBUG=1` is set.
- **Non-interactive safety.** `canPrompt()` returns true only when stdin and
  stdout are TTYs. Commands never wait for prompts when non-interactive.
- **Exit codes.** `0` for success, `1` for errors. Use `process.exit(1)`
  after printing a concise error to stderr.

## Adding a Command

1. **Register in `CMD_CATALOG`** (`src/server.js`) with allowed args and a
   description. This powers `/cmd/list` and validates the command name.
   ```js
   "my-cmd": { args: ["--flag"], description: "Do something" },
   ```
2. **Implement the handler** in `bin/nusuk.js`:
   - Parse args
   - Build a `Nusuk` instance (`new Nusuk().loadAuth().loadEntity().loadCaptcha()`)
   - Run the operation
   - Print concise output
3. **Add a test** in `test/cli.test.js` using `spawnSync` in a temp dir with
   isolated env vars.
4. **In-process vs subprocess** — if the command should run in-process on
   the container (safer over HTTP than spawning a subprocess, e.g. long-running
   background tasks), add a handler branch in `handleCmd` in `src/server.js`.
   See the `captcha-watch`/`captcha-start`/`captcha-status`/`captcha-stop`
   commands for the pattern.

## Compatibility Aliases

Older command names remain supported as aliases (e.g. `send-visa` → `send`,
`captcha-set`, `captcha-show`, `captcha-solve`). New usage should prefer the
grouped commands (`send`, `captcha <action>`).

## Guided Menu

Running `nusuk` with no arguments opens an interactive guided menu (only
when interactive). In non-interactive mode, it prints concise help and exits 0.
