/**
 * Toque API Client — aligned to the Toque `dev` backend HTTP surface.
 *
 * Worker (toque.decloud.workers.dev): GET /health, GET /help, POST /schedule/workflow,
 *   GET /schedule/workflow/status?instanceId=, POST /schedule/workflow/terminate,
 *   ANY /autha/* (autha-worker proxy).
 * Container (proxied via /*): /pull, /send, /groups, /info, /login, /verify-login,
 *   /refresh-token, /captcha/solve, /captcha/balance, /schedule, /cmd, /health.
 *
 * CLI → HTTP mapping:
 *   toque health            → GET  /health                { ok: true }
 *   toque auth ping         → POST /info                  (auth-protected; 200 = valid)
 *   toque auth refresh      → POST /refresh-token
 *   toque login <user>      → POST /login                 { username, password, provider? }
 *   toque verify-login      → POST /verify-login          { transactionId, otpCode }
 *   toque groups list       → POST /groups                { limit, offset, raw: true }
 *   toque pull --entity <id>→ POST /pull                  { activeEntityId, refresh? }
 *   toque send <groupId>    → POST /send                  { groupId, captchaToken?, captchaType? }
 *   toque schedule create   → POST /schedule/workflow     { targetTime, groupId, pullBefore? }
 *   toque schedule status   → GET  /schedule/workflow/status?instanceId=
 *   toque schedule cancel   → POST /schedule/workflow/terminate { instanceId }
 *   toque captcha solve     → POST /captcha/solve         (returns a token)
 *   toque captcha balance   → POST /captcha/balance
 *   toque cmd <command>     → POST /cmd                   { command, args, timeout? }
 *   toque autha entities     → GET  /autha/entities
 */

export interface ToqueConfig {
  baseUrl: string;
  apiKey: string;
  jwtToken: string;
  authMode: 'api-key' | 'jwt';
}

export type FailureCategory =
  'timeout' | 'invalid_auth' | 'backend_down' | 'network' | 'client_error' | 'unknown';

export interface RecoveryHint {
  category: FailureCategory;
  title: string;
  hint: string;
  action?: string;
}

export interface ToqueResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  latencyMs: number;
  cliCommand: string;
  attempts?: number;
  failureCategory?: FailureCategory;
  recoveryHint?: RecoveryHint;
}

function getConfig(): ToqueConfig {
  if (typeof window === 'undefined') {
    return {
      baseUrl: 'https://toque.decloud.workers.dev',
      apiKey: '',
      jwtToken: '',
      authMode: 'api-key',
    };
  }
  return {
    baseUrl: localStorage.getItem('toque_base_url') || 'https://toque.decloud.workers.dev',
    apiKey: localStorage.getItem('toque_api_key') || '',
    jwtToken: localStorage.getItem('toque_jwt') || '',
    authMode: (localStorage.getItem('toque_auth_mode') as 'api-key' | 'jwt') || 'api-key',
  };
}

function buildHeaders(config: ToqueConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.authMode === 'api-key' && config.apiKey) {
    h['X-API-Key'] = config.apiKey;
  } else if (config.authMode === 'jwt' && config.jwtToken) {
    h['Authorization'] = `Bearer ${config.jwtToken}`;
  }
  return h;
}

/**
 * Build the proxy URL for a given API path.
 * All requests go through /api/toque/<path> (Next.js server-side proxy)
 * to avoid CORS and network issues when fetching from the browser.
 * The real backend base URL is forwarded as ?_target=<baseUrl>.
 */
function buildProxyUrl(config: ToqueConfig, path: string): string {
  // Strip leading slash from path for the proxy route
  const cleanPath = path.replace(/^\//, '');
  const proxyBase = '/api/toque';
  const targetParam = encodeURIComponent(config.baseUrl.replace(/\/$/, ''));
  return `${proxyBase}/${cleanPath}?_target=${targetParam}`;
}

// ─── In-memory GET cache (sub-ms repeat reads) ────────────────────────────────

interface CacheEntry {
  data: unknown;
  status: number;
  ts: number;
}

const getCache = new Map<string, CacheEntry>();

function readCache<T>(key: string, ttlMs: number): ToqueResponse<T> | null {
  const entry = getCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) {
    getCache.delete(key);
    return null;
  }
  return {
    ok: true,
    status: entry.status,
    data: entry.data as T,
    error: null,
    latencyMs: 0,
    cliCommand: key,
    attempts: 1,
  };
}

function writeCache(key: string, data: unknown, status: number) {
  getCache.set(key, { data, status, ts: Date.now() });
  // Cap cache size to avoid unbounded growth
  if (getCache.size > 64) {
    const oldest = getCache.keys().next().value;
    if (oldest) getCache.delete(oldest);
  }
}

// ─── Failure Categorization ───────────────────────────────────────────────────

function categorizeFailure(status: number, error: string | null, latencyMs: number): RecoveryHint {
  const msg = (error || '').toLowerCase();

  // Timeout: request took too long or timed out explicitly
  if (
    latencyMs > 8000 ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('aborted')
  ) {
    return {
      category: 'timeout',
      title: 'Request Timed Out',
      hint: 'The backend did not respond within the expected window. The container may be cold-starting or under heavy load.',
      action:
        'Wait 15–30 seconds and retry. If the issue persists, check container uptime via the Cloudflare dashboard.',
    };
  }

  // Invalid auth: 401 / 403 or auth-related error messages
  if (
    status === 401 ||
    status === 403 ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('invalid api key') ||
    msg.includes('invalid token') ||
    msg.includes('jwt') ||
    msg.includes('api key')
  ) {
    return {
      category: 'invalid_auth',
      title: 'Authentication Failed',
      hint: 'Your API key or JWT token was rejected by the backend. The credential may be expired, revoked, or incorrect.',
      action:
        'Verify your API key in the Connection Configuration panel. If using JWT, try "Refresh Token" to obtain a fresh credential.',
    };
  }

  // Backend down: 502/503/504 or connection refused / failed to fetch
  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('failed to fetch') ||
    msg.includes('connection refused') ||
    msg.includes('econnrefused') ||
    msg.includes('network error') ||
    msg.includes('fetch failed') ||
    status === 0
  ) {
    return {
      category: 'backend_down',
      title: 'Backend Unreachable',
      hint: 'The Toque Worker could not be reached. The service may be down, the base URL may be wrong, or a network issue is blocking the request.',
      action:
        'Check the base URL is correct and the Cloudflare Worker is deployed and running. Verify there are no firewall or DNS issues.',
    };
  }

  // 4xx client errors (not auth)
  if (status >= 400 && status < 500) {
    return {
      category: 'client_error',
      title: 'Client Request Error',
      hint: `The server returned HTTP ${status}. The request may be malformed or the endpoint may not exist.`,
      action:
        'Check the endpoint path and request body. Refer to the CLI Command Reference for correct usage.',
    };
  }

  // 5xx server errors (not 502/503/504 already handled)
  if (status >= 500) {
    return {
      category: 'backend_down',
      title: 'Server Error',
      hint: `The backend returned HTTP ${status}, indicating an internal server error.`,
      action:
        'Check the Toque Worker logs in the Cloudflare dashboard for details. The container may need a restart.',
    };
  }

  return {
    category: 'unknown',
    title: 'Unknown Error',
    hint: error || 'An unexpected error occurred.',
    action: 'Check the base URL, API key, and network connectivity, then retry.',
  };
}

// ─── Exponential Backoff Retry ────────────────────────────────────────────────

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  forceRefresh?: boolean;
  retryOn?: (status: number, error: string | null) => boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<
  Omit<RetryOptions, 'cacheTtlMs' | 'forceRefresh' | 'timeoutMs'>
> & {
  timeoutMs: number;
} = {
  maxAttempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 5000,
  timeoutMs: 10000,
  retryOn: (status, error) => {
    // Retry on network errors (status 0), 502, 503, 504, and timeouts
    if (status === 0) return true;
    if (status === 502 || status === 503 || status === 504) return true;
    const msg = (error || '').toLowerCase();
    if (
      msg.includes('timeout') ||
      msg.includes('failed to fetch') ||
      msg.includes('network error') ||
      msg.includes('fetch failed')
    )
      return true;
    return false;
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * ms * 0.3);
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  cliCommand?: string,
  retryOptions?: RetryOptions
): Promise<ToqueResponse<T>> {
  const config = getConfig();
  const url = buildProxyUrl(config, path);
  const cmd = cliCommand || `toque ${path.replace(/\//g, ' ').trim()}`;
  const opts = {
    maxAttempts: DEFAULT_RETRY_OPTIONS.maxAttempts,
    baseDelayMs: DEFAULT_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs: DEFAULT_RETRY_OPTIONS.maxDelayMs,
    timeoutMs: DEFAULT_RETRY_OPTIONS.timeoutMs,
    retryOn: DEFAULT_RETRY_OPTIONS.retryOn,
    ...retryOptions,
  };
  const isGet = ['GET', 'HEAD'].includes(method);

  // Cache lookup for GET (sub-ms repeat reads)
  if (isGet && opts.cacheTtlMs && !opts.forceRefresh) {
    const cached = readCache<T>(url, opts.cacheTtlMs);
    if (cached) return cached;
  }

  let lastResult: ToqueResponse<T> | null = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const start = performance.now();

    try {
      const fetchOpts: RequestInit = {
        method,
        headers: buildHeaders(config),
        signal: AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs) : undefined,
        keepalive: true,
      };
      if (body && !isGet) {
        fetchOpts.body = JSON.stringify(body);
      }

      const res = await fetch(url, fetchOpts);
      const latencyMs = Math.round(performance.now() - start);

      let data: T | null = null;
      let error: string | null = null;

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const json = await res.json();
        if (res.ok) {
          data = json as T;
        } else {
          error = json?.message || json?.error || `HTTP ${res.status}`;
        }
      } else {
        const text = await res.text();
        if (res.ok) {
          data = text as unknown as T;
        } else {
          error = text || `HTTP ${res.status}`;
        }
      }

      lastResult = {
        ok: res.ok,
        status: res.status,
        data,
        error,
        latencyMs,
        cliCommand: cmd,
        attempts: attempt,
      };

      // Success — return immediately
      if (res.ok) {
        if (isGet && opts.cacheTtlMs) writeCache(url, data, res.status);
        return lastResult;
      }

      // Check if we should retry
      const shouldRetry = attempt < opts.maxAttempts && opts.retryOn(res.status, error);
      if (!shouldRetry) {
        const hint = categorizeFailure(res.status, error, latencyMs);
        return { ...lastResult, failureCategory: hint.category, recoveryHint: hint };
      }
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - start);
      const msg = err instanceof Error ? err.message : 'Network error';

      lastResult = {
        ok: false,
        status: 0,
        data: null,
        error: msg,
        latencyMs,
        cliCommand: cmd,
        attempts: attempt,
      };

      const shouldRetry = attempt < opts.maxAttempts && opts.retryOn(0, msg);
      if (!shouldRetry) {
        const hint = categorizeFailure(0, msg, latencyMs);
        return { ...lastResult, failureCategory: hint.category, recoveryHint: hint };
      }
    }

    // Exponential backoff with jitter before next attempt
    const delay = jitter(Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1), opts.maxDelayMs));
    await sleep(delay);
  }

  // Should not reach here, but satisfy TypeScript
  const hint = categorizeFailure(lastResult!.status, lastResult!.error, lastResult!.latencyMs);
  return { ...lastResult!, failureCategory: hint.category, recoveryHint: hint };
}

// ─── Health ──────────────────────────────────────────────────────────────────

// Backend returns only { ok: true }.
export interface HealthResponse {
  ok: boolean;
}

export const toqueHealth = (forceRefresh = false) =>
  request<HealthResponse>('GET', '/health', undefined, 'toque health', {
    cacheTtlMs: 2000,
    forceRefresh,
    timeoutMs: 6000,
  });

// ─── Auth ─────────────────────────────────────────────────────────────────────

// No dedicated /ping route. Use /info (auth-protected) to validate credentials.
export type AuthInfoResponse = Record<string, unknown>;

export const toqueAuthPing = () =>
  request<AuthInfoResponse>('POST', '/info', {}, 'toque auth ping', {
    timeoutMs: 6000,
  });

export interface AuthRefreshResponse {
  ok: boolean;
  status: number;
  data: unknown;
  saved: boolean;
  method: string;
  timing?: { total: number; ttfb: number };
}

export const toqueAuthRefresh = () =>
  request<AuthRefreshResponse>('POST', '/refresh-token', {}, 'toque auth refresh');

export interface LoginResponse {
  ok: boolean;
  status: number;
  data: unknown;
  captchaToken?: string;
  saved: boolean;
  otpRequired: boolean;
  transactionId?: string;
  intermediateToken?: string;
  timing?: { total: number; ttfb: number };
}

export interface LoginPayload {
  username: string;
  password: string;
  provider?: 'capmonster' | 'capsolver';
  xChannel?: string;
  trustedDeviceToken?: string;
  siteKey?: string;
  pageUrl?: string;
  captchaVersion?: number;
  captchaType?: string;
  enterprise?: boolean;
}

export const toqueLogin = (payload: LoginPayload) =>
  request<LoginResponse>('POST', '/login', payload, `toque login ${payload.username}`);

export interface VerifyLoginResponse {
  ok: boolean;
  status: number;
  data: unknown;
  saved: boolean;
  timing?: { total: number; ttfb: number };
}

export const toqueVerifyLogin = (transactionId: string, otpCode: string) =>
  request<VerifyLoginResponse>(
    'POST',
    '/verify-login',
    { transactionId, otpCode, system: '1', module: '1' },
    `toque verify-login ${transactionId}`
  );

// ─── Groups ───────────────────────────────────────────────────────────────────

export interface Group {
  id: string;
  name: string;
}

export interface GroupsListResponse {
  groups: Group[];
  raw?: unknown;
}

// Parse the raw Nusuk GetGroupList JSON into structured groups.
function findArray(obj: unknown): unknown[] | null {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    const candidates = ['items', 'records', 'results', 'list', 'data', 'groups'];
    for (const k of candidates) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
    // nested response.data
    if (o.response && typeof o.response === 'object') {
      const inner = findArray(o.response);
      if (inner) return inner;
    }
  }
  return null;
}

const ID_FIELDS = ['id', 'groupId', 'groupID', 'group_id', 'value'];
const NAME_FIELDS = ['groupName', 'name', 'nameEn', 'nameAr', 'label', 'title', 'text'];

export function parseGroupsFromRaw(raw: unknown): Group[] {
  const arr = findArray(raw);
  if (!arr) return [];
  const groups: Group[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    let id = '';
    for (const f of ID_FIELDS) {
      if (o[f] !== undefined && o[f] !== null) {
        id = String(o[f]);
        break;
      }
    }
    let name = '';
    for (const f of NAME_FIELDS) {
      if (o[f] !== undefined && o[f] !== null) {
        name = String(o[f]);
        break;
      }
    }
    if (id) groups.push({ id, name: name || id });
  }
  return groups;
}

export const toqueGroupsList = (forceRefresh = false) =>
  request<GroupsListResponse>(
    'POST',
    '/groups',
    { limit: 50, offset: 0, raw: true },
    'toque groups list',
    { forceRefresh, timeoutMs: 15000 }
  ).then((res) => {
    if (res.ok && res.data) {
      const raw = (res.data as { raw?: unknown }).raw;
      const groups = parseGroupsFromRaw(raw);
      return {
        ...res,
        data: { groups, raw },
      } as ToqueResponse<GroupsListResponse>;
    }
    return res;
  });

// ─── Pull ─────────────────────────────────────────────────────────────────────

export interface PullSaved {
  auth: boolean;
  captcha: boolean;
  entityId: string | null;
  systemUserId: string | null;
}

export interface PullResponse {
  ok: boolean;
  context: unknown;
  saved: PullSaved;
}

export const toquePull = (activeEntityId: string, refresh = false) =>
  request<PullResponse>(
    'POST',
    '/pull',
    { activeEntityId, refresh },
    `toque pull --entity ${activeEntityId}`
  );

// ─── Send Visa ────────────────────────────────────────────────────────────────

export interface SendVisaResponse {
  ok: boolean;
  status: number;
  data: unknown;
  timing?: { total: number; ttfb: number };
}

export interface SendVisaPayload {
  groupId: string;
  payload?: Record<string, unknown>;
  captchaToken?: string;
  captchaType?: string;
}

export const toqueSendVisa = (groupId: string, opts?: Omit<SendVisaPayload, 'groupId'>) =>
  request<SendVisaResponse>(
    'POST',
    '/send',
    { groupId, captchaType: 'visa', ...opts },
    `toque send ${groupId}`
  );

// ─── Schedule (Cloudflare Workflow) ──────────────────────────────────────────

export interface ScheduledWorkflow {
  id: string; // instanceId
  groupId: string;
  groupName?: string;
  targetTime: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
  pullBefore: boolean;
  captcha: boolean;
  captchaType: string;
  createdAt: string;
}

export interface ScheduleCreatePayload {
  targetTime: string;
  groupId: string;
  captcha?: boolean;
  captchaType?: string;
  payload?: Record<string, unknown>;
  pullBefore?: boolean;
}

export interface ScheduleCreateResponse {
  ok: boolean;
  instanceId: string;
  targetTime: string;
  groupId: string;
}

export interface ScheduleStatusResponse {
  ok: boolean;
  instanceId: string;
  status: unknown;
}

export const toqueScheduleCreate = (payload: ScheduleCreatePayload) =>
  request<ScheduleCreateResponse>(
    'POST',
    '/schedule/workflow',
    { captcha: true, captchaType: 'visa', pullBefore: true, ...payload },
    `toque schedule create --group ${payload.groupId} --time ${payload.targetTime}`
  );

export const toqueScheduleStatus = (instanceId: string) =>
  request<ScheduleStatusResponse>(
    'GET',
    `/schedule/workflow/status?instanceId=${encodeURIComponent(instanceId)}`,
    undefined,
    `toque schedule status ${instanceId}`
  );

export const toqueScheduleCancel = (instanceId: string) =>
  request<{ ok: boolean; instanceId: string; terminated: boolean }>(
    'POST',
    '/schedule/workflow/terminate',
    { instanceId },
    `toque schedule cancel ${instanceId}`
  );

// ─── CAPTCHA ──────────────────────────────────────────────────────────────────

export interface CaptchaSolveParams {
  provider?: 'capmonster' | 'capsolver';
  version?: 2 | 3;
  captchaType?: 'recaptcha' | 'turnstile' | 'visa' | 'login' | 'general';
  enterprise?: boolean;
  siteKey?: string;
  pageUrl?: string;
  pageAction?: string;
}

export interface CaptchaSolveResponse {
  ok: boolean;
  token: string;
  provider: string;
}

export const toqueCaptchaSolve = (params: CaptchaSolveParams) =>
  request<CaptchaSolveResponse>(
    'POST',
    '/captcha/solve',
    { version: 2, captchaType: 'visa', ...params },
    `toque captcha solve`
  );

export interface CaptchaBalanceResponse {
  ok: boolean;
  balance: number;
  provider: string;
}

export const toqueCaptchaBalance = (provider?: 'capmonster' | 'capsolver') =>
  request<CaptchaBalanceResponse>(
    'POST',
    '/captcha/balance',
    { provider },
    'toque captcha balance'
  );

// Generic CLI command runner — used for captcha start/stop/status/watch/pull/set.
export interface CmdResponse {
  ok: boolean;
  command: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  status?: unknown;
}

export const toqueCmd = (command: string, args: string[] = [], timeout?: number) =>
  request<CmdResponse>('POST', '/cmd', { command, args, timeout }, `toque cmd ${command}`);

export const toqueCaptchaStart = () => toqueCmd('captcha-start');
export const toqueCaptchaStop = () => toqueCmd('captcha-stop');
export const toqueCaptchaStatus = () => toqueCmd('captcha-status');
export const toqueCaptchaWatch = (args: string[] = []) => toqueCmd('captcha-watch', args);
export const toqueCaptchaPull = (entityId?: string, type = 'visa') =>
  toqueCmd('captcha-pull', entityId ? ['--entity', entityId, '--type', type] : ['--type', type]);
export const toqueCaptchaSet = (params: Record<string, string | number>) =>
  toqueCmd(
    'captcha-set',
    Object.entries(params).map(([k, v]) => `--${k}=${v}`)
  );

// ─── Autha worker (entity / captcha / token store) ────────────────────────────

export interface AuthaEntitiesResponse {
  ok: boolean;
  entities: string[];
  count: number;
}

export const toqueAuthaEntities = (forceRefresh = false) =>
  request<AuthaEntitiesResponse>('GET', '/autha/entities', undefined, 'toque autha entities', {
    cacheTtlMs: 10000,
    forceRefresh,
    timeoutMs: 8000,
  });

export const toqueAuthaHealth = () =>
  request<{ ok: boolean; service?: string; version?: string }>(
    'GET',
    '/autha/health',
    undefined,
    'toque autha health',
    { cacheTtlMs: 2000, timeoutMs: 6000 }
  );

export const toqueAuthaStats = (forceRefresh = false) =>
  request<Record<string, unknown>>('GET', '/autha/stats', undefined, 'toque autha stats', {
    cacheTtlMs: 5000,
    forceRefresh,
    timeoutMs: 8000,
  });

// ─── Network / Raw API ────────────────────────────────────────────────────────

export const toqueRawRequest = (method: string, path: string, body?: unknown) =>
  request(method, path, body, `toque api ${method} ${path}`);
