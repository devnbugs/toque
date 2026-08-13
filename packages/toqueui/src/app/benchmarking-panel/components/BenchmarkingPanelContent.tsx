'use client';

import React, { useState, useMemo } from 'react';
import Icon from '@/components/ui/AppIcon';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { toast } from 'sonner';
import {
  toqueHealth,
  toqueAuthaHealth,
  toqueAuthaStats,
  toqueAuthaEntities,
  toqueAuthPing,
  toqueGroupsList,
  toqueCaptchaBalance,
  toqueCmd,
  type ToqueResponse,
} from '@/lib/toque/client';

type BenchTarget = {
  label: string;
  method: string;
  path: string;
  run: (i: number) => Promise<ToqueResponse<unknown>>;
  safe: boolean; // safe to hammer
};

const TARGETS: BenchTarget[] = [
  {
    label: 'GET /health',
    method: 'GET',
    path: '/health',
    safe: true,
    run: () => toqueHealth(true),
  },
  {
    label: 'GET /autha/health',
    method: 'GET',
    path: '/autha/health',
    safe: true,
    run: () => toqueAuthaHealth(),
  },
  {
    label: 'GET /autha/entities',
    method: 'GET',
    path: '/autha/entities',
    safe: true,
    run: () => toqueAuthaEntities(true),
  },
  {
    label: 'GET /autha/stats',
    method: 'GET',
    path: '/autha/stats',
    safe: true,
    run: () => toqueAuthaStats(true),
  },
  { label: 'POST /info', method: 'POST', path: '/info', safe: true, run: () => toqueAuthPing() },
  {
    label: 'POST /groups',
    method: 'POST',
    path: '/groups',
    safe: true,
    run: () => toqueGroupsList(true),
  },
  {
    label: 'POST /captcha/balance',
    method: 'POST',
    path: '/captcha/balance',
    safe: true,
    run: () => toqueCaptchaBalance(),
  },
];

interface BenchRun {
  id: string;
  label: string;
  target: string;
  iterations: number;
  concurrency: number;
  status: 'idle' | 'running' | 'done' | 'error';
  avgMs?: number;
  minMs?: number;
  maxMs?: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  successRate?: number;
  successCount?: number;
  errorCount?: number;
  startedAt?: string;
  buckets?: { range: string; count: number }[];
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function makeBuckets(latencies: number[]): { range: string; count: number }[] {
  if (!latencies.length) return [];
  const max = Math.max(...latencies);
  const edges = [0, 50, 100, 150, 200, 300, 500, 800, 1200, 2000, 4000, max + 1].filter(
    (v, i, arr) => arr.indexOf(v) === i && (i === 0 || v <= max + 1)
  );
  const buckets: { range: string; count: number }[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const count = latencies.filter((l) => l >= lo && l < hi).length;
    if (count > 0) buckets.push({ range: `${lo}-${hi}ms`, count });
  }
  return buckets;
}

async function runPool(tasks: (() => Promise<void>)[], concurrency: number, onDone: () => void) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const i = cursor++;
      await tasks[i]();
    }
  });
  await Promise.all(workers);
  void onDone;
}

export default function BenchmarkingPanelContent() {
  const [runs, setRuns] = useState<BenchRun[]>([]);
  const [targetIdx, setTargetIdx] = useState(0);
  const [iterations, setIterations] = useState(20);
  const [concurrency, setConcurrency] = useState(5);
  const [label, setLabel] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cliLog, setCliLog] = useState<string[]>([]);
  const [cliCount, setCliCount] = useState(10);
  const [isCliRunning, setIsCliRunning] = useState(false);

  const appendLog = (line: string) => setCliLog((prev) => [...prev.slice(-99), line]);

  const handleRun = async () => {
    if (isRunning) return;
    const target = TARGETS[targetIdx];
    setIsRunning(true);
    setProgress(0);

    const runId = `bm-${Date.now()}`;
    const runLabel = label || target.label;
    appendLog(
      `$ toque bench --target "${target.label}" --iter ${iterations} --concurrency ${concurrency}`
    );
    appendLog(`→ ${target.method} ${target.path} ×${iterations}`);

    setRuns((prev) => [
      {
        id: runId,
        label: runLabel,
        target: target.label,
        iterations,
        concurrency,
        status: 'running',
        startedAt: new Date().toLocaleTimeString('en-US', { hour12: false }),
      },
      ...prev,
    ]);

    const latencies: number[] = [];
    let success = 0;
    let fail = 0;
    let done = 0;
    const tasks = Array.from({ length: iterations }, (_, i) => async () => {
      const res = await target.run(i);
      latencies.push(res.latencyMs);
      if (res.ok) success++;
      else fail++;
      done++;
      setProgress(Math.round((done / iterations) * 100));
    });

    await runPool(tasks, concurrency, () => {});

    latencies.sort((a, b) => a - b);
    const sum = latencies.reduce((a, b) => a + b, 0);
    const avg = latencies.length ? Math.round(sum / latencies.length) : 0;
    const min = latencies.length ? latencies[0] : 0;
    const max = latencies.length ? latencies[latencies.length - 1] : 0;
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const successRate = iterations ? Math.round((success / iterations) * 100) : 0;

    setRuns((prev) =>
      prev.map((r) =>
        r.id === runId
          ? {
              ...r,
              status: 'done',
              avgMs: avg,
              minMs: min,
              maxMs: max,
              p50Ms: p50,
              p95Ms: p95,
              p99Ms: p99,
              successRate,
              successCount: success,
              errorCount: fail,
              buckets: makeBuckets(latencies),
            }
          : r
      )
    );
    appendLog(
      `✓ done — avg ${avg}ms  p50 ${p50}ms  p95 ${p95}ms  p99 ${p99}ms  success ${successRate}% (${success}/${iterations})`
    );
    toast.success(`Benchmark complete — avg ${avg}ms, ${successRate}% success`);

    setIsRunning(false);
    setProgress(0);
    setLabel('');
  };

  const handleCliBench = async () => {
    if (isCliRunning) return;
    setIsCliRunning(true);
    appendLog(`$ toque cmd bench ${cliCount}`);
    const r = await toqueCmd('bench', [String(cliCount)]);
    if (r.ok && r.data) {
      appendLog(`✓ POST /cmd bench → ${r.status} (${r.latencyMs}ms)`);
      const out = (r.data as { stdout?: string }).stdout || '';
      if (out) out.split('\n').forEach((l) => l.trim() && appendLog(`  ${l}`));
      toast.success(`CLI bench done in ${r.latencyMs}ms`);
    } else {
      appendLog(`✗ POST /cmd bench → ${r.status || 'ERR'}: ${r.error}`);
      toast.error('CLI bench failed: ' + r.error);
    }
    setIsCliRunning(false);
  };

  const statusColor = (s: BenchRun['status']) =>
    s === 'done'
      ? 'var(--success)'
      : s === 'error'
        ? 'var(--error)'
        : s === 'running'
          ? 'var(--warning)'
          : 'var(--muted-foreground)';

  const maxBucket = useMemo(() => {
    let m = 0;
    runs.forEach((r) => r.buckets?.forEach((b) => (m = Math.max(m, b.count))));
    return m || 1;
  }, [runs]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold" style={{ color: 'var(--foreground)' }}>
            Benchmarking
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Client-side load tests against live endpoints — measures real latency through your
            proxy. Backend has no structured bench API, so we measure from the UI directly.
          </p>
        </div>
      </div>

      {/* Config card */}
      <div className="card-surface p-5">
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
          New Benchmark Run
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
              Target endpoint
            </label>
            <select
              className="input-field px-3 py-2 text-sm"
              value={targetIdx}
              onChange={(e) => setTargetIdx(Number(e.target.value))}
            >
              {TARGETS.map((t, i) => (
                <option key={t.label} value={i}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
              Label (optional)
            </label>
            <input
              className="input-field px-3 py-2 text-sm"
              placeholder="e.g. Health p95"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
              Iterations
            </label>
            <input
              type="number"
              className="input-field px-3 py-2 text-sm font-mono"
              min={1}
              max={200}
              value={iterations}
              onChange={(e) => setIterations(Math.max(1, Math.min(200, Number(e.target.value))))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
              Concurrency
            </label>
            <input
              type="number"
              className="input-field px-3 py-2 text-sm font-mono"
              min={1}
              max={20}
              value={concurrency}
              onChange={(e) => setConcurrency(Math.max(1, Math.min(20, Number(e.target.value))))}
            />
          </div>
        </div>

        <div
          className="mt-3 flex items-center gap-2 px-3 py-2 rounded font-mono text-xs"
          style={{ backgroundColor: 'var(--input)', border: '1px solid var(--border)' }}
        >
          <span style={{ color: 'var(--accent)' }}>$</span>
          <span style={{ color: 'var(--foreground)' }}>
            toque bench --target &quot;{TARGETS[targetIdx].label}&quot; --iter {iterations}{' '}
            --concurrency {concurrency}
          </span>
        </div>

        {isRunning && (
          <div className="mt-4">
            <div className="flex justify-between mb-1">
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                Running benchmark…
              </span>
              <span className="text-xs font-mono" style={{ color: 'var(--accent)' }}>
                {progress}%
              </span>
            </div>
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{ backgroundColor: 'var(--muted)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${progress}%`, backgroundColor: 'var(--primary)' }}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={() => void handleRun()}
            disabled={isRunning}
            className="btn-primary px-5 py-2 text-sm"
          >
            {isRunning ? <LoadingSpinner size={14} /> : <Icon name="PlayIcon" size={14} />}
            {isRunning ? 'Running...' : 'Run Benchmark'}
          </button>
        </div>
      </div>

      {/* CLI bench (container-side) */}
      <div className="card-surface p-5">
        <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
          Container CLI Bench
        </h2>
        <p className="text-xs mb-3" style={{ color: 'var(--muted-foreground)' }}>
          Runs <span className="font-mono">toque cmd bench &lt;count&gt;</span> inside the container
          — measures the container&apos;s own request latency (text output).
        </p>
        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
              Count
            </label>
            <input
              type="number"
              className="input-field px-3 py-2 text-sm font-mono"
              min={1}
              max={100}
              value={cliCount}
              onChange={(e) => setCliCount(Math.max(1, Math.min(100, Number(e.target.value))))}
            />
          </div>
          <button
            onClick={() => void handleCliBench()}
            disabled={isCliRunning}
            className="btn-ghost px-4 py-2 text-sm"
          >
            {isCliRunning ? (
              <LoadingSpinner size={14} />
            ) : (
              <Icon name="CommandLineIcon" size={14} />
            )}
            {isCliRunning ? 'Running...' : 'Run CLI Bench'}
          </button>
        </div>
      </div>

      {/* CLI log */}
      {cliLog.length > 0 && (
        <div className="card-surface overflow-hidden">
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <Icon name="CommandLineIcon" size={13} style={{ color: 'var(--accent)' }} />
              <span
                className="text-xs font-semibold font-mono"
                style={{ color: 'var(--foreground)' }}
              >
                CLI Output
              </span>
            </div>
            <button
              onClick={() => setCliLog([])}
              className="text-xs"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Clear
            </button>
          </div>
          <div
            className="p-4 font-mono text-xs space-y-0.5 overflow-y-auto"
            style={{ backgroundColor: '#050508', maxHeight: '160px' }}
          >
            {cliLog.map((line, i) => (
              <div
                key={`bench-log-${i}`}
                style={{
                  color: line.startsWith('✓')
                    ? 'var(--success)'
                    : line.startsWith('✗')
                      ? 'var(--error)'
                      : line.startsWith('$')
                        ? 'var(--accent)'
                        : 'var(--muted-foreground)',
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results table */}
      <div className="card-surface overflow-hidden">
        <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Results
          </span>
          <span className="ml-2 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
            {runs.length} runs
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {[
                  'Label',
                  'Target',
                  'Iter',
                  'Conc',
                  'Avg',
                  'p50',
                  'p95',
                  'p99',
                  'Min',
                  'Max',
                  'Success',
                  'Status',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left font-semibold"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td
                    colSpan={12}
                    className="px-4 py-6 text-center"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    No runs yet — configure and run a benchmark above
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-3 py-2.5" style={{ color: 'var(--foreground)' }}>
                    {r.label}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--accent)' }}>
                    {r.target}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--foreground)' }}>
                    {r.iterations}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--foreground)' }}>
                    {r.concurrency}
                  </td>
                  <td
                    className="px-3 py-2.5"
                    style={{ color: (r.avgMs ?? 0) > 200 ? 'var(--warning)' : 'var(--success)' }}
                  >
                    {r.avgMs ?? '—'}ms
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--foreground)' }}>
                    {r.p50Ms ?? '—'}ms
                  </td>
                  <td
                    className="px-3 py-2.5"
                    style={{ color: (r.p95Ms ?? 0) > 500 ? 'var(--warning)' : 'var(--foreground)' }}
                  >
                    {r.p95Ms ?? '—'}ms
                  </td>
                  <td
                    className="px-3 py-2.5"
                    style={{ color: (r.p99Ms ?? 0) > 1000 ? 'var(--error)' : 'var(--foreground)' }}
                  >
                    {r.p99Ms ?? '—'}ms
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--success)' }}>
                    {r.minMs ?? '—'}ms
                  </td>
                  <td
                    className="px-3 py-2.5"
                    style={{ color: (r.maxMs ?? 0) > 1000 ? 'var(--error)' : 'var(--foreground)' }}
                  >
                    {r.maxMs ?? '—'}ms
                  </td>
                  <td
                    className="px-3 py-2.5"
                    style={{
                      color: (r.successRate ?? 100) < 90 ? 'var(--error)' : 'var(--success)',
                    }}
                  >
                    {r.successRate !== undefined
                      ? `${r.successRate}% (${r.successCount}/${r.iterations})`
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className="px-2 py-0.5 rounded text-2xs font-semibold"
                      style={{
                        backgroundColor: `${statusColor(r.status)}20`,
                        color: statusColor(r.status),
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Latency histogram for the latest run */}
      {runs.find((r) => r.status === 'done' && r.buckets?.length) && (
        <div className="card-surface p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--foreground)' }}>
            Latency distribution — latest run
          </h3>
          <div className="space-y-1.5">
            {runs
              .find((r) => r.status === 'done' && r.buckets?.length)
              ?.buckets?.map((b) => (
                <div key={b.range} className="flex items-center gap-3">
                  <span
                    className="text-2xs font-mono w-24 shrink-0"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    {b.range}
                  </span>
                  <div
                    className="flex-1 h-3 rounded overflow-hidden"
                    style={{ backgroundColor: 'var(--muted)' }}
                  >
                    <div
                      className="h-full rounded transition-all duration-300"
                      style={{
                        width: `${(b.count / maxBucket) * 100}%`,
                        backgroundColor: 'var(--primary)',
                      }}
                    />
                  </div>
                  <span
                    className="text-2xs font-mono w-8 text-right"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {b.count}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
