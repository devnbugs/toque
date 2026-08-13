'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  canAccessPanel,
  PANEL_PERMISSIONS,
  ROLE_LABELS,
  ROLE_COLORS,
  type Panel,
  type UserRole,
} from '@/lib/rbac';
import SectionCard from '@/components/ui/SectionCard';
import StatusBadge from '@/components/ui/StatusBadge';
import SkeletonBlock from '@/components/ui/SkeletonBlock';
import { createClient } from '@/lib/supabase/client';

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
}

function MetricCard({ label, value, sub, accent, icon, trend }: MetricCardProps) {
  return (
    <div
      className="flex flex-col gap-3 p-5 rounded-xl"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between">
        <span
          className="flex items-center justify-center w-9 h-9 rounded-lg"
          style={{ backgroundColor: `${accent}18`, color: accent }}
        >
          {icon}
        </span>
        {trend && (
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              backgroundColor:
                trend === 'up'
                  ? 'rgba(34,197,94,0.1)'
                  : trend === 'down'
                    ? 'rgba(239,68,68,0.1)'
                    : 'rgba(100,116,139,0.1)',
              color:
                trend === 'up'
                  ? 'var(--success)'
                  : trend === 'down'
                    ? 'var(--error)'
                    : 'var(--muted-foreground)',
            }}
          >
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—'}
          </span>
        )}
      </div>
      <div>
        <p
          className="text-2xl font-bold font-mono tracking-tight"
          style={{ color: 'var(--foreground)' }}
        >
          {value}
        </p>
        <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--foreground)' }}>
          {label}
        </p>
        {sub && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

interface OperationCard {
  panel: Panel;
  label: string;
  href: string;
  description: string;
  accent: string;
  icon: React.ReactNode;
  allowedRoles: UserRole[];
}

const OPERATION_CARDS: OperationCard[] = [
  {
    panel: 'send-visa',
    label: 'Send Visa',
    href: '/send-visa-panel',
    description: 'Batch-dispatch Nusuk visa applications with retry logic and audit trails.',
    accent: '#22c55e',
    allowedRoles: PANEL_PERMISSIONS['send-visa'],
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="w-5 h-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
        />
      </svg>
    ),
  },
  {
    panel: 'schedule',
    label: 'Schedule',
    href: '/schedule-panel',
    description: 'Cron-based job scheduling for automated visa pulls and renewals.',
    accent: '#f59e0b',
    allowedRoles: PANEL_PERMISSIONS['schedule'],
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="w-5 h-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    panel: 'captcha',
    label: 'Captcha',
    href: '/captcha-panel',
    description: 'Automated hCaptcha & reCAPTCHA solving with full lifecycle control.',
    accent: '#6366f1',
    allowedRoles: PANEL_PERMISSIONS['captcha'],
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="w-5 h-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-2.168-.576-4.2-1.598-5.944M12 2.25c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3-1.343-3-3-3z"
        />
      </svg>
    ),
  },
  {
    panel: 'pulling',
    label: 'Pulling',
    href: '/pulling-panel',
    description: 'Intelligent data extraction from Nusuk portals with structured JSON output.',
    accent: '#3b82f6',
    allowedRoles: PANEL_PERMISSIONS['pulling'],
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="w-5 h-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
        />
      </svg>
    ),
  },
  {
    panel: 'benchmarking',
    label: 'Benchmarking',
    href: '/benchmarking-panel',
    description: 'End-to-end performance profiling: throughput, p95/p99 latency, error rates.',
    accent: '#f97316',
    allowedRoles: PANEL_PERMISSIONS['benchmarking'],
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="w-5 h-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
        />
      </svg>
    ),
  },
  {
    panel: 'team-management',
    label: 'Team',
    href: '/team-management',
    description: 'Manage team members, assign roles, and control access permissions.',
    accent: '#a78bfa',
    allowedRoles: PANEL_PERMISSIONS['team-management'],
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="w-5 h-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
        />
      </svg>
    ),
  },
];

interface AuditEntry {
  id: string;
  user_email: string;
  action: string;
  panel: string | null;
  details: Record<string, any>;
  created_at: string;
}

export default function OverviewContent() {
  const { userRole, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [todayStats, setTodayStats] = useState({
    totalSends: 0,
    totalSchedules: 0,
    pendingWorkflows: 0,
    successRate: 0,
    recentErrors: 0,
  });
  const [currentTime, setCurrentTime] = useState('');

  useEffect(() => {
    const now = new Date();
    setCurrentTime(
      now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    );
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const supabase = createClient();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: logs } = await supabase
          .from('audit_logs')
          .select('id, user_email, action, panel, details, created_at')
          .order('created_at', { ascending: false })
          .limit(50);

        const allLogs: AuditEntry[] = logs ?? [];
        setAuditLogs(allLogs.slice(0, 8));

        const todayLogs = allLogs.filter((l) => new Date(l.created_at) >= todayStart);

        const sends = todayLogs.filter(
          (l) => l.panel === 'send-visa' || l.action === 'send'
        ).length;
        const schedules = todayLogs.filter(
          (l) => l.panel === 'schedule' || l.action === 'schedule_create'
        ).length;
        const pending = todayLogs.filter((l) => l.details?.status === 'pending').length;
        const errors = todayLogs.filter(
          (l) => l.details?.status === 'error' || l.details?.status === 'denied'
        ).length;
        const total = todayLogs.length;
        const successCount = todayLogs.filter(
          (l) => l.details?.status === 'success' || l.details?.status === 'granted'
        ).length;
        const rate = total > 0 ? Math.round((successCount / total) * 100) : 100;

        setTodayStats({
          totalSends: sends,
          totalSchedules: schedules,
          pendingWorkflows: pending,
          successRate: rate,
          recentErrors: errors,
        });
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const supabase = createClient();
    const channel = supabase
      .channel('overview-audit-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const actionColor = (action: string, details: Record<string, any>) => {
    if (action === 'login') return '#22c55e';
    if (details?.status === 'denied' || details?.status === 'error') return '#ef4444';
    if (details?.status === 'granted' || details?.status === 'success') return '#6366f1';
    return '#f59e0b';
  };

  const actionLabel = (action: string, details: Record<string, any>) => {
    if (details?.status === 'denied') return 'denied';
    if (details?.status === 'error') return 'error';
    if (details?.status === 'success' || details?.status === 'granted') return 'success';
    return action;
  };

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <SkeletonBlock height={32} width="260px" />
        <SkeletonBlock height={14} width="320px" />
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonBlock key={i} height={120} />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <SkeletonBlock height={340} />
          <SkeletonBlock height={340} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Operations Overview
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            {currentTime} · Real-time metrics from audit log
          </p>
        </div>
        {userRole && (
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${ROLE_COLORS[userRole] ?? ''}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            {ROLE_LABELS[userRole]}
          </span>
        )}
      </div>

      {/* Key Metrics Row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Sends Today"
          value={todayStats.totalSends}
          sub="visa dispatch operations"
          accent="#22c55e"
          trend="neutral"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
              />
            </svg>
          }
        />
        <MetricCard
          label="Schedules Today"
          value={todayStats.totalSchedules}
          sub="scheduled workflows"
          accent="#f59e0b"
          trend="neutral"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
        />
        <MetricCard
          label="Pending Workflows"
          value={todayStats.pendingWorkflows}
          sub="awaiting execution"
          accent="#6366f1"
          trend={todayStats.pendingWorkflows > 5 ? 'up' : 'neutral'}
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
              />
            </svg>
          }
        />
        <MetricCard
          label="Success Rate"
          value={`${todayStats.successRate}%`}
          sub={`${todayStats.recentErrors} error${todayStats.recentErrors !== 1 ? 's' : ''} today`}
          accent={
            todayStats.successRate >= 90
              ? '#22c55e'
              : todayStats.successRate >= 70
                ? '#f59e0b'
                : '#ef4444'
          }
          trend={
            todayStats.successRate >= 90 ? 'up' : todayStats.successRate < 70 ? 'down' : 'neutral'
          }
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          }
        />
      </div>

      {/* Middle row: Recent Errors + Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Recent Errors */}
        <SectionCard
          title="Recent Errors"
          description="Latest denied or failed operations from audit log"
          headerRight={
            <span
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{
                backgroundColor:
                  todayStats.recentErrors > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                color: todayStats.recentErrors > 0 ? 'var(--error)' : 'var(--success)',
                border: `1px solid ${todayStats.recentErrors > 0 ? 'rgba(239,68,68,0.25)' : 'rgba(34,197,94,0.25)'}`,
              }}
            >
              {todayStats.recentErrors} error{todayStats.recentErrors !== 1 ? 's' : ''}
            </span>
          }
        >
          {auditLogs.filter((l) => l.details?.status === 'error' || l.details?.status === 'denied')
            .length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="w-8 h-8"
                style={{ color: 'var(--success)' }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm font-medium" style={{ color: 'var(--success)' }}>
                No errors recorded
              </p>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                All operations running cleanly
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {auditLogs
                .filter((l) => l.details?.status === 'error' || l.details?.status === 'denied')
                .slice(0, 6)
                .map((entry) => (
                  <li
                    key={`err-${entry.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg"
                    style={{
                      backgroundColor: 'rgba(239,68,68,0.05)',
                      border: '1px solid rgba(239,68,68,0.12)',
                    }}
                  >
                    <span className="shrink-0 mt-0.5">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        className="w-4 h-4"
                        style={{ color: 'var(--error)' }}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                        />
                      </svg>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-xs font-semibold font-mono"
                          style={{ color: 'var(--error)' }}
                        >
                          {entry.action}
                        </span>
                        {entry.panel && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-mono"
                            style={{
                              backgroundColor: 'var(--muted)',
                              color: 'var(--muted-foreground)',
                            }}
                          >
                            {entry.panel}
                          </span>
                        )}
                      </div>
                      <p
                        className="text-xs mt-0.5 truncate"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {entry.user_email}
                      </p>
                    </div>
                    <span
                      className="text-xs font-mono shrink-0"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {formatTime(entry.created_at)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </SectionCard>

        {/* Recent Activity */}
        <SectionCard
          title="Recent Activity"
          description="Latest operations across all panels"
          headerRight={
            <span
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{
                backgroundColor: 'var(--muted)',
                color: 'var(--muted-foreground)',
                border: '1px solid var(--border)',
              }}
            >
              Live
            </span>
          }
        >
          {auditLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="w-8 h-8"
                style={{ color: 'var(--muted-foreground)' }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                No activity yet
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {auditLogs.slice(0, 8).map((entry) => (
                <li
                  key={`act-${entry.id}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
                  style={{ backgroundColor: 'var(--input)' }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: actionColor(entry.action, entry.details) }}
                  />
                  <span className="flex-1 min-w-0">
                    <span
                      className="text-xs font-semibold font-mono"
                      style={{ color: actionColor(entry.action, entry.details) }}
                    >
                      {entry.action}
                    </span>
                    {entry.panel && (
                      <span className="ml-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        · {entry.panel}
                      </span>
                    )}
                    <span
                      className="ml-1.5 text-xs truncate"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      · {entry.user_email}
                    </span>
                  </span>
                  <span
                    className="text-xs font-mono shrink-0"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    {formatTime(entry.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Role-Restricted Operation Status Cards */}
      <SectionCard
        title="Operation Access Status"
        description="Quick-access status for each role-restricted panel based on your current role"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {OPERATION_CARDS.map((op) => {
            const allowed = canAccessPanel(userRole, op.panel);
            const requiredRoles = op.allowedRoles.map((r) => ROLE_LABELS[r]).join(', ');
            return (
              <div
                key={`op-${op.panel}`}
                className="relative flex flex-col gap-3 p-4 rounded-xl transition-all duration-150"
                style={{
                  backgroundColor: allowed ? `${op.accent}08` : 'var(--input)',
                  border: `1px solid ${allowed ? `${op.accent}25` : 'var(--border)'}`,
                  opacity: allowed ? 1 : 0.65,
                }}
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span
                    className="flex items-center justify-center w-8 h-8 rounded-lg"
                    style={{
                      backgroundColor: allowed ? `${op.accent}18` : 'rgba(100,116,139,0.1)',
                      color: allowed ? op.accent : 'var(--muted-foreground)',
                    }}
                  >
                    {op.icon}
                  </span>
                  <StatusBadge
                    status={allowed ? 'success' : 'error'}
                    label={allowed ? 'Accessible' : 'Restricted'}
                    size="sm"
                  />
                </div>

                {/* Label + desc */}
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                    {op.label}
                  </p>
                  <p
                    className="text-xs mt-0.5 leading-relaxed"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    {op.description}
                  </p>
                </div>

                {/* Required roles */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    Requires:
                  </span>
                  {op.allowedRoles.map((r) => (
                    <span
                      key={`role-${op.panel}-${r}`}
                      className={`text-xs px-1.5 py-0.5 rounded-full font-semibold border ${ROLE_COLORS[r]}`}
                    >
                      {ROLE_LABELS[r]}
                    </span>
                  ))}
                </div>

                {/* CTA */}
                {allowed ? (
                  <Link
                    href={op.href}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold mt-auto transition-colors"
                    style={{ color: op.accent }}
                  >
                    Open panel
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-3 h-3"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                      />
                    </svg>
                  </Link>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-semibold mt-auto"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                      <path
                        fillRule="evenodd"
                        d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Access denied for {userRole ? ROLE_LABELS[userRole] : 'your role'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
