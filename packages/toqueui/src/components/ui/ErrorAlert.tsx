import React from 'react';
import Icon from './AppIcon';

interface ErrorAlertProps {
  message: string;
  detail?: string;
  onRetry?: () => void;
}

export default function ErrorAlert({ message, detail, onRetry }: ErrorAlertProps) {
  return (
    <div
      className="flex items-start gap-3 p-4 rounded-lg animate-fade-in"
      style={{
        backgroundColor: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.25)',
      }}
      role="alert"
    >
      <Icon
        name="ExclamationTriangleIcon"
        size={16}
        className="shrink-0 mt-0.5"
        style={{ color: 'var(--error)' } as React.CSSProperties}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--error)' }}>
          {message}
        </p>
        {detail && (
          <p className="mt-1 text-xs font-mono" style={{ color: 'rgba(239,68,68,0.7)' }}>
            {detail}
          </p>
        )}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn-ghost shrink-0 px-3 py-1.5 text-xs"
          style={{ color: 'var(--error)', borderColor: 'rgba(239,68,68,0.3)' }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
