'use client';

import React, { useEffect, useState } from 'react';
import Icon from './ui/AppIcon';
import { useTheme } from '@/context/ThemeContext';
import { useAuditMetrics } from '@/hooks/useAuditMetrics';

interface TopHeaderProps {
  sidebarCollapsed: boolean;
  onMobileMenu?: () => void;
}

export default function TopHeader({ sidebarCollapsed: _, onMobileMenu }: TopHeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const [baseUrl, setBaseUrl] = useState('https://toque.decloud.workers.dev');
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'disconnected' | 'checking'
  >('disconnected');
  const [lastChecked, setLastChecked] = useState('');
  const metrics = useAuditMetrics();

  useEffect(() => {
    const stored = localStorage.getItem('toque_base_url');
    if (stored) setBaseUrl(stored);
    const storedStatus = localStorage.getItem('toque_connection_status') as
      typeof connectionStatus | null;
    if (storedStatus) setConnectionStatus(storedStatus);
    setLastChecked(new Date().toLocaleTimeString('en-US', { hour12: false }));
  }, []);

  const statusConfig = {
    connected: { color: 'var(--success)', label: 'Connected', dotClass: 'pulse-dot' },
    disconnected: { color: 'var(--muted-foreground)', label: 'Disconnected', dotClass: '' },
    checking: { color: 'var(--warning)', label: 'Checking...', dotClass: '' },
  };

  const status = statusConfig[connectionStatus];

  const successRateColor =
    metrics.successRate === null
      ? 'var(--muted-foreground)'
      : metrics.successRate >= 90
        ? 'var(--success)'
        : metrics.successRate >= 70
          ? 'var(--warning)'
          : 'var(--destructive)';

  return (
    <header
      className="flex items-center justify-between h-14 px-6 shrink-0 gap-4"
      style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--border)' }}
    >
      {/* Left: mobile menu + base URL */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMobileMenu}
          className="btn-ghost p-1.5 rounded-md shrink-0 md:hidden"
          aria-label="Open menu"
        >
          <Icon name="Bars3Icon" size={18} />
        </button>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded font-mono text-xs"
          style={{
            backgroundColor: 'var(--input)',
            border: '1px solid var(--border)',
            color: 'var(--muted-foreground)',
          }}
        >
          <Icon name="GlobeAltIcon" size={13} />
          <span
            className="truncate max-w-[140px] sm:max-w-[220px]"
            style={{ color: 'var(--foreground)' }}
          >
            {baseUrl}
          </span>
        </div>
      </div>

      {/* Center: real-time audit metrics (hidden on small screens to prevent overflow) */}
      <div className="hidden md:flex items-center gap-3 flex-shrink-0">
        {/* Success Rate */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono"
          style={{ backgroundColor: 'var(--muted)', border: '1px solid var(--border)' }}
          title="Success rate (last 5 min)"
        >
          <Icon name="CheckCircleIcon" size={12} style={{ color: successRateColor }} />
          <span style={{ color: 'var(--muted-foreground)' }}>SR</span>
          <span className="font-semibold" style={{ color: successRateColor }}>
            {metrics.isLoading
              ? '—'
              : metrics.successRate === null
                ? 'N/A'
                : `${metrics.successRate}%`}
          </span>
        </div>

        {/* Error Count */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono"
          style={{ backgroundColor: 'var(--muted)', border: '1px solid var(--border)' }}
          title="Error count (last 5 min)"
        >
          <Icon
            name="ExclamationCircleIcon"
            size={12}
            style={{
              color: metrics.errorCount > 0 ? 'var(--destructive)' : 'var(--muted-foreground)',
            }}
          />
          <span style={{ color: 'var(--muted-foreground)' }}>ERR</span>
          <span
            className="font-semibold"
            style={{ color: metrics.errorCount > 0 ? 'var(--destructive)' : 'var(--foreground)' }}
          >
            {metrics.isLoading ? '—' : metrics.errorCount}
          </span>
        </div>

        {/* Throughput */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono"
          style={{ backgroundColor: 'var(--muted)', border: '1px solid var(--border)' }}
          title="Sends per minute (last 60s)"
        >
          <Icon name="BoltIcon" size={12} style={{ color: 'var(--muted-foreground)' }} />
          <span style={{ color: 'var(--muted-foreground)' }}>TPM</span>
          <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
            {metrics.isLoading ? '—' : metrics.throughput}
          </span>
        </div>
      </div>

      {/* Right: status + timestamp + theme toggle */}
      <div className="flex items-center gap-4">
        {lastChecked && (
          <span
            className="hidden lg:inline text-xs font-mono"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Checked {lastChecked}
          </span>
        )}
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${status.dotClass}`}
            style={{ backgroundColor: status.color }}
          />
          <span className="text-xs font-semibold" style={{ color: status.color }}>
            {status.label}
          </span>
        </div>
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono"
          style={{
            backgroundColor: 'var(--muted)',
            color: 'var(--muted-foreground)',
            border: '1px solid var(--border)',
          }}
        >
          <Icon name="KeyIcon" size={12} />
          <span>API Key</span>
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="btn-ghost px-2.5 py-1.5"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? (
            <Icon name="SunIcon" size={16} />
          ) : (
            <Icon name="MoonIcon" size={16} />
          )}
        </button>
      </div>
    </header>
  );
}
