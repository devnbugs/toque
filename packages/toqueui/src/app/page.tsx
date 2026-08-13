'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppLogo from '@/components/ui/AppLogo';

const STATS = [
  { value: '99.97%', label: 'Uptime SLA' },
  { value: '<200ms', label: 'Avg Latency' },
  { value: '50K+', label: 'Visas Processed' },
  { value: '3-region', label: 'MEA Coverage' },
];

const FEATURES = [
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-6 h-6"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-2.168-.576-4.2-1.598-5.944M12 2.25c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3-1.343-3-3-3z"
        />
      </svg>
    ),
    title: 'CAPTCHA Engine',
    desc: 'Automated hCaptcha & reCAPTCHA solving with a 3-worker pool. Pull, watch, start, stop, set, solve — full lifecycle control.',
    tag: 'CAPTCHA',
    span: 'col-span-1 row-span-1',
    accent: '#6366f1',
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-6 h-6"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
        />
      </svg>
    ),
    title: 'Visa Dispatch',
    desc: 'Batch-send Nusuk visa applications with real-time status tracking, retry logic, and per-applicant audit trails.',
    tag: 'SEND',
    span: 'col-span-1 row-span-2',
    accent: '#22c55e',
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-6 h-6"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    title: 'Scheduler',
    desc: 'Cron-based job scheduling for automated visa pulls, renewals, and status checks across time zones.',
    tag: 'SCHEDULE',
    span: 'col-span-1 row-span-1',
    accent: '#f59e0b',
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-6 h-6"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
        />
      </svg>
    ),
    title: 'Data Pulling',
    desc: 'Intelligent data extraction from Nusuk portals with pagination, deduplication, and structured JSON output.',
    tag: 'PULL',
    span: 'col-span-1 row-span-1',
    accent: '#3b82f6',
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-6 h-6"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"
        />
      </svg>
    ),
    title: 'Network Monitor',
    desc: 'Live proxy health checks, latency heatmaps, and geo-routing across MEA regions for maximum throughput.',
    tag: 'NETWORK',
    span: 'col-span-1 row-span-1',
    accent: '#ec4899',
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-6 h-6"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
        />
      </svg>
    ),
    title: 'API Builder',
    desc: 'Visual REST API constructor with auth header injection, response schema validation, and one-click cURL export.',
    tag: 'API',
    span: 'col-span-1 row-span-1',
    accent: '#a78bfa',
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-6 h-6"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
        />
      </svg>
    ),
    title: 'Benchmarking',
    desc: 'End-to-end performance profiling: request throughput, p95/p99 latency, error rates, and worker efficiency scores.',
    tag: 'BENCH',
    span: 'col-span-1 row-span-1',
    accent: '#f97316',
  },
];

const TERMINAL_LINES = [
  { text: '$ toque auth --mode api-key --url https://toque.decloud.workers.dev', color: '#a78bfa' },
  { text: '✓ Connection established — container healthy (142ms)', color: '#22c55e' },
  { text: '$ toque captcha pull --limit 10', color: '#a78bfa' },
  { text: '✓ Pulled 7 pending hCaptcha challenges', color: '#22c55e' },
  { text: '$ toque visa send --batch applicants.json', color: '#a78bfa' },
  { text: '→ Processing 24 applicants...', color: '#94a3b8' },
  { text: '✓ 22 submitted  ✗ 2 retrying  ⏳ queue: 0', color: '#22c55e' },
  { text: '$ toque network status --region MEA', color: '#a78bfa' },
  { text: '✓ 8/8 proxies healthy  avg: 187ms  region: SA-EAST', color: '#22c55e' },
];

export default function HomePage() {
  const [visibleLines, setVisibleLines] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleLines(i);
      if (i >= TERMINAL_LINES?.length) clearInterval(interval);
    }, 320);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundColor: '#0a0a0f',
        color: '#e2e8f0',
        fontFamily: 'DM Sans, system-ui, sans-serif',
      }}
    >
      {/* ── NAV ── */}
      <nav
        className="flex items-center justify-between px-6 md:px-12 h-16 shrink-0 sticky top-0 z-50"
        style={{
          backgroundColor: 'rgba(10,10,15,0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-center gap-3">
          <AppLogo size={28} />
          <span className="font-semibold text-lg tracking-tight" style={{ color: '#f1f5f9' }}>
            ToqueUI
          </span>
          <span
            className="hidden sm:inline-block text-xs font-mono px-2 py-0.5 rounded"
            style={{
              backgroundColor: 'rgba(99,102,241,0.15)',
              color: '#818cf8',
              border: '1px solid rgba(99,102,241,0.25)',
            }}
          >
            v2.0
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-medium px-4 py-2 rounded-lg transition-all duration-150"
            style={{ color: '#94a3b8' }}
          >
            Sign in
          </Link>
          <Link
            href="/dashboard"
            className="text-sm font-semibold px-4 py-2 rounded-lg transition-all duration-150"
            style={{ backgroundColor: '#6366f1', color: 'white' }}
          >
            Open Dashboard
          </Link>
        </div>
      </nav>
      {/* ── HERO ── */}
      <section className="relative flex-1 flex flex-col items-center justify-center px-6 pt-20 pb-16 overflow-hidden">
        {/* Background layers */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.18) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(168,85,247,0.08) 0%, transparent 60%)',
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* Badge */}
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-medium mb-6"
          style={{
            backgroundColor: 'rgba(99,102,241,0.12)',
            color: '#818cf8',
            border: '1px solid rgba(99,102,241,0.25)',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Nusuk Visa Operations · Cloudflare Worker Backend
        </div>

        {/* Headline */}
        <h1
          className="text-4xl md:text-6xl lg:text-7xl font-bold text-center leading-[1.08] tracking-tight max-w-4xl mb-6"
          style={{ color: '#f8fafc' }}
        >
          Command Center for{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, #818cf8 0%, #a78bfa 50%, #c084fc 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Visa Operations
          </span>
        </h1>

        <p
          className="text-base md:text-lg text-center max-w-2xl mb-10 leading-relaxed"
          style={{ color: '#94a3b8' }}
        >
          ToqueUI wraps the Toque Cloudflare Worker API into a full-featured operations dashboard —
          CAPTCHA management, visa dispatch, scheduling, network monitoring, and more. All in one
          place.
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3 mb-16">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-200"
            style={{
              backgroundColor: '#6366f1',
              color: 'white',
              boxShadow: '0 0 24px rgba(99,102,241,0.35)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
              />
            </svg>
            Open Work Dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-200"
            style={{
              backgroundColor: 'rgba(255,255,255,0.06)',
              color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
              />
            </svg>
            Sign In
          </Link>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl mb-16">
          {STATS?.map((s) => (
            <div
              key={s?.label}
              className="flex flex-col items-center gap-1 p-4 rounded-xl"
              style={{
                backgroundColor: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
              }}
            >
              <span className="text-2xl font-bold font-mono" style={{ color: '#f1f5f9' }}>
                {s?.value}
              </span>
              <span className="text-xs" style={{ color: '#64748b' }}>
                {s?.label}
              </span>
            </div>
          ))}
        </div>

        {/* Terminal preview */}
        <div
          className="w-full max-w-2xl rounded-2xl overflow-hidden"
          style={{
            backgroundColor: '#0d0d14',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          }}
        >
          {/* Terminal chrome */}
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ backgroundColor: '#13131c', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ef4444' }} />
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#22c55e' }} />
            <span className="ml-3 text-xs font-mono" style={{ color: '#475569' }}>
              toque-cli — bash
            </span>
          </div>
          <div className="p-5 font-mono text-sm space-y-1.5 min-h-[200px]">
            {mounted &&
              TERMINAL_LINES?.slice(0, visibleLines)?.map((line, i) => (
                <div key={i} style={{ color: line?.color, opacity: 1 }}>
                  {line?.text}
                </div>
              ))}
            {mounted && visibleLines < TERMINAL_LINES?.length && (
              <span
                className="inline-block w-2 h-4 animate-pulse"
                style={{ backgroundColor: '#6366f1' }}
              />
            )}
          </div>
        </div>
      </section>
      {/* ── FEATURES BENTO ── */}
      <section className="px-6 md:px-12 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12">
            <p
              className="text-xs font-mono uppercase tracking-widest mb-3"
              style={{ color: '#6366f1' }}
            >
              Capabilities
            </p>
            <h2 className="text-3xl md:text-4xl font-bold" style={{ color: '#f1f5f9' }}>
              Everything the Toque API exposes,
              <br />
              <span style={{ color: '#94a3b8' }}>surfaced in one dashboard.</span>
            </h2>
          </div>

          {/* Bento grid — varied sizes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Large card — CAPTCHA */}
            <div
              className="md:col-span-2 p-6 rounded-2xl flex flex-col gap-4"
              style={{
                backgroundColor: 'rgba(99,102,241,0.06)',
                border: '1px solid rgba(99,102,241,0.15)',
              }}
            >
              <div className="flex items-start justify-between">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
                >
                  {FEATURES?.[0]?.icon}
                </div>
                <span
                  className="text-xs font-mono px-2 py-1 rounded"
                  style={{
                    backgroundColor: 'rgba(99,102,241,0.12)',
                    color: '#818cf8',
                    border: '1px solid rgba(99,102,241,0.2)',
                  }}
                >
                  {FEATURES?.[0]?.tag}
                </span>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: '#f1f5f9' }}>
                  {FEATURES?.[0]?.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: '#64748b' }}>
                  {FEATURES?.[0]?.desc}
                </p>
              </div>
              {/* Mini op buttons */}
              <div className="flex flex-wrap gap-2 mt-auto">
                {['pull', 'watch', 'start', 'stop', 'set', 'solve', 'status']?.map((op) => (
                  <span
                    key={op}
                    className="text-xs font-mono px-2.5 py-1 rounded-md"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      color: '#94a3b8',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {op}
                  </span>
                ))}
              </div>
            </div>

            {/* Tall card — Visa Dispatch */}
            <div
              className="md:row-span-2 p-6 rounded-2xl flex flex-col gap-4"
              style={{
                backgroundColor: 'rgba(34,197,94,0.05)',
                border: '1px solid rgba(34,197,94,0.12)',
              }}
            >
              <div className="flex items-start justify-between">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
                >
                  {FEATURES?.[1]?.icon}
                </div>
                <span
                  className="text-xs font-mono px-2 py-1 rounded"
                  style={{
                    backgroundColor: 'rgba(34,197,94,0.1)',
                    color: '#22c55e',
                    border: '1px solid rgba(34,197,94,0.2)',
                  }}
                >
                  {FEATURES?.[1]?.tag}
                </span>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: '#f1f5f9' }}>
                  {FEATURES?.[1]?.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: '#64748b' }}>
                  {FEATURES?.[1]?.desc}
                </p>
              </div>
              {/* Fake status list */}
              <div className="mt-auto space-y-2">
                {[
                  { name: 'Ahmed Al-Rashid', status: '✓ Submitted', color: '#22c55e' },
                  { name: 'Fatima Hassan', status: '✓ Submitted', color: '#22c55e' },
                  { name: 'Omar Khalid', status: '⏳ Retrying', color: '#f59e0b' },
                  { name: 'Sara Mohammed', status: '✓ Submitted', color: '#22c55e' },
                ]?.map((a) => (
                  <div
                    key={a?.name}
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-xs"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <span style={{ color: '#94a3b8' }}>{a?.name}</span>
                    <span style={{ color: a?.color }}>{a?.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Remaining feature cards */}
            {FEATURES?.slice(2)?.map((f) => (
              <div
                key={f?.title}
                className="p-5 rounded-2xl flex flex-col gap-3"
                style={{ backgroundColor: `${f?.accent}08`, border: `1px solid ${f?.accent}18` }}
              >
                <div className="flex items-start justify-between">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: `${f?.accent}15`, color: f?.accent }}
                  >
                    {f?.icon}
                  </div>
                  <span
                    className="text-xs font-mono px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: `${f?.accent}12`,
                      color: f?.accent,
                      border: `1px solid ${f?.accent}25`,
                    }}
                  >
                    {f?.tag}
                  </span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-1" style={{ color: '#f1f5f9' }}>
                    {f?.title}
                  </h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#64748b' }}>
                    {f?.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* ── CTA SECTION ── */}
      <section className="px-6 md:px-12 py-20">
        <div
          className="max-w-4xl mx-auto rounded-3xl p-10 md:p-16 text-center relative overflow-hidden"
          style={{
            backgroundColor: 'rgba(99,102,241,0.08)',
            border: '1px solid rgba(99,102,241,0.2)',
          }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.15) 0%, transparent 70%)',
            }}
          />
          <div className="relative">
            <p
              className="text-xs font-mono uppercase tracking-widest mb-4"
              style={{ color: '#818cf8' }}
            >
              Ready to operate
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: '#f8fafc' }}>
              Start processing visas now
            </h2>
            <p className="text-base mb-8 max-w-lg mx-auto" style={{ color: '#94a3b8' }}>
              Connect your Toque Worker endpoint, authenticate, and get full control over your Nusuk
              visa pipeline in minutes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-semibold transition-all duration-200"
                style={{
                  backgroundColor: '#6366f1',
                  color: 'white',
                  boxShadow: '0 0 32px rgba(99,102,241,0.4)',
                }}
              >
                Sign In to Dashboard
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-semibold transition-all duration-200"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  color: '#e2e8f0',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                Explore Dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>
      {/* ── FOOTER ── */}
      <footer
        className="px-6 md:px-12 py-8"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <AppLogo size={20} />
            <span className="text-sm font-medium" style={{ color: '#475569' }}>
              ToqueUI
            </span>
            <span className="text-xs font-mono" style={{ color: '#334155' }}>
              · Nusuk Visa Operations
            </span>
          </div>
          <div className="flex items-center gap-6 text-xs" style={{ color: '#475569' }}>
            <Link href="/dashboard" className="hover:text-slate-300 transition-colors">
              Dashboard
            </Link>
            <Link href="/login" className="hover:text-slate-300 transition-colors">
              Login
            </Link>
            <span>TLS 1.3 · End-to-end encrypted</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
