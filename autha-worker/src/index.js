/**
 * Autha Worker — Cloudflare Workers KV REST JSON API
 *
 * Endpoints:
 *   POST   /                             — Store & sanitize signed/unsigned record
 *   GET    /records                      — List all records (paginated)
 *   GET    /records/:key                  — Get a single beautified record by key
 *   DELETE /records                      — Delete ALL records (wipe KV)
 *   DELETE /records/:key                  — Delete a single record
 *   GET    /entities                     — List all distinct Entity IDs
 *   GET    /entity/:entityId              — Query records for an Entity ID (?type=captcha|login|visa)
 *   GET    /entity/:entityId/latest       — Get latest record for an Entity ID
 *   GET    /entity/:entityId/captcha      — Get latest captured Captcha token for an Entity ID
 *   GET    /entity/:entityId/captcha/login — Get latest Login Captcha for an Entity ID
 *   GET    /entity/:entityId/captcha/visa  — Get latest SendToIssueVisa Captcha for an Entity ID
 *   GET    /entity/:entityId/captchas     — List all Captcha records for an Entity ID
 *   GET    /captchas                     — List all Captcha tokens across all entities
 *   GET    /captchas/latest              — Get globally latest captured Captcha token
 *   GET    /api/config                   — Show current working config, entity, and rest
 *   GET    /health                       — Health check
 *   GET    /stats                        — System metadata & statistics
 *
 * Features:
 *   - Automatic Captcha Categorization (LOGIN vs SEND_ISSUE_VISA / sendCaptcha)
 *   - Bulk Information Sanitization (strips bloated HTML/DOM dumps & huge headers)
 *   - Formatted Beautified JSON storage & response
 *   - systemUserId scoping for multi-user support
 */

// ─── CORS Configuration ────────────────────────────────────────────────────────

const ALLOWED_ORIGIN_PATTERNS = [
  /^chrome-extension:\/\/.+$/,
  /^moz-extension:\/\/.+$/,
  /^https:\/\/(.*\.)?nusuk\.sa$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/.*\.workers\.dev$/,
];

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Autha-Source',
  'X-Autha-Action',
  'X-Autha-Timestamp',
  'X-Autha-Signature',
  'X-Autha-Preview',
  'X-Autha-Tab-Id',
  'X-Autha-Url',
  'X-Profile-Tag',
  'X-Autha-System-User-Id',
  'activeentityid',
  'entity-id',
].join(', ');

const EXPOSED_HEADERS = [
  'X-Autha-Request-Id',
  'X-Autha-Record-Key',
  'X-Autha-Count',
  'X-Autha-Entity-Id',
].join(', ');

function isOriginAllowed(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  const allowed = isOriginAllowed(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Expose-Headers': EXPOSED_HEADERS,
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

// ─── Crypto Utilities ───────────────────────────────────────────────────────────

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(sig);
}

async function verifySignature(body, timestamp, signature, secret) {
  const expected = await hmacSha256(`${timestamp}.${body}`, secret);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Entity ID & Captcha Helpers ────────────────────────────────────────────────

function extractEntityId(record, request) {
  const fromHeader =
    request?.headers?.get('activeentityid') ||
    request?.headers?.get('entity-id');
  return (
    record?.activeEntityId ||
    record?.entityId ||
    fromHeader ||
    '525513'
  );
}

function extractCaptchaToken(record) {
  const payload = record?.payload;
  if (!payload) return null;

  if (typeof payload === 'string') {
    if (payload.length > 30 && !payload.includes('{') && !payload.includes('<')) {
      return payload;
    }
    try {
      const parsed = JSON.parse(payload);
      return parsed.captchaToken || parsed['g-recaptcha-response'] || parsed.recaptcha || parsed.sendCaptcha || null;
    } catch {
      return null;
    }
  }

  if (typeof payload === 'object') {
    return (
      payload.captchaToken ||
      payload['g-recaptcha-response'] ||
      payload.recaptcha ||
      payload.sendCaptcha ||
      (record.action === 'NUSUK_AUTHA_CAPTCHA' || record.action === 'CAPTCHA' ? payload.token : null) ||
      null
    );
  }

  return null;
}

function extractAuthToken(record) {
  if (!record || typeof record !== 'object') return null;
  const candidates = [
    record.payload?.token,
    record.payload?.authToken,
    record.payload?.userToken,
    record.headers?.request?.authorization,
    record.headers?.captured?.requestHeaders?.authorization,
    record.headers?.captured?.authorization,
    record.headers?.authorization,
    record.authHeader,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.replace(/^Bearer\s+/i, '').trim();
    }
  }
  return null;
}

function classifyCaptchaType(record, captchaToken) {
  const url = String(record?.url || record?.headers?.requestUrl || '').toLowerCase();
  const action = String(record?.action || '').toLowerCase();
  const source = String(record?.source || '').toLowerCase();
  const payloadStr = JSON.stringify(record?.payload || {}).toLowerCase();

  const isVisa =
    url.includes('issuevisa') ||
    url.includes('sendtoissuevisa') ||
    url.includes('sendvisa') ||
    url.includes('issue-visa') ||
    action.includes('visa') ||
    action.includes('sendcaptcha') ||
    source.includes('visa') ||
    source.includes('sendcaptcha') ||
    payloadStr.includes('sendcaptcha') ||
    payloadStr.includes('issuevisa');

  if (isVisa) return 'SEND_ISSUE_VISA';

  const isLogin =
    url.includes('login') ||
    url.includes('authenticat') ||
    url.includes('signin') ||
    action.includes('login') ||
    source.includes('login') ||
    payloadStr.includes('nationalid') ||
    payloadStr.includes('passportnumber') ||
    payloadStr.includes('username');

  if (isLogin) return 'LOGIN';

  return 'GENERAL';
}

function isCaptchaRecord(record) {
  const action = String(record?.action || '').toUpperCase();
  const source = String(record?.source || '').toUpperCase();
  return (
    action.includes('CAPTCHA') ||
    source.includes('CAPTCHA') ||
    Boolean(extractCaptchaToken(record))
  );
}

function sanitizeRecord(record) {
  const sanitized = { ...record };

  if (typeof sanitized.payload === 'string') {
    if (sanitized.payload.includes('<html') || sanitized.payload.includes('<!DOCTYPE')) {
      sanitized.payload = '[HTML_DOCUMENT_STRIPPED]';
    } else if (sanitized.payload.length > 3000) {
      sanitized.payload = sanitized.payload.slice(0, 3000) + '... [TRUNCATED]';
    }
  } else if (typeof sanitized.payload === 'object' && sanitized.payload !== null) {
    const cleanPayload = {};
    for (const [key, val] of Object.entries(sanitized.payload)) {
      if (typeof val === 'string' && (val.includes('<html') || val.length > 3000)) {
        cleanPayload[key] = val.slice(0, 500) + '... [BULK_DATA_STRIPPED]';
      } else {
        cleanPayload[key] = val;
      }
    }
    sanitized.payload = cleanPayload;
  }

  if (sanitized.headers && typeof sanitized.headers === 'object') {
    const keepKeys = [
      'authorization', 'x-auth-token', 'content-type', 'activeentityid',
      'entity-id', 'x-profile-tag', 'user-agent', 'x-autha-preview'
    ];
    const cleanReq = {};
    const req = sanitized.headers.request || sanitized.headers;
    if (typeof req === 'object' && req !== null) {
      for (const [k, v] of Object.entries(req)) {
        if (keepKeys.includes(k.toLowerCase())) cleanReq[k] = v;
      }
    }
    sanitized.headers = {
      captured: sanitized.headers.captured || cleanReq,
      request: cleanReq,
    };
  }

  return sanitized;
}

function generateKey(record, entityId) {
  const ts = record.timestamp || Date.now();
  const action = (record.action || 'UNKNOWN').toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8);
  return `entity_${entityId}_${action}_${ts}_${rand}`;
}

function parseUrl(url) {
  const u = new URL(url);
  const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  return { pathname: u.pathname, parts, searchParams: u.searchParams };
}

function sanitizeSystemUserId(value) {
  const v = String(value || '').trim();
  if (!v) return 'default';
  return v.replace(/[^a-zA-Z0-9_-]/g, '');
}

function snippetKeyPrefix(systemUserId) {
  const uid = sanitizeSystemUserId(systemUserId);
  return uid === 'default' ? '' : `u_${uid}_`;
}

function matchesSystemUser(metadata, systemUserId) {
  const uid = sanitizeSystemUserId(systemUserId);
  const recUid = metadata && metadata.systemUserId;
  if (!recUid) return uid === 'default';
  return recUid === uid;
}

const DEFAULT_SIGNING_SECRET = 'autha-default-secret';

function getSigningSecret(env) {
  return env.AUTHA_SIGNING_SECRET || DEFAULT_SIGNING_SECRET;
}

// ─── Request Handlers ───────────────────────────────────────────────────────────

async function handlePost(request, env) {
  const rawBody = await request.text();
  if (!rawBody) {
    return jsonResponse({ ok: false, error: 'Empty body' }, 400);
  }

  const timestamp = request.headers.get('X-Autha-Timestamp') || '';
  const signature = request.headers.get('X-Autha-Signature') || '';
  const signingSecret = getSigningSecret(env);

  if (timestamp && signature) {
    const age = Math.abs(Date.now() - Number(timestamp));
    if (age > 5 * 60 * 1000) {
      return jsonResponse({ ok: false, error: 'Timestamp too old' }, 401);
    }
    const valid = await verifySignature(rawBody, timestamp, signature, signingSecret);
    if (!valid) {
      return jsonResponse({ ok: false, error: 'Invalid signature' }, 401);
    }
  }

  let rawRecord;
  try {
    rawRecord = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const entityId = extractEntityId(rawRecord, request);
  rawRecord.entityId = entityId;
  rawRecord.activeEntityId = entityId;
  const systemUserId = sanitizeSystemUserId(request.headers.get('X-Autha-System-User-Id'));
  rawRecord.systemUserId = systemUserId;

  const cleanRecord = sanitizeRecord(rawRecord);

  const key = generateKey(cleanRecord, entityId);
  const isCaptcha = isCaptchaRecord(cleanRecord);
  const captchaToken = extractCaptchaToken(cleanRecord);
  const captchaType = isCaptcha || captchaToken ? classifyCaptchaType(cleanRecord, captchaToken) : null;

  if (captchaType) {
    cleanRecord.captchaType = captchaType;
    cleanRecord.captchaToken = captchaToken;
  }

  const beautifiedBody = JSON.stringify(cleanRecord, null, 2);

  await env.AUTHA_KV.put(key, beautifiedBody, {
    expirationTtl: 30 * 24 * 60 * 60,
    metadata: {
      action: cleanRecord.action || 'UNKNOWN',
      source: cleanRecord.source || 'UNKNOWN',
      timestamp: cleanRecord.timestamp || Date.now(),
      entityId,
      profileTag: cleanRecord.profileTag || 'default',
      systemUserId,
      isCaptcha,
      captchaType,
      captchaToken: captchaToken ? `${captchaToken.slice(0, 20)}...` : null,
      authPreview: cleanRecord.authPreview || null,
    },
  });

  if (isCaptcha || captchaToken) {
    const captchaSnippet = {
      entityId,
      captchaType,
      captchaToken,
      timestamp: cleanRecord.timestamp || Date.now(),
      action: cleanRecord.action,
      source: cleanRecord.source,
      url: cleanRecord.url || null,
      key,
      systemUserId,
    };

    const snippetStr = JSON.stringify(captchaSnippet, null, 2);
    const sp = snippetKeyPrefix(systemUserId);

    if (captchaType === 'LOGIN') {
      await env.AUTHA_KV.put(`latest_captcha_login_${sp}${entityId}`, snippetStr, { expirationTtl: 30 * 24 * 60 * 60 });
    } else if (captchaType === 'SEND_ISSUE_VISA') {
      await env.AUTHA_KV.put(`latest_captcha_visa_${sp}${entityId}`, snippetStr, { expirationTtl: 30 * 24 * 60 * 60 });
    }

    await env.AUTHA_KV.put(`latest_captcha_${sp}${entityId}`, snippetStr, { expirationTtl: 30 * 24 * 60 * 60 });
    await env.AUTHA_KV.put(`latest_captcha_global_${sp}`, snippetStr, { expirationTtl: 30 * 24 * 60 * 60 });
  }

  await env.AUTHA_KV.put(
    `latest_entity_${snippetKeyPrefix(systemUserId)}${entityId}`,
    JSON.stringify(
      {
        entityId,
        key,
        action: cleanRecord.action,
        source: cleanRecord.source,
        timestamp: cleanRecord.timestamp || Date.now(),
        url: cleanRecord.url || null,
        isCaptcha,
        captchaType,
        systemUserId,
      },
      null,
      2
    ),
    { expirationTtl: 30 * 24 * 60 * 60 }
  );

  const statsRaw = await env.AUTHA_KV.get('__stats__');
  const stats = statsRaw ? JSON.parse(statsRaw) : { totalRecords: 0, entities: [], lastUpdated: 0 };
  stats.totalRecords += 1;
  stats.lastUpdated = Date.now();
  if (!Array.isArray(stats.entities)) stats.entities = [];
  if (!stats.entities.includes(entityId)) stats.entities.push(entityId);
  await env.AUTHA_KV.put('__stats__', JSON.stringify(stats, null, 2));

  return jsonResponse(
    {
      ok: true,
      key,
      entityId,
      systemUserId,
      action: cleanRecord.action,
      source: cleanRecord.source,
      timestamp: cleanRecord.timestamp,
      isCaptcha,
      captchaType,
      hasCaptchaToken: Boolean(captchaToken),
      sanitized: true,
      message: 'Record sanitized, formatted & saved successfully',
    },
    201,
    {
      'X-Autha-Record-Key': key,
      'X-Autha-Entity-Id': entityId,
      'X-Autha-System-User-Id': systemUserId,
    }
  );
}

async function handleGetRecords(request, env) {
  const { searchParams } = parseUrl(request.url);
  const prefix = searchParams.get('prefix') || '';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 1000);
  const cursor = searchParams.get('cursor') || undefined;
  const systemUserId = sanitizeSystemUserId(searchParams.get('systemUserId'));

  const list = await env.AUTHA_KV.list({
    prefix: prefix || undefined,
    limit,
    cursor,
  });

  const keys = list.keys.filter(
    (k) => !k.name.startsWith('__') && !k.name.startsWith('latest_') && matchesSystemUser(k.metadata, systemUserId)
  );

  return jsonResponse(
    {
      ok: true,
      systemUserId,
      records: keys.map((k) => ({
        key: k.name,
        metadata: k.metadata || {},
        expiration: k.expiration || null,
      })),
      count: keys.length,
      cursor: list.list_complete ? null : list.cursor,
      complete: list.list_complete,
    },
    200,
    { 'X-Autha-Count': String(keys.length) }
  );
}

async function handleGetRecord(key, env) {
  if (key.startsWith('__')) {
    return jsonResponse({ ok: false, error: 'Reserved key' }, 403);
  }

  const { value, metadata } = await env.AUTHA_KV.getWithMetadata(key);
  if (value === null) {
    return jsonResponse({ ok: false, error: 'Record not found' }, 404);
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }

  return jsonResponse({
    ok: true,
    key,
    metadata: metadata || {},
    record: parsed,
  });
}

async function handleDeleteRecord(key, env) {
  if (key.startsWith('__')) {
    return jsonResponse({ ok: false, error: 'Cannot delete reserved key' }, 403);
  }

  const existing = await env.AUTHA_KV.get(key);
  if (existing === null) {
    return jsonResponse({ ok: false, error: 'Record not found' }, 404);
  }

  await env.AUTHA_KV.delete(key);

  const statsRaw = await env.AUTHA_KV.get('__stats__');
  if (statsRaw) {
    const stats = JSON.parse(statsRaw);
    stats.totalRecords = Math.max(0, (stats.totalRecords || 0) - 1);
    stats.lastUpdated = Date.now();
    await env.AUTHA_KV.put('__stats__', JSON.stringify(stats, null, 2));
  }

  return jsonResponse({ ok: true, key, message: 'Record deleted' });
}

// ─── Entity & Captcha Categorization Query Handlers ─────────────────────────────

async function handleListEntities(env) {
  const statsRaw = await env.AUTHA_KV.get('__stats__');
  const stats = statsRaw ? JSON.parse(statsRaw) : {};
  let entities = stats.entities || [];

  if (!entities.length) {
    const list = await env.AUTHA_KV.list({ prefix: 'entity_' });
    const entitySet = new Set();
    list.keys.forEach((k) => {
      const parts = k.name.split('_');
      if (parts.length >= 2) entitySet.add(parts[1]);
    });
    entities = Array.from(entitySet);
  }

  return jsonResponse({
    ok: true,
    entities,
    count: entities.length,
  });
}

async function handleGetEntityRecords(entityId, request, env) {
  const { searchParams } = parseUrl(request.url);
  const actionFilter = searchParams.get('action') || searchParams.get('type') || null;
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 1000);
  const cursor = searchParams.get('cursor') || undefined;
  const systemUserId = sanitizeSystemUserId(searchParams.get('systemUserId'));

  const prefix = `entity_${entityId}_`;
  const list = await env.AUTHA_KV.list({ prefix, limit, cursor });

  let keys = list.keys;
  if (actionFilter) {
    const filterUpper = actionFilter.toUpperCase();
    keys = keys.filter(
      (k) => (k.metadata?.action || '').toUpperCase().includes(filterUpper) ||
             (k.metadata?.captchaType || '').toUpperCase().includes(filterUpper)
    );
  }
  keys = keys.filter((k) => matchesSystemUser(k.metadata, systemUserId));

  return jsonResponse({
    ok: true,
    entityId,
    systemUserId,
    actionFilter: actionFilter || null,
    records: keys.map((k) => ({
      key: k.name,
      metadata: k.metadata || {},
    })),
    count: keys.length,
    cursor: list.list_complete ? null : list.cursor,
  });
}

async function handleGetEntityLatest(entityId, env, systemUserId) {
  const sp = snippetKeyPrefix(systemUserId);
  const latestSnippet = await env.AUTHA_KV.get(`latest_entity_${sp}${entityId}`);
  if (latestSnippet) {
    try {
      const snippet = JSON.parse(latestSnippet);
      const fullRecord = await env.AUTHA_KV.get(snippet.key);
      return jsonResponse({
        ok: true,
        entityId,
        systemUserId: sanitizeSystemUserId(systemUserId),
        snippet,
        record: fullRecord ? JSON.parse(fullRecord) : null,
      });
    } catch { /* fall through to list scan */ }
  }

  const list = await env.AUTHA_KV.list({ prefix: `entity_${entityId}_`, limit: 10 });
  if (!list.keys.length) {
    return jsonResponse({ ok: false, error: `No records found for entityId ${entityId}` }, 404);
  }

  const scoped = list.keys.filter((k) => matchesSystemUser(k.metadata, systemUserId));
  if (!scoped.length) {
    return jsonResponse({ ok: false, error: `No records found for entityId ${entityId}` }, 404);
  }

  const latestKey = scoped[scoped.length - 1].name;
  const recordVal = await env.AUTHA_KV.get(latestKey);
  return jsonResponse({
    ok: true,
    entityId,
    systemUserId: sanitizeSystemUserId(systemUserId),
    key: latestKey,
    record: recordVal ? JSON.parse(recordVal) : null,
  });
}

async function handleGetEntityCaptcha(entityId, subType, env, systemUserId) {
  const sp = snippetKeyPrefix(systemUserId);
  let keyName = `latest_captcha_${sp}${entityId}`;
  if (subType === 'login') keyName = `latest_captcha_login_${sp}${entityId}`;
  if (subType === 'visa' || subType === 'sendcaptcha') keyName = `latest_captcha_visa_${sp}${entityId}`;

  const captchaVal = await env.AUTHA_KV.get(keyName);
  if (!captchaVal) {
    if (subType) {
      const fallbackVal = await env.AUTHA_KV.get(`latest_captcha_${sp}${entityId}`);
      if (fallbackVal) {
        return jsonResponse({
          ok: true,
          entityId,
          systemUserId: sanitizeSystemUserId(systemUserId),
          subTypeRequested: subType,
          fallbackGeneralCaptcha: JSON.parse(fallbackVal),
        });
      }
    }
    return jsonResponse({ ok: false, error: `No ${subType || ''} captcha token captured for entityId ${entityId}` }, 404);
  }

  return jsonResponse({
    ok: true,
    entityId,
    systemUserId: sanitizeSystemUserId(systemUserId),
    captchaType: subType ? subType.toUpperCase() : 'LATEST',
    latestCaptcha: JSON.parse(captchaVal),
  });
}

async function handleGetEntityAuthToken(entityId, env, systemUserId) {
  const sp = snippetKeyPrefix(systemUserId);
  const keyName = `latest_auth_token_${sp}${entityId}`;
  const { value, metadata } = await env.AUTHA_KV.getWithMetadata(keyName);
  if (value === null) {
    return jsonResponse({ ok: false, error: `No auth token captured for entityId ${entityId}` }, 404);
  }

  let snippet;
  try {
    snippet = JSON.parse(value);
  } catch {
    snippet = null;
  }
  if (!snippet || !snippet.token) {
    return jsonResponse({ ok: false, error: `No auth token captured for entityId ${entityId}` }, 404);
  }

  return jsonResponse({
    ok: true,
    entityId,
    systemUserId: sanitizeSystemUserId(systemUserId),
    key: keyName,
    metadata: metadata || {},
    latestAuthToken: snippet,
  });
}

async function handleGetEntityCaptchas(entityId, env, systemUserId) {
  const list = await env.AUTHA_KV.list({ prefix: `entity_${entityId}_` });
  const captchaKeys = list.keys.filter(
    (k) => (k.metadata?.isCaptcha || k.name.includes('_CAPTCHA_')) && matchesSystemUser(k.metadata, systemUserId)
  );

  return jsonResponse({
    ok: true,
    entityId,
    systemUserId: sanitizeSystemUserId(systemUserId),
    captchas: captchaKeys.map((k) => ({
      key: k.name,
      metadata: k.metadata || {},
    })),
    count: captchaKeys.length,
  });
}

async function handleGetAllCaptchas(env, systemUserId) {
  const list = await env.AUTHA_KV.list({ limit: 100 });
  const captchas = list.keys.filter(
    (k) => (k.metadata?.isCaptcha || k.name.includes('_CAPTCHA_')) && matchesSystemUser(k.metadata, systemUserId)
  );

  return jsonResponse({
    ok: true,
    systemUserId: sanitizeSystemUserId(systemUserId),
    captchas: captchas.map((k) => ({
      key: k.name,
      metadata: k.metadata || {},
    })),
    count: captchas.length,
  });
}

async function handleGetGlobalLatestCaptcha(env, systemUserId) {
  const sp = snippetKeyPrefix(systemUserId);
  const captchaVal = await env.AUTHA_KV.get(`latest_captcha_global_${sp}`);
  if (!captchaVal) {
    return jsonResponse({ ok: false, error: 'No global captcha tokens captured yet' }, 404);
  }
  return jsonResponse({
    ok: true,
    systemUserId: sanitizeSystemUserId(systemUserId),
    latestCaptcha: JSON.parse(captchaVal),
  });
}

// ─── Health, Stats & Config ─────────────────────────────────────────────────────

async function handleHealth() {
  return jsonResponse({
    ok: true,
    service: 'autha-worker',
    version: '1.3.0',
    timestamp: Date.now(),
    features: [
      'login-captcha-catcher',
      'sendtoissuevisa-captcha-catcher',
      'bulk-data-sanitizer',
      'beautified-json-storage',
      'entity-categorization',
      'rest-api',
    ],
  });
}

async function handleStats(env) {
  const statsRaw = await env.AUTHA_KV.get('__stats__');
  const stats = statsRaw
    ? JSON.parse(statsRaw)
    : { totalRecords: 0, entities: [], lastUpdated: 0 };

  return jsonResponse({
    ok: true,
    ...stats,
    entityCount: (stats.entities || []).length,
    lastUpdatedISO: stats.lastUpdated
      ? new Date(stats.lastUpdated).toISOString()
      : null,
  });
}

async function handleConfig(request, env) {
  const { searchParams } = parseUrl(request.url);
  const systemUserId = sanitizeSystemUserId(searchParams.get('systemUserId'));

  const statsRaw = await env.AUTHA_KV.get('__stats__');
  const stats = statsRaw ? JSON.parse(statsRaw) : { totalRecords: 0, entities: [], lastUpdated: 0 };

  const sp = snippetKeyPrefix(systemUserId);
  const entityId = searchParams.get('entityId') || '';
  const latestEntity = entityId ? await env.AUTHA_KV.get(`latest_entity_${sp}${entityId}`) : null;
  const latestCaptcha = entityId ? await env.AUTHA_KV.get(`latest_captcha_${sp}${entityId}`) : null;
  const latestAuth = entityId ? await env.AUTHA_KV.get(`latest_auth_token_${sp}${entityId}`) : null;
  const latestGlobalCaptcha = await env.AUTHA_KV.get(`latest_captcha_global_${sp}`);

  return jsonResponse({
    ok: true,
    systemUserId,
    config: {
      workerKvEndpoint: 'https://autha-worker.decloud.workers.dev/',
      signingSecret: getSigningSecret(env),
      captchaTtlSeconds: Math.max(30, Number(env.AUTHA_CAPTCHA_TTL_SECONDS) || 120),
      storage: 'kv',
    },
    entity: latestEntity ? JSON.parse(latestEntity) : null,
    latestCaptcha: latestCaptcha ? JSON.parse(latestCaptcha) : null,
    latestAuthToken: latestAuth ? JSON.parse(latestAuth) : null,
    globalLatestCaptcha: latestGlobalCaptcha ? JSON.parse(latestGlobalCaptcha) : null,
    stats: {
      totalRecords: stats.totalRecords || 0,
      entities: stats.entities || [],
      lastUpdated: stats.lastUpdated || 0,
    },
  });
}

// ─── Main Router ────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const addCors = (response) => {
      const newHeaders = new Headers(response.headers);
      for (const [k, v] of Object.entries(cors)) {
        newHeaders.set(k, v);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    };

    try {
      const { parts, searchParams } = parseUrl(request.url);
      const method = request.method.toUpperCase();
      const systemUserId = sanitizeSystemUserId(searchParams.get('systemUserId'));

      let response;

      if (method === 'POST' && parts.length === 0) {
        response = await handlePost(request, env);
      } else if (method === 'GET' && parts[0] === 'health') {
        response = await handleHealth();
      } else if (method === 'GET' && parts[0] === 'api' && parts[1] === 'config' && parts.length === 2) {
        response = await handleConfig(request, env);
      } else if (method === 'GET' && parts[0] === 'stats') {
        response = await handleStats(env);
      } else if (method === 'GET' && parts[0] === 'entities' && parts.length === 1) {
        response = await handleListEntities(env);
      } else if (method === 'GET' && parts[0] === 'captchas' && parts[1] === 'latest') {
        response = await handleGetGlobalLatestCaptcha(env, systemUserId);
      } else if (method === 'GET' && parts[0] === 'captchas' && parts.length === 1) {
        response = await handleGetAllCaptchas(env, systemUserId);
      } else if (method === 'GET' && parts[0] === 'entity' && parts.length === 4 && parts[2] === 'captcha' && parts[3] === 'login') {
        response = await handleGetEntityCaptcha(parts[1], 'login', env, systemUserId);
      } else if (method === 'GET' && parts[0] === 'entity' && parts.length === 4 && parts[2] === 'token' && parts[3] === 'latest') {
        response = await handleGetEntityAuthToken(parts[1], env, systemUserId);
      } else if (method === 'GET' && parts[0] === 'entity' && parts.length === 4 && parts[2] === 'captcha' && (parts[3] === 'visa' || parts[3] === 'sendcaptcha')) {
        response = await handleGetEntityCaptcha(parts[1], 'visa', env, systemUserId);
      } else if (method === 'GET' && parts[0] === 'entity' && parts.length === 3 && parts[2] === 'captcha') {
        response = await handleGetEntityCaptcha(parts[1], null, env, systemUserId);
      } else if (method === 'GET' && parts[0] === 'entity' && parts.length === 3 && parts[2] === 'captchas') {
        response = await handleGetEntityCaptchas(parts[1], env, systemUserId);
      } else if (method === 'GET' && parts[0] === 'entity' && parts.length === 3 && parts[2] === 'latest') {
        response = await handleGetEntityLatest(parts[1], env, systemUserId);
      } else if (method === 'GET' && parts[0] === 'entity' && parts.length === 2) {
        response = await handleGetEntityRecords(parts[1], request, env);
      } else if (method === 'GET' && parts[0] === 'records' && parts.length === 1) {
        response = await handleGetRecords(request, env);
      } else if (method === 'GET' && parts[0] === 'records' && parts.length >= 2) {
        const key = parts.slice(1).join('/');
        response = await handleGetRecord(key, env);
      } else if (method === 'DELETE' && parts[0] === 'records' && parts.length === 1) {
        response = await handleDeleteAll(env);
      } else if (method === 'DELETE' && parts[0] === 'records' && parts.length >= 2) {
        const key = parts.slice(1).join('/');
        response = await handleDeleteRecord(key, env);
      } else {
        response = jsonResponse(
          {
            ok: false,
            error: 'Not found',
            hint: 'Available routes: POST /, GET /records, DELETE /records, GET /entities, GET /entity/:id, GET /entity/:id/latest, GET /entity/:id/captcha, GET /entity/:id/captcha/login, GET /entity/:id/captcha/visa, GET /entity/:id/token/latest, GET /entity/:id/captchas, GET /captchas, GET /captchas/latest, GET /api/config, GET /health, GET /stats',
          },
          404
        );
      }

      return addCors(response);
    } catch (err) {
      const errResponse = jsonResponse(
        { ok: false, error: 'Internal server error', message: err.message },
        500
      );
      return addCors(errResponse);
    }
  },
};