'use client';

import React, { useState, useRef, useEffect } from 'react';
import Icon from '@/components/ui/AppIcon';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { toast } from 'sonner';
import {
  toqueCaptchaSolve,
  toqueCaptchaBalance,
  toqueCaptchaStart,
  toqueCaptchaStop,
  toqueCaptchaStatus,
  toqueCaptchaWatch,
  toqueCaptchaPull,
  toqueCaptchaSet,
  type ToqueResponse,
  type CaptchaSolveParams,
} from '@/lib/toque/client';

type CaptchaOp = 'solve' | 'balance' | 'start' | 'stop' | 'status' | 'watch' | 'pull' | 'set';

interface CommandLog {
  id: string;
  timestamp: string;
  op: CaptchaOp;
  params: string;
  status: 'pending' | 'success' | 'error' | 'running';
  output: string[];
  durationMs?: number;
  httpStatus?: number;
}

interface HistoryEntry {
  id: string;
  timestamp: string;
  op: CaptchaOp;
  params: string;
  status: 'success' | 'error';
  durationMs: number;
  httpStatus?: number;
}

const OP_META: Record<
  CaptchaOp,
  { label: string; icon: string; color: string; desc: string; http: string }
> = {
  solve: {
    label: 'Solve',
    icon: 'CheckCircleIcon',
    color: '#a78bfa',
    desc: 'Solve a captcha and receive a token (capmonster/capsolver)',
    http: 'POST /captcha/solve',
  },
  balance: {
    label: 'Balance',
    icon: 'CurrencyDollarIcon',
    color: 'var(--success)',
    desc: 'Check the remaining balance of a captcha provider',
    http: 'POST /captcha/balance',
  },
  start: {
    label: 'Start',
    icon: 'PlayIcon',
    color: 'var(--success)',
    desc: 'Start the in-process captcha watcher loop',
    http: 'POST /cmd captcha-start',
  },
  stop: {
    label: 'Stop',
    icon: 'StopIcon',
    color: 'var(--error)',
    desc: 'Stop the in-process captcha watcher loop',
    http: 'POST /cmd captcha-stop',
  },
  status: {
    label: 'Status',
    icon: 'InformationCircleIcon',
    color: 'var(--muted-foreground)',
    desc: 'Check watcher loop status (running, pulls, errors)',
    http: 'POST /cmd captcha-status',
  },
  watch: {
    label: 'Watch',
    icon: 'EyeIcon',
    color: 'var(--accent)',
    desc: 'Run a bounded watch cycle and return results',
    http: 'POST /cmd captcha-watch',
  },
  pull: {
    label: 'Pull',
    icon: 'ArrowDownTrayIcon',
    color: 'var(--primary)',
    desc: 'Pull a captcha for an entity',
    http: 'POST /cmd captcha-pull',
  },
  set: {
    label: 'Set',
    icon: 'AdjustmentsHorizontalIcon',
    color: 'var(--warning)',
    desc: 'Configure captcha solver parameters',
    http: 'POST /cmd captcha-set',
  },
};

const SET_PRESETS = [
  { label: 'Default', value: 'timeout=30 retries=3 provider=capmonster concurrency=5' },
  { label: 'Fast', value: 'timeout=15 retries=1 provider=capsolver concurrency=10' },
  { label: 'Robust', value: 'timeout=60 retries=5 provider=capmonster concurrency=3' },
];

function parseKv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  raw
    .trim()
    .split(/\s+/)
    .forEach((pair) => {
      const [k, v] = pair.split('=');
      if (k && v !== undefined) out[k] = v;
    });
  return out;
}

function dataToLines(data: unknown): string[] {
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const lines: string[] = [];
    if (typeof o.stdout === 'string' && o.stdout) {
      o.stdout.split('\n').forEach((l) => l.trim() && lines.push(l));
    }
    if (o.status && typeof o.status === 'object') {
      Object.entries(o.status as Record<string, unknown>).forEach(([k, v]) =>
        lines.push(`  ${k}: ${JSON.stringify(v)}`)
      );
    }
    if (o.token) lines.push(`  token: ${String(o.token).slice(0, 60)}…`);
    if (o.balance !== undefined) lines.push(`  balance: ${o.balance}`);
    if (o.provider) lines.push(`  provider: ${o.provider}`);
    if (!lines.length) {
      Object.entries(o).forEach(([k, v]) =>
        lines.push(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      );
    }
    return lines;
  }
  return [String(data)];
}

export default function CaptchaPanelContent() {
  const [selectedOp, setSelectedOp] = useState<CaptchaOp>('status');
  const [params, setParams] = useState('');
  const [logs, setLogs] = useState<CommandLog[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'terminal' | 'history'>('terminal');
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logs]);

  const runOperation = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setActiveTab('terminal');

    const logId = `log-${Date.now()}`;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const cliCmd = `toque captcha ${selectedOp}${params ? ' ' + params : ''}`;
    const httpEndpoint = OP_META[selectedOp].http;

    setLogs((prev) => [
      ...prev,
      {
        id: logId,
        timestamp: ts,
        op: selectedOp,
        params,
        status: 'running',
        output: [`$ ${cliCmd}`, `→ ${httpEndpoint} ...`],
      },
    ]);

    let result: ToqueResponse<unknown>;

    switch (selectedOp) {
      case 'solve': {
        const kv = parseKv(params);
        const p: CaptchaSolveParams = {
          provider: (kv.provider as 'capmonster' | 'capsolver') || undefined,
          captchaType: (kv.captchaType || kv.type || 'visa') as CaptchaSolveParams['captchaType'],
          siteKey: kv.siteKey,
          pageUrl: kv.pageUrl,
          pageAction: kv.pageAction,
          version: kv.version ? (Number(kv.version) as 2 | 3) : undefined,
        };
        result = await toqueCaptchaSolve(p);
        break;
      }
      case 'balance':
        result = await toqueCaptchaBalance(
          (parseKv(params).provider as 'capmonster' | 'capsolver') || undefined
        );
        break;
      case 'start':
        result = await toqueCaptchaStart();
        break;
      case 'stop':
        result = await toqueCaptchaStop();
        break;
      case 'status':
        result = await toqueCaptchaStatus();
        break;
      case 'watch':
        result = await toqueCaptchaWatch(params.trim() ? params.trim().split(/\s+/) : []);
        break;
      case 'pull': {
        const kv = parseKv(params);
        result = await toqueCaptchaPull(kv.entity || kv.id, kv.type || 'visa');
        break;
      }
      case 'set': {
        const kv = parseKv(params || 'timeout=30 retries=3 provider=capmonster');
        const num: Record<string, string | number> = {};
        Object.entries(kv).forEach(([k, v]) => {
          num[k] = isNaN(Number(v)) ? v : Number(v);
        });
        result = await toqueCaptchaSet(num);
        break;
      }
      default:
        result = await toqueCaptchaStatus();
    }

    const success = result.ok;
    const outputLines: string[] = [`$ ${cliCmd}`, `→ ${httpEndpoint}`];
    if (success && result.data) {
      outputLines.push(`✓ ${httpEndpoint} → ${result.status} (${result.latencyMs}ms)`);
      dataToLines(result.data).forEach((l) => outputLines.push(l));
      toast.success(`${OP_META[selectedOp].label} completed in ${result.latencyMs}ms`);
    } else {
      outputLines.push(`✗ ${httpEndpoint} → ${result.status || 'ERR'}: ${result.error}`);
      toast.error(`${OP_META[selectedOp].label} failed: ${result.error}`);
    }

    setLogs((prev) =>
      prev.map((l) =>
        l.id === logId
          ? {
              ...l,
              status: success ? 'success' : 'error',
              durationMs: result.latencyMs,
              httpStatus: result.status,
              output: outputLines,
            }
          : l
      )
    );
    setHistory((prev) =>
      [
        {
          id: `h-${Date.now()}`,
          timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
          op: selectedOp,
          params,
          status: (success ? 'success' : 'error') as HistoryEntry['status'],
          durationMs: result.latencyMs,
          httpStatus: result.status,
        },
        ...prev,
      ].slice(0, 50)
    );

    setIsRunning(false);
  };

  const clearLogs = () => setLogs([]);
  const opColor = (op: CaptchaOp) => OP_META[op].color;
  const statusDot = (s: 'success' | 'error' | 'running' | 'pending') =>
    s === 'success'
      ? 'var(--success)'
      : s === 'error'
        ? 'var(--error)'
        : s === 'running'
          ? 'var(--warning)'
          : 'var(--muted-foreground)';

  const placeholderFor = (op: CaptchaOp) =>
    op === 'solve'
      ? 'provider=capmonster captchaType=visa siteKey=... pageUrl=...'
      : op === 'balance'
        ? 'provider=capmonster'
        : op === 'pull'
          ? 'entity=525513 type=visa'
          : op === 'set'
            ? 'timeout=30 retries=3 provider=capmonster'
            : op === 'watch'
              ? '--entity 525513 --type visa'
              : '(no params required)';

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-3xl font-semibold" style={{ color: 'var(--foreground)' }}>
          CAPTCHA Manager
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Solve, balance, start, stop, status, watch, pull, set — wired to{' '}
          <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
            POST /captcha/solve · POST /captcha/balance · POST /cmd captcha-*
          </span>
        </p>
      </div>

      {/* Operation selector */}
      <div className="card-surface p-5">
        <h2
          className="text-xs font-semibold uppercase tracking-widest mb-4"
          style={{ color: 'var(--muted-foreground)' }}
        >
          Select Operation
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {(Object.keys(OP_META) as CaptchaOp[]).map((op) => {
            const meta = OP_META[op];
            const active = selectedOp === op;
            return (
              <button
                key={op}
                onClick={() => {
                  setSelectedOp(op);
                  setParams('');
                }}
                className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border transition-all text-center"
                style={{
                  backgroundColor: active ? `${meta.color}18` : 'var(--muted)',
                  borderColor: active ? meta.color : 'var(--border)',
                  color: active ? meta.color : 'var(--muted-foreground)',
                }}
              >
                <Icon name={meta.icon as Parameters<typeof Icon>[0]['name']} size={18} />
                <span className="text-xs font-semibold">{meta.label}</span>
                <span className="text-2xs font-mono" style={{ fontSize: '9px', opacity: 0.7 }}>
                  {meta.http.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            {OP_META[selectedOp].desc}
          </p>
          <span
            className="font-mono text-xs px-2 py-0.5 rounded"
            style={{
              backgroundColor: 'rgba(99,102,241,0.1)',
              color: 'var(--accent)',
              border: '1px solid rgba(99,102,241,0.2)',
              whiteSpace: 'nowrap',
            }}
          >
            {OP_META[selectedOp].http}
          </span>
        </div>
      </div>

      {/* Params + Execute */}
      <div className="card-surface p-5">
        <h2
          className="text-xs font-semibold uppercase tracking-widest mb-4"
          style={{ color: 'var(--muted-foreground)' }}
        >
          Parameters —{' '}
          <span style={{ color: opColor(selectedOp) }}>{OP_META[selectedOp].label}</span>
        </h2>

        {selectedOp === 'set' && (
          <div className="flex gap-2 flex-wrap mb-3">
            {SET_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setParams(p.value)}
                className="px-3 py-1.5 rounded text-xs font-medium transition-all"
                style={{
                  backgroundColor: params === p.value ? 'rgba(245,158,11,0.15)' : 'var(--input)',
                  color: params === p.value ? 'var(--warning)' : 'var(--muted-foreground)',
                  border: `1px solid ${params === p.value ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <input
            className="input-field flex-1 px-3 py-2.5 font-mono text-sm"
            placeholder={placeholderFor(selectedOp)}
            value={params}
            onChange={(e) => setParams(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runOperation()}
          />
          <button
            onClick={() => void runOperation()}
            disabled={isRunning}
            className="btn-primary px-6 py-2.5 text-sm font-semibold"
            style={{ backgroundColor: opColor(selectedOp), borderColor: opColor(selectedOp) }}
          >
            {isRunning ? <LoadingSpinner size={14} /> : <Icon name="PlayIcon" size={14} />}
            {isRunning ? 'Running...' : `Run ${OP_META[selectedOp].label}`}
          </button>
        </div>
      </div>

      {/* Terminal / History */}
      <div className="card-surface overflow-hidden">
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex gap-1">
            {(['terminal', 'history'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-1.5 rounded text-xs font-medium transition-all"
                style={{
                  backgroundColor: activeTab === tab ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: activeTab === tab ? 'var(--accent)' : 'var(--muted-foreground)',
                }}
              >
                {tab === 'terminal' ? `Terminal (${logs.length})` : `History (${history.length})`}
              </button>
            ))}
          </div>
          <button
            onClick={clearLogs}
            className="text-xs"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Clear
          </button>
        </div>

        {activeTab === 'terminal' ? (
          <div
            ref={terminalRef}
            className="p-4 font-mono text-xs space-y-3 overflow-y-auto"
            style={{ backgroundColor: '#050508', minHeight: '260px', maxHeight: '400px' }}
          >
            {logs.length === 0 && (
              <div style={{ color: 'var(--muted-foreground)' }}>
                Select an operation and click Run to execute a toque captcha command.
              </div>
            )}
            {logs.map((log) => (
              <div key={log.id} className="space-y-0.5">
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ color: 'var(--muted-foreground)' }}>{log.timestamp}</span>
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: statusDot(log.status) }}
                  />
                  {log.httpStatus && (
                    <span
                      className="font-mono text-2xs px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor:
                          log.httpStatus < 300 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                        color: log.httpStatus < 300 ? 'var(--success)' : 'var(--error)',
                      }}
                    >
                      HTTP {log.httpStatus}
                    </span>
                  )}
                  {log.durationMs && (
                    <span style={{ color: 'var(--muted-foreground)' }}>{log.durationMs}ms</span>
                  )}
                </div>
                {log.output.map((line, i) => (
                  <div
                    key={`${log.id}-line-${i}`}
                    style={{
                      color: line.startsWith('✓')
                        ? 'var(--success)'
                        : line.startsWith('✗')
                          ? 'var(--error)'
                          : line.startsWith('$')
                            ? 'var(--accent)'
                            : line.startsWith('→')
                              ? 'var(--muted-foreground)'
                              : '#86efac',
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            ))}
            {isRunning && (
              <div className="flex items-center gap-2" style={{ color: 'var(--warning)' }}>
                <LoadingSpinner size={10} />
                <span>Executing...</span>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Time', 'Operation', 'CLI Command', 'HTTP', 'Duration', 'Status'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left font-semibold"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      No history yet
                    </td>
                  </tr>
                )}
                {history.map((h) => (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-4 py-2.5" style={{ color: 'var(--muted-foreground)' }}>
                      {h.timestamp}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: OP_META[h.op].color }}>
                      {OP_META[h.op].label}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--accent)' }}>
                      $ toque captcha {h.op}
                      {h.params ? ' ' + h.params : ''}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--muted-foreground)' }}>
                      {OP_META[h.op].http}
                    </td>
                    <td
                      className="px-4 py-2.5"
                      style={{
                        color:
                          h.durationMs > 2000
                            ? 'var(--error)'
                            : h.durationMs > 500
                              ? 'var(--warning)'
                              : 'var(--success)',
                      }}
                    >
                      {h.durationMs}ms
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="px-1.5 py-0.5 rounded text-2xs font-semibold"
                        style={{
                          backgroundColor:
                            h.status === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                          color: h.status === 'success' ? 'var(--success)' : 'var(--error)',
                        }}
                      >
                        {h.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
