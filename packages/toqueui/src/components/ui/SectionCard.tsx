import React from 'react';

interface SectionCardProps {
  title?: string;
  description?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export default function SectionCard({
  title,
  description,
  headerRight,
  children,
  className = '',
  noPadding = false,
}: SectionCardProps) {
  return (
    <div
      className={`card-surface ${className}`}
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      {(title || headerRight) && (
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            {title && (
              <h3 className="font-semibold text-base" style={{ color: 'var(--foreground)' }}>
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {description}
              </p>
            )}
          </div>
          {headerRight && <div className="flex items-center gap-2">{headerRight}</div>}
        </div>
      )}
      <div className={noPadding ? '' : 'p-5'}>{children}</div>
    </div>
  );
}
