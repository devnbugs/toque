/**
 * Autha Worker — Automated API Test Suite
 *
 * Run after deploy: node test.js [worker-url]
 * Default URL: https://autha-worker.decloud.workers.dev
 */

const { subtle } = globalThis.crypto || require('crypto').webcrypto || require('crypto');

const WORKER_URL = process.argv[2] || 'https://autha-worker.decloud.workers.dev';
const SIGNING_SECRET = 'autha-default-secret';
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(message, secret) {
  const enc = new TextEncoder();
  const key = await subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await subtle.sign('HMAC', key, enc.encode(message));
  return toHex(sig);
}

const results = [];
let testRecordKey = null;
let testLoginCaptchaKey = null;
let testVisaCaptchaKey = null;

function pad(str, len) {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

async function test(name, fn) {
  const start = performance.now();
  try {
    await fn();
    const ms = (performance.now() - start).toFixed(0);
    results.push({ name, ok: true, ms });
    console.log(`  ✅ ${pad(name, 55)} ${ms}ms`);
  } catch (err) {
    const ms = (performance.now() - start).toFixed(0);
    results.push({ name, ok: false, ms, error: err.message });
    console.log(`  ❌ ${pad(name, 55)} ${ms}ms — ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

async function fetchJSON(path, options = {}) {
  const url = `${WORKER_URL}${path}`;
  if (VERBOSE) console.log(`     → ${options.method || 'GET'} ${url}`);
  const resp = await fetch(url, options);
  const text = await resp.text();
  if (VERBOSE) console.log(`     ← ${resp.status} ${text.slice(0, 200)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { resp, json, text };
}

async function run() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       Autha Worker — Automated API Test Suite           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Target: ${WORKER_URL}`);
  console.log('');

  // ── 1. Health Check ──────────────────────────────────────────────
  await test('GET /health — returns ok & features', async () => {
    const { resp, json } = await fetchJSON('/health');
    assert(resp.status === 200, `Expected 200, got ${resp.status}`);
    assert(json.ok === true, 'Expected ok: true');
    assert(json.features.includes('login-captcha-catcher'), 'Missing login-captcha-catcher feature');
    assert(json.features.includes('sendtoissuevisa-captcha-catcher'), 'Missing visa captcha feature');
  });

  // ── 2. CORS Preflight ───────────────────────────────────────────
  await test('OPTIONS / — CORS preflight', async () => {
    const { resp } = await fetchJSON('/', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'chrome-extension://abcdefg',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-Autha-Signature, activeentityid',
      },
    });
    assert(resp.status === 204, `Expected 204, got ${resp.status}`);
  });

  // ── 3. POST Login Captcha (Entity ID 776655) ────────────────────
  await test('POST / — store LOGIN Captcha for Entity ID 776655', async () => {
    const record = {
      action: 'LOGIN_CAPTCHA',
      source: 'LOGIN_PAGE',
      timestamp: Date.now(),
      url: 'https://masar.nusuk.sa/login',
      payload: {
        captchaToken: '03AFcWeA_LOGIN_CAPTCHA_TOKEN_123',
        nationalId: '1098765432',
      },
      entityId: '776655',
    };

    const body = JSON.stringify(record, null, 2);
    const timestamp = String(Date.now());
    const signature = await hmacSha256(`${timestamp}.${body}`, SIGNING_SECRET);

    const { resp, json } = await fetchJSON('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Autha-Timestamp': timestamp,
        'X-Autha-Signature': signature,
      },
      body,
    });

    assert(resp.status === 201, `Expected 201, got ${resp.status}`);
    assert(json.captchaType === 'LOGIN', `Expected LOGIN captchaType, got ${json.captchaType}`);
    testLoginCaptchaKey = json.key;
  });

  // ── 4. POST SendToIssueVisa Captcha (Entity ID 776655) ──────────
  await test('POST / — store SendToIssueVisa Captcha (sendCaptcha)', async () => {
    const record = {
      action: 'ISSUE_VISA_CAPTCHA',
      source: 'VISA_PAGE',
      timestamp: Date.now(),
      url: 'https://masar.nusuk.sa/sendtoissuevisa',
      payload: {
        sendCaptcha: '03AFcWeA_ISSUE_VISA_CAPTCHA_TOKEN_999',
        visaNumber: '77112233',
        bulkHtmlDump: '<html><head></head><body>' + 'x'.repeat(4000) + '</body></html>', // Test Sanitizer
      },
      entityId: '776655',
    };

    const body = JSON.stringify(record, null, 2);
    const timestamp = String(Date.now());
    const signature = await hmacSha256(`${timestamp}.${body}`, SIGNING_SECRET);

    const { resp, json } = await fetchJSON('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Autha-Timestamp': timestamp,
        'X-Autha-Signature': signature,
      },
      body,
    });

    assert(resp.status === 201, `Expected 201, got ${resp.status}`);
    assert(json.captchaType === 'SEND_ISSUE_VISA', `Expected SEND_ISSUE_VISA, got ${json.captchaType}`);
    assert(json.sanitized === true, 'Expected sanitized: true');
    testVisaCaptchaKey = json.key;
  });

  // ── 5. GET /entity/776655/captcha/login ─────────────────────────
  await test('GET /entity/776655/captcha/login — fetch Login Captcha', async () => {
    const { resp, json } = await fetchJSON('/entity/776655/captcha/login');
    assert(resp.status === 200, `Expected 200, got ${resp.status}`);
    assert(json.latestCaptcha.captchaToken.includes('LOGIN_CAPTCHA_TOKEN'), 'Login token mismatch');
  });

  // ── 6. GET /entity/776655/captcha/visa ──────────────────────────
  await test('GET /entity/776655/captcha/visa — fetch SendToIssueVisa Captcha', async () => {
    const { resp, json } = await fetchJSON('/entity/776655/captcha/visa');
    assert(resp.status === 200, `Expected 200, got ${resp.status}`);
    assert(json.latestCaptcha.captchaToken.includes('ISSUE_VISA_CAPTCHA_TOKEN'), 'Visa token mismatch');
  });

  // ── 7. GET /records/:key — Verify Sanitized & Beautified ────────
  await test('GET /records/:key — verify bulk data stripped & beautified', async () => {
    assert(testVisaCaptchaKey, 'No testVisaCaptchaKey');
    const { resp, json, text } = await fetchJSON(`/records/${testVisaCaptchaKey}`);
    assert(resp.status === 200, `Expected 200, got ${resp.status}`);
    assert(json.record.payload.bulkHtmlDump.includes('BULK_DATA_STRIPPED'), 'Bulk HTML not stripped');
    assert(text.includes('\n'), 'JSON response should be formatted with newlines');
  });

  // ── 8. Cleanup test records ─────────────────────────────────────
  await test('DELETE /records/:key — cleanup test records', async () => {
    if (testLoginCaptchaKey) {
      await fetchJSON(`/records/${testLoginCaptchaKey}`, { method: 'DELETE' });
    }
    if (testVisaCaptchaKey) {
      await fetchJSON(`/records/${testVisaCaptchaKey}`, { method: 'DELETE' });
    }
  });

  console.log('');
  console.log('─'.repeat(60));
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;
  const avgMs = (results.reduce((s, r) => s + Number(r.ms), 0) / total).toFixed(0);

  if (failed === 0) {
    console.log(`  🎉 All ${total} tests passed! (avg ${avgMs}ms)`);
  } else {
    console.log(`  ⚠️  ${passed}/${total} passed, ${failed} failed`);
    results
      .filter((r) => !r.ok)
      .forEach((r) => console.log(`     ❌ ${r.name}: ${r.error}`));
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
