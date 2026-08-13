'use client';

import React, { useState, useCallback } from 'react';
import Icon from '@/components/ui/AppIcon';
import JsonViewer from '@/components/ui/JsonViewer';

// ─── Types ────────────────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Header {
  key: string;
  value: string;
  enabled: boolean;
}

interface SavedTemplate {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: Header[];
  body: string;
  createdAt: string;
}

interface HistoryEntry {
  id: string;
  method: HttpMethod;
  url: string;
  status: number | null;
  latencyMs: number | null;
  timestamp: string;
  response: unknown;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

function getBaseUrl() {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('toque_base_url') || 'https://toque.decloud.workers.dev';
  }
  return 'https://toque.decloud.workers.dev';
}

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const mode = localStorage.getItem('toque_auth_mode') || 'api-key';
  if (mode === 'api-key') {
    const key = localStorage.getItem('toque_api_key') || '';
    return key ? { 'X-API-Key': key } : {};
  } else {
    const jwt = localStorage.getItem('toque_jwt') || '';
    return jwt ? { Authorization: `Bearer ${jwt}` } : {};
  }
}

const BASE_URL = 'https://toque.decloud.workers.dev';

const INITIAL_TEMPLATES: SavedTemplate[] = [
  {
    id: 'tpl-1',
    name: 'Health Check',
    method: 'GET',
    url: `${BASE_URL}/health`,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: '',
    createdAt: '2026-08-10T07:00:00Z',
  },
  {
    id: 'tpl-2',
    name: 'List Groups',
    method: 'GET',
    url: `${BASE_URL}/groups/list`,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: '',
    createdAt: '2026-08-10T07:01:00Z',
  },
  {
    id: 'tpl-3',
    name: 'Auth Ping',
    method: 'POST',
    url: `${BASE_URL}/auth/ping`,
    headers: [
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'Authorization', value: 'Bearer <token>', enabled: true },
    ],
    body: '{\n  "check": true\n}',
    createdAt: '2026-08-10T07:02:00Z',
  },
  {
    id: 'tpl-4',
    name: 'Send Visa',
    method: 'POST',
    url: `${BASE_URL}/send`,
    headers: [
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'Authorization', value: 'Bearer <token>', enabled: true },
    ],
    body: '{\n  "groupId": "GRP-001"\n}',
    createdAt: '2026-08-10T07:03:00Z',
  },
  {
    id: 'tpl-5',
    name: 'Pull Pilgrims',
    method: 'POST',
    url: `${BASE_URL}/pull`,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: '{\n  "groupId": "GRP-001"\n}',
    createdAt: '2026-08-10T07:04:00Z',
  },
  {
    id: 'tpl-6',
    name: 'Schedule Create',
    method: 'POST',
    url: `${BASE_URL}/schedule/create`,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: '{\n  "groupId": "GRP-001",\n  "targetTime": "14:30:00.000",\n  "targetDate": "2026-08-15",\n  "timezone": "UTC",\n  "pullBefore": true,\n  "retryOnFail": true,\n  "priority": "normal"\n}',
    createdAt: '2026-08-10T07:05:00Z',
  },
  {
    id: 'tpl-7',
    name: 'Schedule Get',
    method: 'GET',
    url: `${BASE_URL}/schedule/get`,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: '',
    createdAt: '2026-08-10T07:06:00Z',
  },
  {
    id: 'tpl-8',
    name: 'CAPTCHA Status',
    method: 'GET',
    url: `${BASE_URL}/captcha/status`,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: '',
    createdAt: '2026-08-10T07:07:00Z',
  },
];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'var(--success)',
  POST: 'var(--accent)',
  PUT: 'var(--warning)',
  PATCH: '#a78bfa',
  DELETE: 'var(--error)',
};

const METHOD_BG: Record<HttpMethod, string> = {
  GET: 'rgba(34,197,94,0.12)',
  POST: 'rgba(99,102,241,0.12)',
  PUT: 'rgba(245,158,11,0.12)',
  PATCH: 'rgba(167,139,250,0.12)',
  DELETE: 'rgba(239,68,68,0.12)',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className="text-2xs font-bold font-mono px-1.5 py-0.5 rounded"
      style={{ color: METHOD_COLORS[method], backgroundColor: METHOD_BG[method] }}
    >
      {method}
    </span>
  );
}

function StatusBadge({ status }: { status: number | null }) {
  if (status === null)
    return (
      <span className="text-2xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
        —
      </span>
    );
  const color =
    status >= 200 && status < 300
      ? 'var(--success)'
      : status >= 400
        ? 'var(--error)'
        : 'var(--warning)';
  const bg =
    status >= 200 && status < 300
      ? 'rgba(34,197,94,0.12)'
      : status >= 400
        ? 'rgba(239,68,68,0.12)'
        : 'rgba(245,158,11,0.12)';
  return (
    <span
      className="text-2xs font-bold font-mono px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: bg }}
    >
      {status}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ApiBuilderContent() {
  // Request state
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState(`${BASE_URL}/health`);
  const [headers, setHeaders] = useState<Header[]>([
    { key: 'Content-Type', value: 'application/json', enabled: true },
  ]);
  const [body, setBody] = useState('');
  const [activeTab, setActiveTab] = useState<'headers' | 'body'>('headers');

  // Response state
  const [response, setResponse] = useState<unknown>(null);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseLatency, setResponseLatency] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Templates & history
  const [templates, setTemplates] = useState<SavedTemplate[]>(INITIAL_TEMPLATES);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [activePanel, setActivePanel] = useState<'templates' | 'history'>('templates');
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<HistoryEntry | null>(null);

  // ── Header helpers ──────────────────────────────────────────────────────────

  const addHeader = () => setHeaders((h) => [...h, { key: '', value: '', enabled: true }]);
  const removeHeader = (i: number) => setHeaders((h) => h.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, field: keyof Header, val: string | boolean) =>
    setHeaders((h) => h.map((hdr, idx) => (idx === i ? { ...hdr, [field]: val } : hdr)));

  // ── Load template ───────────────────────────────────────────────────────────

  const loadTemplate = useCallback((tpl: SavedTemplate) => {
    setMethod(tpl.method);
    setUrl(tpl.url);
    setHeaders(tpl.headers);
    setBody(tpl.body);
    setResponse(null);
    setResponseStatus(null);
    setResponseLatency(null);
    setSendError(null);
  }, []);

  // ── Save template ───────────────────────────────────────────────────────────

  const saveTemplate = () => {
    if (!templateName.trim()) return;
    const tpl: SavedTemplate = {
      id: `tpl-${Date.now()}`,
      name: templateName.trim(),
      method,
      url,
      headers,
      body,
      createdAt: new Date().toISOString(),
    };
    setTemplates((prev) => [tpl, ...prev]);
    setTemplateName('');
    setShowSaveModal(false);
  };

  const deleteTemplate = (id: string) => setTemplates((prev) => prev.filter((t) => t.id !== id));

  // ── Send request ────────────────────────────────────────────────────────────

  const sendRequest = async () => {
    if (!url.trim() || isSending) return;
    setIsSending(true);
    setSendError(null);
    setResponse(null);
    setResponseStatus(null);
    setResponseLatency(null);
    setResponseHeaders({});

    const start = Date.now();
    try {
      const enabledHeaders = headers.filter((h) => h.enabled && h.key.trim());
      const headersObj: Record<string, string> = {};
      // Inject toque auth headers automatically
      Object.assign(headersObj, getAuthHeaders());
      enabledHeaders.forEach((h) => {
        headersObj[h.key] = h.value;
      });

      const fetchOptions: RequestInit = {
        method,
        headers: headersObj,
      };
      if (['POST', 'PUT', 'PATCH'].includes(method) && body.trim()) {
        fetchOptions.body = body;
      }

      const res = await fetch(url, fetchOptions);
      const latency = Date.now() - start;
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });

      let data: unknown;
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        data = await res.text();
      }

      setResponseStatus(res.status);
      setResponseLatency(latency);
      setResponseHeaders(resHeaders);
      setResponse(data);

      const entry: HistoryEntry = {
        id: `hist-${Date.now()}`,
        method,
        url,
        status: res.status,
        latencyMs: latency,
        timestamp: new Date().toISOString(),
        response: data,
      };
      setHistory((prev) => [entry, ...prev.slice(0, 49)]);
    } catch (err) {
      const latency = Date.now() - start;
      const msg = err instanceof Error ? err.message : 'Request failed';
      setSendError(msg);
      setResponseLatency(latency);

      const entry: HistoryEntry = {
        id: `hist-${Date.now()}`,
        method,
        url,
        status: null,
        latencyMs: latency,
        timestamp: new Date().toISOString(),
        response: null,
        error: msg,
      };
      setHistory((prev) => [entry, ...prev.slice(0, 49)]);
    } finally {
      setIsSending(false);
    }
  };

  // ── Load history entry ──────────────────────────────────────────────────────

  const loadHistoryEntry = (entry: HistoryEntry) => {
    setSelectedHistoryEntry(entry);
    setMethod(entry.method);
    setUrl(entry.url);
    setResponse(entry.response);
    setResponseStatus(entry.status);
    setResponseLatency(entry.latencyMs);
    setSendError(entry.error ?? null);
  };

  const formatTs = (iso: string) => {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold" style={{ color: 'var(--foreground)' }}>
            API Builder
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Build and execute arbitrary POST/GET requests against the Nusuk API
          </p>
        </div>
        <button
          onClick={() => setShowSaveModal(true)}
          className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
        >
          <Icon name="BookmarkIcon" size={15} />
          Save Template
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* ── Left panel: Templates / History ── */}
        <div className="xl:col-span-1 card-surface flex flex-col" style={{ minHeight: '600px' }}>
          {/* Tab switcher */}
          <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
            {(['templates', 'history'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActivePanel(tab)}
                className="flex-1 py-2.5 text-xs font-semibold capitalize transition-colors"
                style={{
                  color: activePanel === tab ? 'var(--accent)' : 'var(--muted-foreground)',
                  borderBottom:
                    activePanel === tab ? '2px solid var(--accent)' : '2px solid transparent',
                  backgroundColor: 'transparent',
                }}
              >
                {tab === 'templates'
                  ? `Templates (${templates.length})`
                  : `History (${history.length})`}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {activePanel === 'templates' && (
              <>
                {templates.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-32 gap-2">
                    <Icon
                      name="BookmarkIcon"
                      size={24}
                      style={{ color: 'var(--muted-foreground)' }}
                    />
                    <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      No saved templates
                    </p>
                  </div>
                )}
                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors"
                    style={{ backgroundColor: 'transparent' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--muted)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onClick={() => loadTemplate(tpl)}
                  >
                    <MethodBadge method={tpl.method} />
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs font-semibold truncate"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {tpl.name}
                      </p>
                      <p
                        className="text-2xs truncate font-mono"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {tpl.url.replace(BASE_URL, '')}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTemplate(tpl.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 btn-ghost p-1 transition-opacity"
                      aria-label="Delete template"
                    >
                      <Icon name="TrashIcon" size={12} style={{ color: 'var(--error)' }} />
                    </button>
                  </div>
                ))}
              </>
            )}

            {activePanel === 'history' && (
              <>
                {history.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-32 gap-2">
                    <Icon name="ClockIcon" size={24} style={{ color: 'var(--muted-foreground)' }} />
                    <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      No requests yet
                    </p>
                  </div>
                )}
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors"
                    style={{
                      backgroundColor:
                        selectedHistoryEntry?.id === entry.id ? 'var(--muted)' : 'transparent',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--muted)')}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor =
                        selectedHistoryEntry?.id === entry.id ? 'var(--muted)' : 'transparent')
                    }
                    onClick={() => loadHistoryEntry(entry)}
                  >
                    <MethodBadge method={entry.method} />
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-2xs font-mono truncate"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {entry.url.replace(BASE_URL, '') || '/'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <StatusBadge status={entry.status} />
                        {entry.latencyMs !== null && (
                          <span
                            className="text-2xs font-mono"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {entry.latencyMs}ms
                          </span>
                        )}
                        <span className="text-2xs" style={{ color: 'var(--muted-foreground)' }}>
                          {formatTs(entry.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── Right panel: Request + Response ── */}
        <div className="xl:col-span-3 flex flex-col gap-4">
          {/* URL bar */}
          <div className="card-surface p-3">
            <div className="flex gap-2 items-center">
              {/* Method selector */}
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as HttpMethod)}
                className="font-mono text-xs font-bold px-2 py-2 rounded-lg outline-none cursor-pointer shrink-0"
                style={{
                  backgroundColor: METHOD_BG[method],
                  color: METHOD_COLORS[method],
                  border: `1px solid ${METHOD_COLORS[method]}33`,
                  minWidth: '80px',
                }}
              >
                {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              {/* URL input */}
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendRequest()}
                placeholder="https://toque.decloud.workers.dev/..."
                className="flex-1 font-mono text-xs px-3 py-2 rounded-lg outline-none"
                style={{
                  backgroundColor: 'var(--muted)',
                  color: 'var(--foreground)',
                  border: '1px solid var(--border)',
                }}
              />

              {/* Send button */}
              <button
                onClick={sendRequest}
                disabled={isSending || !url.trim()}
                className="btn-primary flex items-center gap-2 px-4 py-2 text-sm shrink-0"
              >
                {isSending ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Sending
                  </>
                ) : (
                  <>
                    <Icon name="PaperAirplaneIcon" size={14} />
                    Send
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Request config tabs */}
          <div className="card-surface flex flex-col">
            <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
              {(['headers', 'body'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="px-4 py-2.5 text-xs font-semibold capitalize transition-colors"
                  style={{
                    color: activeTab === tab ? 'var(--accent)' : 'var(--muted-foreground)',
                    borderBottom:
                      activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                    backgroundColor: 'transparent',
                  }}
                >
                  {tab === 'headers'
                    ? `Headers (${headers.filter((h) => h.enabled).length})`
                    : 'Body'}
                </button>
              ))}
            </div>

            <div className="p-3">
              {activeTab === 'headers' && (
                <div className="space-y-2">
                  {headers.map((hdr, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={hdr.enabled}
                        onChange={(e) => updateHeader(i, 'enabled', e.target.checked)}
                        className="shrink-0 accent-indigo-500"
                      />
                      <input
                        type="text"
                        value={hdr.key}
                        onChange={(e) => updateHeader(i, 'key', e.target.value)}
                        placeholder="Header name"
                        className="flex-1 font-mono text-xs px-2.5 py-1.5 rounded-md outline-none"
                        style={{
                          backgroundColor: 'var(--muted)',
                          color: 'var(--foreground)',
                          border: '1px solid var(--border)',
                        }}
                      />
                      <input
                        type="text"
                        value={hdr.value}
                        onChange={(e) => updateHeader(i, 'value', e.target.value)}
                        placeholder="Value"
                        className="flex-1 font-mono text-xs px-2.5 py-1.5 rounded-md outline-none"
                        style={{
                          backgroundColor: 'var(--muted)',
                          color: 'var(--foreground)',
                          border: '1px solid var(--border)',
                        }}
                      />
                      <button
                        onClick={() => removeHeader(i)}
                        className="btn-ghost p-1.5"
                        aria-label="Remove header"
                      >
                        <Icon name="XMarkIcon" size={12} style={{ color: 'var(--error)' }} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addHeader}
                    className="btn-ghost flex items-center gap-1.5 text-xs mt-1"
                  >
                    <Icon name="PlusIcon" size={13} />
                    Add Header
                  </button>
                </div>
              )}

              {activeTab === 'body' && (
                <div>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={'{\n  "key": "value"\n}'}
                    rows={8}
                    className="w-full font-mono text-xs px-3 py-2.5 rounded-lg outline-none resize-y"
                    style={{
                      backgroundColor: '#050508',
                      color: 'var(--foreground)',
                      border: '1px solid var(--border)',
                      lineHeight: '1.6',
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Response viewer */}
          <div className="card-surface flex flex-col">
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
                  Response
                </span>
                {responseStatus !== null && <StatusBadge status={responseStatus} />}
                {responseLatency !== null && (
                  <span
                    className="text-2xs font-mono"
                    style={{
                      color: responseLatency > 200 ? 'var(--warning)' : 'var(--muted-foreground)',
                    }}
                  >
                    {responseLatency}ms
                  </span>
                )}
              </div>
              {Object.keys(responseHeaders).length > 0 && (
                <details className="text-2xs" style={{ color: 'var(--muted-foreground)' }}>
                  <summary className="cursor-pointer select-none">Response Headers</summary>
                  <div
                    className="absolute right-4 mt-1 z-10 rounded-lg p-3 space-y-1 text-2xs font-mono shadow-xl"
                    style={{
                      backgroundColor: 'var(--card)',
                      border: '1px solid var(--border)',
                      maxWidth: '320px',
                    }}
                  >
                    {Object.entries(responseHeaders).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span style={{ color: 'var(--accent)' }}>{k}:</span>
                        <span style={{ color: 'var(--foreground)' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>

            <div className="p-3">
              {!response && !sendError && !isSending && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Icon
                    name="ArrowUpCircleIcon"
                    size={32}
                    style={{ color: 'var(--muted-foreground)', opacity: 0.4 }}
                  />
                  <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    Hit Send to execute the request
                  </p>
                </div>
              )}

              {isSending && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <span className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
                  <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    Sending request…
                  </p>
                </div>
              )}

              {sendError && !isSending && (
                <div
                  className="rounded-lg p-4 flex items-start gap-3"
                  style={{
                    backgroundColor: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.2)',
                  }}
                >
                  <Icon
                    name="ExclamationCircleIcon"
                    size={16}
                    style={{ color: 'var(--error)', marginTop: '1px', flexShrink: 0 }}
                  />
                  <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--error)' }}>
                      Request Failed
                    </p>
                    <p
                      className="text-xs mt-1 font-mono"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {sendError}
                    </p>
                  </div>
                </div>
              )}

              {response !== null && !isSending && (
                <JsonViewer data={response} maxHeight={360} title="response.json" />
              )}

              {typeof response === 'string' && !isSending && (
                <pre
                  className="font-mono text-xs p-3 rounded-lg overflow-auto"
                  style={{
                    backgroundColor: '#050508',
                    color: 'var(--foreground)',
                    border: '1px solid var(--border)',
                    maxHeight: '360px',
                  }}
                >
                  {response}
                </pre>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save template modal */}
      {showSaveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
        >
          <div
            className="rounded-xl p-6 w-full max-w-sm shadow-2xl"
            style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
              Save as Template
            </h3>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveTemplate()}
              placeholder="Template name…"
              autoFocus
              className="w-full text-sm px-3 py-2 rounded-lg outline-none mb-4"
              style={{
                backgroundColor: 'var(--muted)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowSaveModal(false)}
                className="btn-ghost px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveTemplate}
                disabled={!templateName.trim()}
                className="btn-primary px-4 py-2 text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
