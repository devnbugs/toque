import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CLI = resolve("bin/nusuk.js");

function run(args = [], options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    input: options.input ?? "",
  });
}

function runWithMissingAuth(args = [], overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "toque-cli-no-auth-"));
  try {
    return run(args, {
      cwd: directory,
      env: {
        AUTH_PATH: join(directory, "auth.json"),
        CAPTCHA_PATH: join(directory, "captcha.json"),
        ...overrides,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("no command is safe in non-interactive mode and prints concise help", () => {
  const result = run();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Toque — Nusuk command line/);
  assert.doesNotMatch(result.stderr, /Unknown command/);
});

test("general and CAPTCHA help use focused modern output", () => {
  const general = run(["help"]);
  const captcha = run(["help", "captcha"]);
  const inline = run(["captcha", "--help"]);
  assert.equal(general.status, 0);
  assert.match(general.stdout, /Common tasks:/);
  assert.equal(captcha.status, 0);
  assert.match(captcha.stdout, /Usage: nusuk captcha/);
  assert.equal(inline.status, 0);
  assert.match(inline.stdout, /Actions:/);
});

test("unknown commands and invalid input omit stack traces", () => {
  const result = run(["unknown-command"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command/);
  assert.doesNotMatch(result.stderr, /at main|bin\/nusuk\.js:\d+/);
});

test("grouped CAPTCHA set and show work without exposing the token in status output", () => {
  const directory = mkdtempSync(join(tmpdir(), "toque-cli-"));
  const captchaPath = join(directory, "captcha.json");
  try {
    const set = run(["captcha", "set", "test-token"], {
      cwd: directory,
      env: { CAPTCHA_PATH: captchaPath },
    });
    assert.equal(set.status, 0);
    assert.match(set.stdout, /updated/);
    const show = run(["captcha", "show"], {
      cwd: directory,
      env: { CAPTCHA_PATH: captchaPath },
    });
    assert.equal(show.status, 0);
    assert.equal(show.stdout.trim(), "test-token");
    assert.equal(JSON.parse(readFileSync(captchaPath, "utf8")).captchaToken, "test-token");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CAPTCHA set without a token fails safely instead of clearing the file", () => {
  const directory = mkdtempSync(join(tmpdir(), "toque-cli-"));
  const captchaPath = join(directory, "captcha.json");
  try {
    const initial = run(["captcha", "set", "keep-me"], {
      cwd: directory,
      env: { CAPTCHA_PATH: captchaPath, CAPTCHA_TOKEN: "" },
    });
    assert.equal(initial.status, 0);
    const missing = run(["captcha", "set"], {
      cwd: directory,
      env: { CAPTCHA_PATH: captchaPath, CAPTCHA_TOKEN: "" },
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /CAPTCHA token is required/);
    assert.equal(JSON.parse(readFileSync(captchaPath, "utf8")).captchaToken, "keep-me");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy CAPTCHA aliases remain supported", () => {
  const directory = mkdtempSync(join(tmpdir(), "toque-cli-"));
  try {
    const result = run(["captcha-set"], {
      cwd: directory,
      env: { CAPTCHA_PATH: join(directory, "captcha.json"), CAPTCHA_TOKEN: "legacy" },
    });
    assert.equal(result.status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("API catalog lists subscription verification", () => {
  const result = run(["api", "list"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /verify-subscription\s+POST/);
  assert.match(result.stdout, /groups-statistics\s+POST/);
  assert.match(result.stdout, /group-list\s+POST/);
  assert.match(result.stdout, /company-info\s+POST/);
  assert.match(result.stdout, /Verify the current UO subscription status/);
});

test("unknown named requests fail concisely without network access", () => {
  const result = run(["api", "missing-request"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown request: missing-request/);
  assert.doesNotMatch(result.stderr, /at main|bin\/nusuk\.js:\d+/);
});

test("send without a group ID fails safely outside an interactive terminal", () => {
  const result = run(["send"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Group ID is required in non-interactive mode/);
  assert.doesNotMatch(result.stderr, /at main|bin\/nusuk\.js:\d+/);
});

test("group pagination input is validated before network access", () => {
  const invalidLimit = run(["groups", "list", "--limit", "0"]);
  const invalidOffset = run(["groups", "list", "--offset", "-1"]);
  assert.equal(invalidLimit.status, 1);
  assert.match(invalidLimit.stderr, /limit must be an integer from 1 to 100/i);
  assert.equal(invalidOffset.status, 1);
  assert.match(invalidOffset.stderr, /offset must be a non-negative integer/i);
});

test("send-visa help is available and focused", () => {
  const result = run(["send-visa", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: nusuk send-visa <group-id>/);
  assert.match(result.stdout, /--data '{"key":"value"}'/);
});

test("send-visa parses data and captcha flags without crashing before auth", () => {
  const result = runWithMissingAuth(["send-visa", "12345", "--data", '{"foo":"bar"}', "--captcha", "--captcha-type", "visa", "--no-test"], {
    ACTIVE_ENTITY_ID: "123",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No auth token found|auth file missing/);
});

test("init creates git ignored local config files", () => {
  const directory = mkdtempSync(join(tmpdir(), "toque-cli-init-"));
  try {
    const result = run(["init"], { cwd: directory });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Created auth\.json/);
    assert.match(result.stdout, /Created captcha\.json/);
    assert.match(result.stdout, /Created entity\.json/);
    assert.match(result.stdout, /Created \.env/);
    assert.equal(true, existsSync(join(directory, "auth.json")));
    assert.equal(true, existsSync(join(directory, "captcha.json")));
    assert.equal(true, existsSync(join(directory, "entity.json")));
    assert.equal(true, existsSync(join(directory, ".env")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schedule parses data and captcha flags without crashing before auth", () => {
  const result = runWithMissingAuth(["schedule", "--target", "12:00:00", "--data", '{"foo":"bar"}', "--captcha", "--captcha-type", "visa", "--count", "1"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No auth token found|auth file missing/);
});

test("general help exposes the dedicated company info command", () => {
  const result = run(["help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\s*info\s+Show dashboard company information/m);
});

test("sync-time help is available and focused", () => {
  const result = run(["sync-time", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: nusuk sync-time/);
  assert.match(result.stdout, /--dry-run/);
});

test("sync-time dry-run can use a local time source file", () => {
  const directory = mkdtempSync(join(tmpdir(), "toque-cli-"));
  const sourceFile = join(directory, "time.json");
  try {
    writeFileSync(sourceFile, JSON.stringify({ utc_datetime: "2026-08-02T12:34:56.789Z" }), "utf8");
    const result = run(["sync-time", "--dry-run", "--source", pathToFileURL(sourceFile).href], {
      cwd: directory,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Network time: 2026-08-02T12:34:56\.789Z/);
    assert.match(result.stdout, /Dry run complete\. No system clock changes were made\./);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
