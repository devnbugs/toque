import React from 'react';

type StatusVariant =
  | 'success'
  | 'error'
  | 'warning'
  | 'primary'
  | 'muted'
  | 'pending'
  | 'running'
  | 'cancelled'
  | 'connected'
  | 'disconnected'
  | 'checking';

const VARIANT_STYLES: Record<
  StatusVariant,
  { bg: string; text: string; border: string; dot: string }
> = {
  success: {
    bg: 'rgba(34,197,94,0.1)',
    text: 'var(--success)',
    border: 'rgba(34,197,94,0.25)',
    dot: 'var(--success)',
  },
  error: {
    bg: 'rgba(239,68,68,0.1)',
    text: 'var(--error)',
    border: 'rgba(239,68,68,0.25)',
    dot: 'var(--error)',
  },
  warning: {
    bg: 'rgba(245,158,11,0.1)',
    text: 'var(--warning)',
    border: 'rgba(245,158,11,0.25)',
    dot: 'var(--warning)',
  },
  primary: {
    bg: 'rgba(99,102,241,0.1)',
    text: 'var(--accent)',
    border: 'rgba(99,102,241,0.25)',
    dot: 'var(--primary)',
  },
  muted: {
    bg: 'rgba(100,116,139,0.1)',
    text: 'var(--muted-foreground)',
    border: 'rgba(100,116,139,0.2)',
    dot: 'var(--muted-foreground)',
  },
  pending: {
    bg: 'rgba(245,158,11,0.1)',
    text: 'var(--warning)',
    border: 'rgba(245,158,11,0.25)',
    dot: 'var(--warning)',
  },
  running: {
    bg: 'rgba(99,102,241,0.1)',
    text: 'var(--accent)',
    border: 'rgba(99,102,241,0.25)',
    dot: 'var(--primary)',
  },
  cancelled: {
    bg: 'rgba(100,116,139,0.08)',
    text: 'var(--muted-foreground)',
    border: 'rgba(100,116,139,0.15)',
    dot: 'var(--muted-foreground)',
  },
  connected: {
    bg: 'rgba(34,197,94,0.1)',
    text: 'var(--success)',
    border: 'rgba(34,197,94,0.25)',
    dot: 'var(--success)',
  },
  disconnected: {
    bg: 'rgba(100,116,139,0.1)',
    text: 'var(--muted-foreground)',
    border: 'rgba(100,116,139,0.2)',
    dot: 'var(--muted-foreground)',
  },
  checking: {
    bg: 'rgba(245,158,11,0.1)',
    text: 'var(--warning)',
    border: 'rgba(245,158,11,0.25)',
    dot: 'var(--warning)',
  },
};

interface StatusBadgeProps {
  status: StatusVariant;
  label?: string;
  showDot?: boolean;
  size?: 'sm' | 'md';
}

export default function StatusBadge({
  status,
  label,
  showDot = true,
  size = 'sm',
}: StatusBadgeProps) {
  const styles = VARIANT_STYLES[status] ?? VARIANT_STYLES.muted;
  const displayLabel = label ?? status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span
      className="inline-flex items-center gap-1.5 font-semibold rounded-full"
      style={{
        backgroundColor: styles.bg,
        color: styles.text,
        border: `1px solid ${styles.border}`,
        fontSize: size === 'sm' ? '11px' : '12px',
        padding: size === 'sm' ? '2px 8px' : '3px 10px',
        letterSpacing: '0.02em',
      }}
    >
      {showDot && (
        <span
          className="inline-block rounded-full shrink-0"
          style={{ width: 6, height: 6, backgroundColor: styles.dot }}
        />
      )}
      {displayLabel}
    </span>
  );
}
