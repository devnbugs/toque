'use client';

import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (val: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}

export default function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
}: ToggleProps) {
  const toggleId = id ?? `toggle-${label?.toLowerCase().replace(/\s+/g, '-') ?? 'switch'}`;

  return (
    <div className="flex items-center gap-3">
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        id={toggleId}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`toggle-track ${checked ? 'on' : 'off'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        type="button"
      >
        <span className={`toggle-thumb ${checked ? 'on' : 'off'}`} />
      </button>
      {(label || description) && (
        <label htmlFor={toggleId} className="cursor-pointer select-none">
          {label && (
            <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              {label}
            </span>
          )}
          {description && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
              {description}
            </p>
          )}
        </label>
      )}
    </div>
  );
}
