'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import AppLogo from './ui/AppLogo';
import Icon from './ui/AppIcon';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessPanel, ROLE_LABELS, ROLE_COLORS, type Panel } from '@/lib/rbac';
import { createClient } from '@/lib/supabase/client';

interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string | number;
  badgeVariant?: 'primary' | 'warning' | 'success' | 'error';
  group?: string;
  panel?: Panel;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', icon: 'HomeIcon', group: 'Navigation' },
  { label: 'Overview', href: '/overview', icon: 'Squares2X2Icon', group: 'Navigation' },
  {
    label: 'Authentication',
    href: '/dashboard',
    icon: 'KeyIcon',
    group: 'Operations',
    panel: 'dashboard',
  },
  {
    label: 'Send Visa',
    href: '/send-visa-panel',
    icon: 'PaperAirplaneIcon',
    group: 'Operations',
    panel: 'send-visa',
  },
  {
    label: 'Schedule',
    href: '/schedule-panel',
    icon: 'ClockIcon',
    badge: 2,
    badgeVariant: 'primary',
    group: 'Operations',
    panel: 'schedule',
  },
  {
    label: 'Pulling',
    href: '/pulling-panel',
    icon: 'ArrowDownTrayIcon',
    group: 'Operations',
    panel: 'pulling',
  },
  {
    label: 'Captcha',
    href: '/captcha-panel',
    icon: 'ShieldCheckIcon',
    group: 'Operations',
    panel: 'captcha',
  },
  {
    label: 'Network',
    href: '/network-panel',
    icon: 'SignalIcon',
    group: 'Monitoring',
    panel: 'network',
  },
  {
    label: 'Benchmarking',
    href: '/benchmarking-panel',
    icon: 'ChartBarIcon',
    group: 'Monitoring',
    panel: 'benchmarking',
  },
  {
    label: 'API Builder',
    href: '/api-builder',
    icon: 'CodeBracketIcon',
    group: 'Developer',
    panel: 'api-builder',
  },
  {
    label: 'Team',
    href: '/team-management',
    icon: 'UsersIcon',
    group: 'Admin',
    panel: 'team-management',
  },
  { label: 'Login', href: '/login', icon: 'ArrowRightOnRectangleIcon', group: 'Access' },
];

const BADGE_COLORS: Record<string, string> = {
  primary: 'bg-primary/10 text-accent border border-primary/20',
  warning: 'bg-warning/10 text-warning border border-warning/20',
  success: 'bg-success/10 text-success border border-success/20',
  error: 'bg-error/10 text-error border border-error/20',
};

interface AuditEntry {
  id: string;
  user_email: string;
  action: string;
  panel: string | null;
  details: Record<string, any>;
  created_at: string;
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  activeRoute: string;
  onNavigate?: () => void;
}

export default function Sidebar({ collapsed, onToggle, activeRoute, onNavigate }: SidebarProps) {
  const { userRole } = useAuth();
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  const groups = Array.from(new Set(NAV_ITEMS.map((i) => i.group)));

  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from('audit_logs')
        .select('id, user_email, action, panel, details, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      setAuditLogs(data ?? []);
    } catch {
      // silently fail
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (!auditOpen) return;

    fetchAuditLogs();

    const supabase = createClient();
    const channel = supabase
      .channel('sidebar-audit-logs')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_logs' },
        (payload) => {
          const newEntry = payload.new as AuditEntry;
          setAuditLogs((prev) => [newEntry, ...prev].slice(0, 20));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [auditOpen]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const actionColor = (action: string, details: Record<string, any>) => {
    if (action === 'login') return 'text-green-400';
    if (details?.status === 'denied') return 'text-red-400';
    if (details?.status === 'granted') return 'text-blue-400';
    return 'text-yellow-400';
  };

  return (
    <aside
      className="flex flex-col h-full shrink-0 transition-all duration-300 ease-in-out overflow-hidden"
      style={{
        width: collapsed ? '64px' : '240px',
        backgroundColor: 'var(--card)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Logo + collapse icon in header */}
      <div
        className="flex items-center justify-between h-14 px-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <AppLogo size={28} />
          {!collapsed && (
            <span
              className="font-semibold text-lg tracking-tight truncate"
              style={{ color: 'var(--foreground)', fontFamily: 'var(--font-sans)' }}
            >
              ToqueUI
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          className="btn-ghost p-1.5 rounded-md shrink-0 transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ marginLeft: collapsed ? 'auto' : '0' }}
        >
          <Icon name={collapsed ? 'Bars3Icon' : 'ChevronDoubleLeftIcon'} size={16} />
        </button>
      </div>

      {/* Role badge */}
      {!collapsed && userRole && (
        <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${ROLE_COLORS[userRole] ?? 'text-purple-400 bg-purple-400/10 border-purple-400/20'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            {ROLE_LABELS[userRole] ?? userRole}
          </span>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto overflow-x-hidden">
        {groups.map((group) => {
          const groupItems = NAV_ITEMS.filter((i) => i.group === group);
          return (
            <div key={group} className="mb-3">
              {!collapsed && (
                <p
                  className="px-2 mb-1.5 uppercase tracking-widest font-semibold"
                  style={{
                    fontSize: '10px',
                    color: 'var(--muted-foreground)',
                    letterSpacing: '0.1em',
                  }}
                >
                  {group}
                </p>
              )}
              <ul className="space-y-0.5 list-none p-0 m-0">
                {groupItems.map((item) => {
                  const isActive = activeRoute === item.href;
                  const hasPanel = !!item.panel;
                  const allowed =
                    hasPanel && userRole !== null
                      ? canAccessPanel(userRole, item.panel as Panel)
                      : true;
                  return (
                    <li key={`nav-${item.href}`}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        onClick={() => onNavigate?.()}
                        className={`sidebar-item ${isActive ? 'active' : ''} ${!allowed ? 'opacity-40 pointer-events-none' : ''}`}
                        style={{ fontSize: '13px', fontWeight: isActive ? 600 : 400 }}
                        aria-disabled={!allowed}
                        tabIndex={!allowed ? -1 : undefined}
                      >
                        <span className="shrink-0 relative">
                          <Icon
                            name={item.icon as Parameters<typeof Icon>[0]['name']}
                            size={18}
                            variant={isActive ? 'solid' : 'outline'}
                          />
                          {!allowed && !collapsed && (
                            <span
                              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500"
                              title="Restricted"
                            />
                          )}
                        </span>
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate">{item.label}</span>
                            {!allowed && (
                              <span className="text-red-400 shrink-0" title="Access restricted">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path
                                    fillRule="evenodd"
                                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              </span>
                            )}
                            {allowed && item.badge !== undefined && (
                              <span
                                className={`text-2xs px-1.5 py-0.5 rounded-full font-mono font-semibold ${BADGE_COLORS[item.badgeVariant ?? 'primary']}`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Audit Log section */}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <button
          onClick={() => setAuditOpen((prev) => !prev)}
          className="w-full flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/5"
          title={collapsed ? 'Audit Log' : undefined}
          style={{ color: 'var(--muted-foreground)' }}
        >
          <span className="shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 text-left text-xs font-semibold uppercase tracking-wider">
                Audit Log
              </span>
              <svg
                className={`w-3 h-3 transition-transform ${auditOpen ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </>
          )}
        </button>

        {auditOpen && !collapsed && (
          <div
            className="px-2 pb-2 max-h-56 overflow-y-auto"
            style={{ backgroundColor: 'var(--background)' }}
          >
            {auditLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : auditLogs.length === 0 ? (
              <p className="text-xs text-center py-3" style={{ color: 'var(--muted-foreground)' }}>
                No audit entries yet
              </p>
            ) : (
              <ul className="space-y-1 list-none p-0 m-0">
                {auditLogs.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-md px-2 py-1.5"
                    style={{ backgroundColor: 'var(--card)' }}
                  >
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span
                        className={`text-xs font-mono font-semibold ${actionColor(entry.action, entry.details)}`}
                      >
                        {entry.action}
                        {entry.panel ? `/${entry.panel}` : ''}
                      </span>
                      <span
                        className="text-xs font-mono"
                        style={{ color: 'var(--muted-foreground)', fontSize: '10px' }}
                      >
                        {formatTime(entry.created_at)}
                      </span>
                    </div>
                    <p
                      className="truncate"
                      style={{ color: 'var(--muted-foreground)', fontSize: '10px' }}
                    >
                      {entry.user_email}
                      {entry.details?.status ? ` · ${entry.details.status}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={fetchAuditLogs}
              className="mt-1.5 w-full text-center text-xs py-1 rounded transition-colors hover:bg-white/5"
              style={{ color: 'var(--muted-foreground)' }}
            >
              ↻ Refresh
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
