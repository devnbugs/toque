'use client';

import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from './AppIcon';

interface JsonViewerProps {
  data: unknown;
  maxHeight?: number | string;
  title?: string;
}

function syntaxHighlight(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-string';
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

export default function JsonViewer({ data, maxHeight = 320, title }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const jsonString = JSON.stringify(data, null, 2);
  const highlighted = syntaxHighlight(
    jsonString.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ backgroundColor: '#0d0d14', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: '#ff5f57' }}
          />
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: '#ffbd2e' }}
          />
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: '#28c940' }}
          />
          {title && (
            <span className="ml-2 font-mono text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {title}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="btn-ghost px-2 py-1"
          style={{ fontSize: '11px', gap: '4px' }}
          aria-label="Copy JSON"
        >
          <Icon name={copied ? 'CheckIcon' : 'ClipboardDocumentIcon'} size={12} />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* JSON content */}
      <div
        className="overflow-auto"
        style={{
          maxHeight,
          backgroundColor: '#050508',
          padding: '12px 16px',
        }}
      >
        <pre
          className="font-mono text-xs leading-relaxed m-0"
          style={{ color: 'var(--foreground)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </div>
    </div>
  );
}
