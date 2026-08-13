import React from 'react';

interface SkeletonBlockProps {
  height?: number | string;
  width?: string;
  className?: string;
}

export default function SkeletonBlock({
  height = 20,
  width = '100%',
  className = '',
}: SkeletonBlockProps) {
  return <div className={`skeleton ${className}`} style={{ height, width }} aria-hidden="true" />;
}
