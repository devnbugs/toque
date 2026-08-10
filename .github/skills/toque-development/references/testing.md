# Testing Conventions

Tests use Node's built-in test runner (`node --test`). No external test
framework or assertion library beyond `node:assert/strict`.

## Running Tests

```bash
npm test                    # run all tests (node --test)
node --test test/foo.test.js   # single file
npm run check               # syntax-check all source (no execution)
```

## Test File Structure

```js
import test from "node:test";
import assert from "node:assert/strict";
import { myFunction } from "../src/myModule.js";

test("describes the expected behavior", () => {
  assert.equal(myFunction("input"), "expected");
});
```

- One test file per source module: `test/foo.test.js` for `src/foo.js`.
- Test names describe behavior, not implementation.
- Use `assert.equal`/`assert.deepEqual`/`assert.match`/`assert.throws`/`assert.rejects`.

## CLI Tests (test/cli.test.js)

Run the CLI as a subprocess in an isolated temp directory:

```js
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = resolve("bin/nusuk.js");

function run(args = [], options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    input: options.input ?? "",
  });
}

test("command works without auth in non-interactive mode", () => {
  const directory = mkdtempSync(join(tmpdir(), "toque-cli-"));
  try {
    const result = run(["my-cmd"], {
      cwd: directory,
      env: {
        AUTH_PATH: join(directory, "auth.json"),
        CAPTCHA_PATH: join(directory, "captcha.json"),
      },
    });
    assert.equal(result.status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
```

Key rules:
- Always run in a `mkdtempSync` temp directory, cleaned up in `finally`.
- Override `AUTH_PATH` and `CAPTCHA_PATH` to point inside the temp dir.
- Assert on `status`, `stdout`, and `stderr`. Errors must be concise
  (no stack traces unless `NUSUK_DEBUG=1`).

## Server Tests (test/cmd.test.js)

Spawn `src/server.js` on a random port and fetch:

```js
async function startServer(env = {}) {
  const port = 8190 + Math.floor(Math.random() * 100);
  serverProc = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
  });
  // wait for "listening on port" on stdout
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  return res.json();
}
```

- Use a random port (8190+) to avoid collisions.
- Kill the server in `finally` after each test.
- Assert on `result.ok`, `result.error`, and response shape.

## Unit Tests

Pure functions (validation, scheduling, timing, groups, jwt) are tested
directly without spawning processes. Use `mkdtempSync` for tests that write
files (e.g. `captcha-puller.test.js` writes to a temp `captcha.json`).

## Mocking

Tests mock by injecting fake objects (e.g. a fake `worker` with
`fetchLatestCaptcha` methods) rather than using a mocking framework. See
`test/worker.test.js` and `test/captcha-puller.test.js` for patterns.

## What to Test

- **Validation**: accept valid input, reject invalid input with clear errors.
- **Parsing**: edge cases, normalization, precedence rules.
- **CLI**: exit codes, stdout content, non-interactive safety, no stack traces.
- **Server**: route responses, error handling, command catalog.
- **Catalog**: entry shapes, name normalization, unknown lookups return null.
