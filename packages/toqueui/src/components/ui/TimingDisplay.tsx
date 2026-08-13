import React from 'react';

interface TimingDisplayProps {
  ms: number;
  showLabel?: boolean;
}

export default function TimingDisplay({ ms, showLabel = true }: TimingDisplayProps) {
  const colorClass = ms < 200 ? 'timing-fast' : ms < 1000 ? 'timing-medium' : 'timing-slow';
  const bgColor =
    ms < 200
      ? 'rgba(34,197,94,0.08)'
      : ms < 1000
        ? 'rgba(245,158,11,0.08)'
        : 'rgba(239,68,68,0.08)';

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono font-semibold rounded px-2 py-0.5 ${colorClass}`}
      style={{
        fontSize: '11px',
        backgroundColor: bgColor,
        border: `1px solid currentColor`,
        opacity: 0.9,
      }}
    >
      {ms}ms
      {showLabel && <span style={{ fontSize: '10px', opacity: 0.7 }}>latency</span>}
    </span>
  );
}
