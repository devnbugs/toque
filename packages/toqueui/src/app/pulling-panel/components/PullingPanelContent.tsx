'use client';

import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import JsonViewer from '@/components/ui/JsonViewer';
import { toquePull, toqueAuthaEntities } from '@/lib/toque/client';

interface PullJob {
  id: string;
  entityId: string;
  status: 'idle' | 'pulling' | 'done' | 'error';
  savedAuth?: boolean;
  savedCaptcha?: boolean;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  errorMsg?: string;
  httpStatus?: number;
}

export default function PullingPanelContent() {
  const [jobs, setJobs] = useState<PullJob[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [selectedEntity, setSelectedEntity] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [lastContext, setLastContext] = useState<unknown>(null);
  const [cliLog, setCliLog] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const r = await toqueAuthaEntities();
      if (r.ok && r.data?.entities?.length) {
        setEntities(r.data.entities);
        setSelectedEntity(r.data.entities[0]);
      }
    })();
  }, []);

  const appendLog = (line: string) => setCliLog((prev) => [...prev.slice(-99), line]);

  const handlePull = async (entityId: string, refresh = true) => {
    if (!entityId) {
      toast.error('Select or enter an entity ID');
      return;
    }
    const jobId = `pull-${Date.now()}`;
    const startedAt = new Date().toLocaleTimeString('en-US', { hour12: false });
    setJobs((prev) => [{ id: jobId, entityId, status: 'pulling', startedAt }, ...prev]);
    setIsPulling(true);
    appendLog(`$ toque pull --entity ${entityId} --refresh ${refresh}`);
    appendLog(`→ POST /pull  { activeEntityId: "${entityId}", refresh: ${refresh} } ...`);

    const result = await toquePull(entityId, refresh);
    const completedAt = new Date().toLocaleTimeString('en-US', { hour12: false });

    if (result.ok && result.data) {
      const d = result.data;
      setLastContext(d.context);
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: 'done',
                savedAuth: d.saved?.auth,
                savedCaptcha: d.saved?.captcha,
                completedAt,
                durationMs: result.latencyMs,
                httpStatus: result.status,
              }
            : j
        )
      );
      appendLog(
        `✓ POST /pull → ${result.status} (${result.latencyMs}ms)  auth:${d.saved?.auth} captcha:${d.saved?.captcha} entity:${d.saved?.entityId}`
      );
      toast.success(`Pull complete — auth + captcha populated for ${entityId}`);
    } else {
      const errMsg = result.error || `HTTP ${result.status}`;
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: 'error',
                completedAt,
                durationMs: result.latencyMs,
                errorMsg: errMsg,
                httpStatus: result.status,
              }
            : j
        )
      );
      appendLog(`✗ POST /pull → ${result.status || 'ERR'}: ${errMsg}`);
      toast.error(`Pull failed for ${entityId}: ${errMsg}`);
    }
    setIsPulling(false);
    setSelectedEntity('');
  };

  const handlePullAll = async () => {
    for (const en of entities) {
      await handlePull(en, true);
    }
  };

  const statusColor = (s: PullJob['status']) =>
    s === 'done'
      ? 'var(--success)'
      : s === 'error'
        ? 'var(--error)'
        : s === 'pulling'
          ? 'var(--warning)'
          : 'var(--muted-foreground)';

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-3xl font-semibold" style={{ color: 'var(--foreground)' }}>
          Pulling
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Pull auth + captcha context from the autha-worker — wired to{' '}
          <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
            POST /pull · GET /autha/entities
          </span>
        </p>
      </div>

      {/* Pull trigger */}
      <div className="card-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Trigger Pull
          </h2>
          <button
            type="button"
            onClick={() =>
              void (async () => {
                const r = await toqueAuthaEntities(true);
                if (r.ok && r.data?.entities?.length) setEntities(r.data.entities);
              })
            }
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            <Icon name="ArrowPathIcon" size={12} /> Reload Entities
          </button>
        </div>
        <div className="flex gap-3 flex-wrap">
          <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
            <label className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
              Entity ID
            </label>
            <input
              type="text"
              list="pull-entity-list"
              className="input-field px-3 py-2 font-mono text-sm"
              placeholder="525513"
              value={selectedEntity}
              onChange={(e) => setSelectedEntity(e.target.value)}
            />
            <datalist id="pull-entity-list">
              {entities.map((en) => (
                <option key={en} value={en} />
              ))}
            </datalist>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => void handlePull(selectedEntity)}
              disabled={!selectedEntity || isPulling}
              className="btn-primary px-5 py-2 text-sm"
            >
              {isPulling ? (
                <LoadingSpinner size={14} />
              ) : (
                <Icon name="ArrowDownTrayIcon" size={14} />
              )}
              {isPulling ? 'Pulling...' : 'Pull Auth'}
            </button>
          </div>
          {entities.length > 0 && (
            <div className="flex items-end">
              <button
                onClick={() => void handlePullAll()}
                disabled={isPulling}
                className="btn-ghost px-5 py-2 text-sm"
              >
                <Icon name="ArrowPathIcon" size={14} /> Pull All Entities
              </button>
            </div>
          )}
        </div>
      </div>

      {/* CLI Terminal */}
      {cliLog.length > 0 && (
        <div className="card-surface overflow-hidden">
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <Icon name="CommandLineIcon" size={13} style={{ color: 'var(--accent)' }} />
              <span
                className="text-xs font-semibold font-mono"
                style={{ color: 'var(--foreground)' }}
              >
                CLI Output
              </span>
            </div>
            <button
              onClick={() => setCliLog([])}
              className="text-xs"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Clear
            </button>
          </div>
          <div
            className="p-4 font-mono text-xs space-y-0.5 overflow-y-auto"
            style={{ backgroundColor: '#050508', maxHeight: '160px' }}
          >
            {cliLog.map((line, i) => (
              <div
                key={`pull-log-${i}`}
                style={{
                  color: line.startsWith('✓')
                    ? 'var(--success)'
                    : line.startsWith('✗')
                      ? 'var(--error)'
                      : line.startsWith('$')
                        ? 'var(--accent)'
                        : 'var(--muted-foreground)',
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {lastContext ? (
        <JsonViewer
          data={lastContext}
          maxHeight={240}
          title="POST /pull — context (auth + captcha)"
        />
      ) : null}

      {/* Jobs list */}
      <div className="card-surface overflow-hidden">
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Pull Jobs
          </span>
          <span className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
            {jobs.length} total
          </span>
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {jobs.length === 0 && (
            <div
              className="px-5 py-8 text-center text-sm"
              style={{ color: 'var(--muted-foreground)' }}
            >
              No pull jobs yet — trigger a pull above
            </div>
          )}
          {jobs.map((job) => (
            <div key={job.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-sm font-semibold font-mono"
                      style={{ color: 'var(--foreground)' }}
                    >
                      entity {job.entityId}
                    </span>
                    <span
                      className="text-2xs font-mono px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                    >
                      {job.id}
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-3 text-xs font-mono"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    {job.startedAt && <span>Started: {job.startedAt}</span>}
                    {job.completedAt && <span>Done: {job.completedAt}</span>}
                    {job.durationMs && <span>{job.durationMs}ms</span>}
                    {job.httpStatus && <span>HTTP {job.httpStatus}</span>}
                  </div>
                  {job.savedAuth !== undefined && (
                    <div className="flex items-center gap-3 mt-1 text-xs font-mono">
                      <span style={{ color: job.savedAuth ? 'var(--success)' : 'var(--error)' }}>
                        auth: {job.savedAuth ? '✓' : '✗'}
                      </span>
                      <span style={{ color: job.savedCaptcha ? 'var(--success)' : 'var(--error)' }}>
                        captcha: {job.savedCaptcha ? '✓' : '✗'}
                      </span>
                    </div>
                  )}
                  {job.errorMsg && (
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--error)' }}>
                      ⚠ {job.errorMsg}
                    </p>
                  )}
                  {job.status === 'pulling' && (
                    <div className="mt-2 flex items-center gap-2">
                      <LoadingSpinner size={12} />
                      <span className="text-xs" style={{ color: 'var(--warning)' }}>
                        Pulling from autha-worker…
                      </span>
                    </div>
                  )}
                </div>
                <span
                  className="px-2 py-0.5 rounded text-2xs font-semibold shrink-0"
                  style={{
                    backgroundColor: `${statusColor(job.status)}20`,
                    color: statusColor(job.status),
                  }}
                >
                  {job.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CLI Reference */}
      <div className="card-surface p-4">
        <h3
          className="text-xs font-semibold uppercase tracking-widest mb-3"
          style={{ color: 'var(--muted-foreground)' }}
        >
          CLI Commands
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {[
            {
              cmd: 'toque pull --entity <id>',
              http: 'POST /pull { activeEntityId, refresh }',
              desc: 'Pull auth + captcha context for an entity',
            },
            {
              cmd: 'toque autha entities',
              http: 'GET /autha/entities',
              desc: 'List captured entity IDs from the autha-worker (D1)',
            },
          ].map((item) => (
            <div
              key={item.cmd}
              className="p-3 rounded-lg"
              style={{ backgroundColor: 'var(--input)', border: '1px solid var(--border)' }}
            >
              <p className="font-mono text-xs font-bold mb-1" style={{ color: 'var(--accent)' }}>
                $ {item.cmd}
              </p>
              <p className="font-mono text-xs mb-1" style={{ color: 'var(--muted-foreground)' }}>
                → {item.http}
              </p>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
