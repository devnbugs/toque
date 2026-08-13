'use client';

import React, { useState, useRef, useEffect } from 'react';
import Icon from '@/components/ui/AppIcon';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { toqueRawRequest } from '@/lib/toque/client';
import { toast } from 'sonner';

interface ChatMessage {
  id: string;
  role: 'user' | 'system' | 'error';
  content: string;
  timestamp: string;
  latencyMs?: number;
  httpStatus?: number;
}

interface MetricPoint {
  label: string;
  value: number | string;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  color: string;
}

const QUICK_COMMANDS = [
  { label: 'Health', cmd: 'GET /health' },
  { label: 'Groups', cmd: 'GET /groups/list' },
  { label: 'Schedule', cmd: 'GET /schedule/get' },
  { label: 'Auth Ping', cmd: 'POST /auth/ping' },
  { label: 'CAPTCHA Status', cmd: 'GET /captcha/status' },
  { label: 'Bench Results', cmd: 'GET /bench/results' },
];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'm0',
    role: 'system',
    content: '# Toque API Terminal — type a command like "GET /health" or "POST /auth/ping"',
    timestamp: '--:--:--',
  },
];

export default function NetworkPanelContent() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [metrics, setMetrics] = useState<MetricPoint[]>([
    {
      label: 'Avg Latency',
      value: '—',
      unit: 'ms',
      trend: 'stable',
      color: 'var(--muted-foreground)',
    },
    { label: 'Requests', value: 0, unit: '', trend: 'stable', color: 'var(--accent)' },
    { label: 'Errors', value: 0, unit: '', trend: 'stable', color: 'var(--muted-foreground)' },
    {
      label: 'Success Rate',
      value: '—',
      unit: '%',
      trend: 'stable',
      color: 'var(--muted-foreground)',
    },
    {
      label: 'Min Latency',
      value: '—',
      unit: 'ms',
      trend: 'stable',
      color: 'var(--muted-foreground)',
    },
    {
      label: 'Max Latency',
      value: '—',
      unit: 'ms',
      trend: 'stable',
      color: 'var(--muted-foreground)',
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const requestCount = useRef(0);
  const errorCount = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateMetrics = (latency: number, success: boolean) => {
    requestCount.current += 1;
    if (!success) errorCount.current += 1;

    setLatencyHistory((prev) => {
      const next = [...prev, latency].slice(-15);
      const avg = Math.round(next.reduce((a, b) => a + b, 0) / next.length);
      const min = Math.min(...next);
      const max = Math.max(...next);
      const successRate = Math.round(
        ((requestCount.current - errorCount.current) / requestCount.current) * 100
      );

      setMetrics([
        {
          label: 'Avg Latency',
          value: avg,
          unit: 'ms',
          trend: avg < 100 ? 'down' : 'up',
          color: avg < 100 ? 'var(--success)' : avg < 300 ? 'var(--warning)' : 'var(--error)',
        },
        {
          label: 'Requests',
          value: requestCount.current,
          unit: '',
          trend: 'up',
          color: 'var(--accent)',
        },
        {
          label: 'Errors',
          value: errorCount.current,
          unit: '',
          trend: errorCount.current > 0 ? 'up' : 'stable',
          color: errorCount.current > 0 ? 'var(--error)' : 'var(--muted-foreground)',
        },
        {
          label: 'Success Rate',
          value: successRate,
          unit: '%',
          trend: successRate > 95 ? 'up' : 'down',
          color:
            successRate > 95
              ? 'var(--success)'
              : successRate > 80
                ? 'var(--warning)'
                : 'var(--error)',
        },
        { label: 'Min Latency', value: min, unit: 'ms', trend: 'stable', color: 'var(--success)' },
        {
          label: 'Max Latency',
          value: max,
          unit: 'ms',
          trend: 'stable',
          color: max > 500 ? 'var(--error)' : 'var(--warning)',
        },
      ]);
      return next;
    });
  };

  const handleSend = async (rawInput?: string) => {
    const cmd = (rawInput ?? input).trim();
    if (!cmd || isSending) return;

    const userMsg: ChatMessage = {
      id: `m${Date.now()}`,
      role: 'user',
      content: cmd,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsSending(true);
    setWsStatus('connected');

    // Parse "METHOD /path [body]"
    const parts = cmd.split(/\s+/);
    const method = parts[0].toUpperCase();
    const path = parts[1] || '/health';
    let body: unknown;
    if (parts.length > 2) {
      try {
        body = JSON.parse(parts.slice(2).join(' '));
      } catch {
        body = undefined;
      }
    }

    const result = await toqueRawRequest(method, path, body);
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });

    const content = result.ok
      ? JSON.stringify(result.data, null, 2)
      : `Error ${result.status || 'ERR'}: ${result.error}`;

    const sysMsg: ChatMessage = {
      id: `m${Date.now() + 1}`,
      role: result.ok ? 'system' : 'error',
      content,
      timestamp: ts,
      latencyMs: result.latencyMs,
      httpStatus: result.status,
    };
    setMessages((prev) => [...prev, sysMsg]);
    updateMetrics(result.latencyMs, result.ok);

    if (result.ok) {
      toast.success(`${method} ${path} → ${result.status} (${result.latencyMs}ms)`);
    } else {
      toast.error(`${method} ${path} → ${result.status || 'ERR'}: ${result.error}`);
    }

    setIsSending(false);
  };

  const maxBar = latencyHistory.length > 0 ? Math.max(...latencyHistory, 1) : 1;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold" style={{ color: 'var(--foreground)' }}>
            Network
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Live API terminal — wired to{' '}
            <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
              toque.decloud.workers.dev
            </span>{' '}
            via real HTTP
          </p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{
            backgroundColor:
              wsStatus === 'connected' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${wsStatus === 'connected' ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
          }}
        >
          <span
            className="w-2 h-2 rounded-full pulse-dot"
            style={{
              backgroundColor: wsStatus === 'connected' ? 'var(--success)' : 'var(--error)',
            }}
          />
          <span
            className="text-xs font-semibold"
            style={{ color: wsStatus === 'connected' ? 'var(--success)' : 'var(--error)' }}
          >
            {wsStatus === 'connected' ? 'Active' : 'Idle'}
          </span>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="card-surface p-3 flex flex-col gap-1">
            <span
              className="text-2xs uppercase tracking-widest"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {m.label}
            </span>
            <div className="flex items-end gap-1">
              <span className="text-xl font-bold font-mono" style={{ color: m.color }}>
                {m.value}
              </span>
              {m.unit && (
                <span className="text-2xs mb-0.5" style={{ color: 'var(--muted-foreground)' }}>
                  {m.unit}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Icon
                name={
                  m.trend === 'up'
                    ? 'ArrowUpIcon'
                    : m.trend === 'down'
                      ? 'ArrowDownIcon'
                      : 'MinusIcon'
                }
                size={10}
              />
              <span className="text-2xs" style={{ color: 'var(--muted-foreground)' }}>
                {m.trend}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Quick commands */}
      <div className="flex gap-2 flex-wrap">
        {QUICK_COMMANDS.map((qc) => (
          <button
            key={qc.cmd}
            onClick={() => handleSend(qc.cmd)}
            disabled={isSending}
            className="px-3 py-1.5 rounded text-xs font-mono font-medium transition-all"
            style={{
              backgroundColor: 'var(--input)',
              color: 'var(--accent)',
              border: '1px solid var(--border)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            {qc.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Chat terminal */}
        <div className="lg:col-span-3 card-surface flex flex-col" style={{ height: '420px' }}>
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <Icon name="CommandLineIcon" size={14} style={{ color: 'var(--accent)' }} />
              <span
                className="text-xs font-semibold font-mono"
                style={{ color: 'var(--foreground)' }}
              >
                API Terminal
              </span>
            </div>
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#22c55e' }} />
            </div>
          </div>
          <div
            className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs"
            style={{ backgroundColor: '#050508' }}
          >
            {messages.map((msg) => (
              <div key={msg.id} className="flex gap-2">
                <span style={{ color: 'var(--muted-foreground)', minWidth: '56px' }}>
                  {msg.timestamp}
                </span>
                <span
                  style={{
                    color:
                      msg.role === 'user'
                        ? 'var(--accent)'
                        : msg.role === 'error'
                          ? 'var(--error)'
                          : 'var(--success)',
                    minWidth: '14px',
                  }}
                >
                  {msg.role === 'user' ? '›' : msg.role === 'error' ? '✗' : '‹'}
                </span>
                <span
                  className="flex-1 break-all whitespace-pre-wrap"
                  style={{
                    color:
                      msg.role === 'user'
                        ? 'var(--foreground)'
                        : msg.role === 'error'
                          ? 'var(--error)'
                          : '#86efac',
                  }}
                >
                  {msg.content}
                </span>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  {msg.httpStatus !== undefined && msg.httpStatus > 0 && (
                    <span
                      style={{
                        color: msg.httpStatus < 300 ? 'var(--success)' : 'var(--error)',
                        minWidth: '36px',
                        textAlign: 'right',
                      }}
                    >
                      {msg.httpStatus}
                    </span>
                  )}
                  {msg.latencyMs !== undefined && (
                    <span
                      style={{
                        color: msg.latencyMs > 150 ? 'var(--warning)' : 'var(--muted-foreground)',
                        minWidth: '48px',
                        textAlign: 'right',
                      }}
                    >
                      {msg.latencyMs}ms
                    </span>
                  )}
                </div>
              </div>
            ))}
            {isSending && (
              <div className="flex gap-2 items-center">
                <span style={{ color: 'var(--muted-foreground)', minWidth: '56px' }}>--:--:--</span>
                <LoadingSpinner size={10} />
                <span style={{ color: 'var(--muted-foreground)' }}>fetching...</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div
            className="flex gap-2 p-3"
            style={{ borderTop: '1px solid var(--border)', backgroundColor: '#050508' }}
          >
            <span className="font-mono text-xs self-center" style={{ color: 'var(--accent)' }}>
              ›
            </span>
            <input
              className="flex-1 bg-transparent font-mono text-xs outline-none"
              style={{ color: 'var(--foreground)' }}
              placeholder="GET /health  |  POST /auth/ping  |  GET /groups/list"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={isSending}
            />
            <button
              onClick={() => handleSend()}
              disabled={isSending || !input.trim()}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              Send
            </button>
          </div>
        </div>

        {/* Latency chart */}
        <div className="lg:col-span-2 card-surface flex flex-col" style={{ height: '420px' }}>
          <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
              Latency History
            </span>
            <p className="text-2xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
              Last {latencyHistory.length} requests (ms)
            </p>
          </div>
          <div className="flex-1 p-4 flex flex-col justify-end gap-1">
            {latencyHistory.length === 0 ? (
              <div
                className="flex-1 flex items-center justify-center text-xs"
                style={{ color: 'var(--muted-foreground)' }}
              >
                Send requests to see latency chart
              </div>
            ) : (
              <div className="flex items-end gap-1.5 h-48">
                {latencyHistory.map((val, i) => (
                  <div key={`bar-${i}`} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t transition-all"
                      style={{
                        height: `${(val / maxBar) * 100}%`,
                        backgroundColor:
                          val > 300
                            ? 'var(--error)'
                            : val > 100
                              ? 'var(--warning)'
                              : 'var(--success)',
                        opacity: 0.8,
                        minHeight: '4px',
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between mt-2">
              <span className="text-2xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                oldest
              </span>
              <span className="text-2xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                latest
              </span>
            </div>
            <div className="flex gap-4 mt-3">
              {[
                { label: '< 100ms', color: 'var(--success)' },
                { label: '100–300ms', color: 'var(--warning)' },
                { label: '> 300ms', color: 'var(--error)' },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: l.color }} />
                  <span className="text-2xs" style={{ color: 'var(--muted-foreground)' }}>
                    {l.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
