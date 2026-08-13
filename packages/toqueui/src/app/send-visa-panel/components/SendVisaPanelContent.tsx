'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import SectionCard from '@/components/ui/SectionCard';
import StatusBadge from '@/components/ui/StatusBadge';
import JsonViewer from '@/components/ui/JsonViewer';
import TimingDisplay from '@/components/ui/TimingDisplay';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorAlert from '@/components/ui/ErrorAlert';

import {
  toqueSendVisa,
  toqueGroupsList,
  toquePull,
  toqueAuthaEntities,
  type SendVisaResponse,
  type Group,
} from '@/lib/toque/client';

interface SendFormValues {
  groupId: string;
}

type SendStatus = 'success' | 'error' | 'pending';

interface SendHistoryEntry {
  id: string;
  groupId: string;
  groupName: string;
  timestamp: string;
  status: SendStatus;
  latencyMs: number;
  ttfbMs?: number;
  httpStatus?: number;
  cliCommand?: string;
}

const FALLBACK_GROUPS: Group[] = [
  { id: 'GRP-001', name: 'Hajj Group Alpha 2026' },
  { id: 'GRP-002', name: 'Umrah Package Delta' },
  { id: 'GRP-003', name: 'VIP Pilgrimage Group' },
  { id: 'GRP-004', name: 'Ramadan Umrah Batch 7' },
  { id: 'GRP-005', name: 'Corporate Hajj Delegation' },
];

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default function SendVisaPanelContent() {
  const [isSending, setIsSending] = useState(false);
  const [sendResponse, setSendResponse] = useState<SendVisaResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendLatency, setSendLatency] = useState<number | null>(null);
  const [history, setHistory] = useState<SendHistoryEntry[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [groups, setGroups] = useState<Group[]>(FALLBACK_GROUPS);
  const [cliLog, setCliLog] = useState<string[]>([]);

  // Pull-credentials gate
  const [entities, setEntities] = useState<string[]>([]);
  const [entityId, setEntityId] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SendFormValues>({ defaultValues: { groupId: '' } });
  const watchedGroupId = watch('groupId');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback(
    (line: string) => setCliLog((prev) => [...prev.slice(-99), line]),
    []
  );

  // Close group dropdown on outside click
  useEffect(() => {
    if (!showGroupDropdown) return;
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setShowGroupDropdown(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showGroupDropdown]);

  // Load entities once on mount
  useEffect(() => {
    void (async () => {
      const r = await toqueAuthaEntities();
      if (r.ok && r.data?.entities?.length) {
        setEntities(r.data.entities);
        setEntityId(r.data.entities[0]);
      }
    })();
  }, []);

  const handleSelectGroup = (group: Group) => {
    setValue('groupId', group.id);
    setSelectedGroup(group.name);
    setShowGroupDropdown(false);
  };

  const handleLoadGroups = async () => {
    setIsLoadingGroups(true);
    appendLog('$ toque groups list → POST /groups');
    const result = await toqueGroupsList(true);
    if (result.ok && result.data?.groups?.length) {
      setGroups(result.data.groups);
      appendLog(
        `✓ POST /groups → ${result.status} (${result.latencyMs}ms)  ${result.data.groups.length} groups`
      );
      toast.success(`${result.data.groups.length} groups loaded`);
    } else {
      appendLog(
        `✗ POST /groups → ${result.status || 'ERR'}: ${result.error || 'No groups'} — using cached list`
      );
      toast.error('Could not load groups — using cached list');
    }
    setIsLoadingGroups(false);
  };

  const handlePull = async () => {
    if (!entityId) {
      toast.error('Enter an entity ID first');
      return;
    }
    setIsPulling(true);
    appendLog(`$ toque pull --entity ${entityId} --refresh`);
    const result = await toquePull(entityId, true);
    if (result.ok && result.data) {
      setAuthReady(true);
      appendLog(
        `✓ POST /pull → ${result.status} (${result.latencyMs}ms)  auth:${result.data.saved?.auth} captcha:${result.data.saved?.captcha}`
      );
      toast.success('Credentials pulled — /send is now ready');
    } else {
      setAuthReady(false);
      appendLog(`✗ POST /pull → ${result.status || 'ERR'}: ${result.error}`);
      toast.error('Pull failed: ' + result.error);
    }
    setIsPulling(false);
  };

  const runSend = useCallback(
    async (groupId: string) => {
      setIsSending(true);
      setSendError(null);
      setSendResponse(null);
      setSendLatency(null);

      const group = groups.find((g) => g.id === groupId);
      const pendingId = `send-${Date.now()}`;

      // Optimistic: surface the send in history immediately.
      setHistory((prev) => [
        {
          id: pendingId,
          groupId,
          groupName: group?.name ?? groupId,
          timestamp: new Date().toISOString(),
          status: 'pending',
          latencyMs: 0,
          cliCommand: `toque send ${groupId}`,
        },
        ...prev.slice(0, 9),
      ]);

      appendLog(`$ toque send ${groupId}`);
      appendLog(`→ POST /send  { groupId: "${groupId}", captchaType: "visa" } ...`);

      const result = await toqueSendVisa(groupId);
      setSendLatency(result.latencyMs);

      if (result.ok && result.data) {
        const d = result.data;
        setSendResponse(d);
        setHistory((prev) =>
          prev.map((e) =>
            e.id === pendingId
              ? {
                  ...e,
                  status: 'success',
                  latencyMs: d.timing?.total ?? result.latencyMs,
                  ttfbMs: d.timing?.ttfb,
                  httpStatus: result.status,
                }
              : e
          )
        );
        appendLog(
          `✓ POST /send → ${result.status} (${result.latencyMs}ms${d.timing ? `, ttfb ${d.timing.ttfb}ms` : ''})`
        );
        toast.success(`Visa send submitted — HTTP ${result.status} in ${result.latencyMs}ms`);
      } else {
        const errMsg = result.error || `HTTP ${result.status}`;
        setSendError(`POST /send → ${result.status || 'ERR'}: ${errMsg}`);
        setHistory((prev) =>
          prev.map((e) =>
            e.id === pendingId
              ? { ...e, status: 'error', latencyMs: result.latencyMs, httpStatus: result.status }
              : e
          )
        );
        appendLog(`✗ POST /send → ${result.status || 'ERR'}: ${errMsg}`);
        toast.error('Visa send failed — check error details');
      }

      setIsSending(false);
      return result;
    },
    [appendLog, groups]
  );

  const onSend = handleSubmit(async (data) => {
    await runSend(data.groupId);
  });

  const onRetry = useCallback(() => {
    const lastError = history.find((h) => h.status === 'error');
    if (lastError) void runSend(lastError.groupId);
  }, [history, runSend]);

  const stats = useMemo(() => {
    const completed = history.filter((h) => h.status !== 'pending');
    const successCount = completed.filter((h) => h.status === 'success').length;
    const errorCount = completed.filter((h) => h.status === 'error').length;
    const avgLatency =
      completed.length > 0
        ? Math.round(completed.reduce((sum, h) => sum + h.latencyMs, 0) / completed.length)
        : 0;
    const successRate =
      completed.length > 0 ? Math.round((successCount / completed.length) * 100) : null;
    return { total: history.length, successCount, errorCount, avgLatency, successRate };
  }, [history]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold" style={{ color: 'var(--foreground)' }}>
            Send Visa
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Trigger Masar Nusuk visa send — wired to{' '}
            <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
              POST /send · POST /pull · POST /groups
            </span>
          </p>
        </div>
        <div className="text-right">
          <p
            className="text-2xs uppercase tracking-wider font-medium"
            style={{ color: 'var(--muted-foreground)', letterSpacing: '0.07em' }}
          >
            Success Rate
          </p>
          <p
            className="font-mono font-bold text-xl"
            style={{
              color: stats.successRate !== null ? 'var(--success)' : 'var(--muted-foreground)',
            }}
          >
            {stats.successRate !== null ? `${stats.successRate}%` : '—'}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: 'Total Sends',
            value: stats.total.toString(),
            icon: 'PaperAirplaneIcon',
            color: 'var(--foreground)',
          },
          {
            label: 'Successful',
            value: stats.successCount.toString(),
            icon: 'CheckCircleIcon',
            color: 'var(--success)',
          },
          {
            label: 'Failed',
            value: stats.errorCount.toString(),
            icon: 'XCircleIcon',
            color: stats.errorCount > 0 ? 'var(--error)' : 'var(--muted-foreground)',
          },
          {
            label: 'Avg Latency',
            value: `${stats.avgLatency}ms`,
            icon: 'ClockIcon',
            color:
              stats.avgLatency < 300
                ? 'var(--success)'
                : stats.avgLatency < 1000
                  ? 'var(--warning)'
                  : 'var(--error)',
          },
        ].map((stat) => (
          <div
            key={`stat-${stat.label}`}
            className="p-4 rounded-lg"
            style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Icon name={stat.icon as Parameters<typeof Icon>[0]['name']} size={14} />
              <span
                className="text-xs font-medium uppercase tracking-wider"
                style={{
                  color: 'var(--muted-foreground)',
                  fontSize: '10px',
                  letterSpacing: '0.07em',
                }}
              >
                {stat.label}
              </span>
            </div>
            <p className="font-mono font-bold text-2xl tabular-nums" style={{ color: stat.color }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Auth-ready gate banner */}
      {!authReady && (
        <div
          className="flex items-center gap-3 p-3 rounded-lg animate-fade-in"
          style={{
            backgroundColor: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
            color: 'var(--warning)',
          }}
        >
          <Icon name="ExclamationTriangleIcon" size={16} />
          <p className="text-xs flex-1">
            <span className="font-semibold">auth.json not populated.</span> Pull credentials for an
            entity below before sending, or /send will return 500.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* Send form + pull gate */}
        <div className="xl:col-span-2 space-y-4">
          {/* Pull credentials gate */}
          <SectionCard
            title="1 · Pull Credentials"
            description="Populate auth.json + captcha.json on the container"
          >
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input-field flex-1 px-3 py-2.5 font-mono text-sm"
                  placeholder="entityId e.g. 525513"
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  list="send-entity-list"
                />
                <datalist id="send-entity-list">
                  {entities.map((en) => (
                    <option key={en} value={en} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={handlePull}
                  disabled={isPulling}
                  className="btn-ghost px-4 py-2.5 text-sm"
                >
                  {isPulling ? (
                    <LoadingSpinner size={14} />
                  ) : (
                    <Icon name="ArrowDownTrayIcon" size={14} />
                  )}
                  {isPulling ? 'Pulling...' : 'Pull Auth'}
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-semibold"
                  style={{
                    backgroundColor: authReady ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)',
                    color: authReady ? 'var(--success)' : 'var(--muted-foreground)',
                    border: `1px solid ${authReady ? 'rgba(34,197,94,0.2)' : 'var(--border)'}`,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      backgroundColor: authReady ? 'var(--success)' : 'var(--muted-foreground)',
                    }}
                  />
                  {authReady ? 'Ready' : 'Not pulled'}
                </span>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="2 · Send Visa" description="Select a group and trigger visa send">
            <form onSubmit={onSend} className="space-y-5">
              <div>
                <label
                  htmlFor="groupId"
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: 'var(--foreground)' }}
                >
                  Group ID
                </label>
                <p className="text-xs mb-2" style={{ color: 'var(--muted-foreground)' }}>
                  The Masar Nusuk pilgrim group identifier
                </p>

                <div className="relative mb-2" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowGroupDropdown((v) => !v)}
                    className="btn-ghost w-full px-3 py-2.5 text-sm justify-between"
                  >
                    <span
                      style={{
                        color: selectedGroup ? 'var(--foreground)' : 'var(--muted-foreground)',
                        fontSize: '13px',
                      }}
                    >
                      {selectedGroup || 'Select group...'}
                    </span>
                    <Icon name="ChevronDownIcon" size={14} />
                  </button>
                  {showGroupDropdown && (
                    <div
                      className="absolute top-full left-0 right-0 mt-1 rounded-lg z-20 overflow-hidden animate-fade-in"
                      style={{
                        backgroundColor: 'var(--card)',
                        border: '1px solid var(--border)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                      }}
                    >
                      {groups.map((group) => (
                        <button
                          key={`send-group-${group.id}`}
                          type="button"
                          onClick={() => handleSelectGroup(group)}
                          className="w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors duration-100"
                          style={{ borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor = 'var(--muted)')
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = 'transparent')
                          }
                        >
                          <div>
                            <p
                              className="text-sm font-medium"
                              style={{ color: 'var(--foreground)' }}
                            >
                              {group.name}
                            </p>
                            <p
                              className="text-xs font-mono"
                              style={{ color: 'var(--muted-foreground)' }}
                            >
                              {group.id}
                            </p>
                          </div>
                          {watchedGroupId === group.id && <Icon name="CheckIcon" size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mb-2">
                  <input
                    id="groupId"
                    type="text"
                    className="input-field flex-1 px-3 py-2.5 font-mono text-sm"
                    placeholder="GRP-001"
                    {...register('groupId', { required: 'Group ID is required' })}
                  />
                  <button
                    type="button"
                    onClick={handleLoadGroups}
                    disabled={isLoadingGroups}
                    className="btn-ghost px-3 py-2.5 text-xs"
                  >
                    {isLoadingGroups ? (
                      <LoadingSpinner size={12} />
                    ) : (
                      <Icon name="ArrowPathIcon" size={12} />
                    )}
                  </button>
                </div>
                {errors.groupId && (
                  <p className="mt-1.5 text-xs" style={{ color: 'var(--error)' }}>
                    {errors.groupId.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSending || !authReady}
                className="btn-primary w-full py-3 text-sm font-semibold"
              >
                {isSending ? (
                  <>
                    <LoadingSpinner size={16} /> Sending...
                  </>
                ) : (
                  <>
                    <Icon name="PaperAirplaneIcon" size={16} /> Send Visa — POST /send
                  </>
                )}
              </button>
              {!authReady && (
                <p className="text-xs text-center" style={{ color: 'var(--muted-foreground)' }}>
                  Pull credentials above to enable sending
                </p>
              )}
            </form>
          </SectionCard>

          {sendError && (
            <ErrorAlert message="Visa send failed" detail={sendError} onRetry={onRetry} />
          )}

          {sendLatency !== null && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded"
              style={{ backgroundColor: 'var(--input)', border: '1px solid var(--border)' }}
            >
              <Icon name="ClockIcon" size={13} />
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                Latency:
              </span>
              <TimingDisplay ms={sendLatency} />
            </div>
          )}
        </div>

        {/* Response + History */}
        <div className="xl:col-span-3 space-y-4">
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
                style={{ backgroundColor: '#050508', maxHeight: '140px' }}
              >
                {cliLog.map((line, i) => (
                  <div
                    key={`send-log-${i}`}
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

          {sendResponse && (
            <SectionCard title="Send Response" headerRight={<StatusBadge status="success" />}>
              <JsonViewer
                data={sendResponse}
                maxHeight={240}
                title="POST /send response (Nusuk data + timing)"
              />
            </SectionCard>
          )}

          <SectionCard title="Send History" description="Recent visa send operations" noPadding>
            {history.length === 0 ? (
              <div
                className="px-5 py-8 text-center text-sm"
                style={{ color: 'var(--muted-foreground)' }}
              >
                No sends yet — trigger a visa send above
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Group', 'CLI Command', 'HTTP', 'Latency', 'TTFB', 'Status', 'Time'].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-2.5 text-left font-semibold"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                            {entry.groupName}
                          </p>
                          <p style={{ color: 'var(--muted-foreground)' }}>{entry.groupId}</p>
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--accent)' }}>
                          $ {entry.cliCommand}
                        </td>
                        <td
                          className="px-4 py-2.5"
                          style={{
                            color:
                              entry.httpStatus && entry.httpStatus < 300
                                ? 'var(--success)'
                                : 'var(--error)',
                          }}
                        >
                          {entry.httpStatus ?? (entry.status === 'pending' ? '…' : '—')}
                        </td>
                        <td
                          className="px-4 py-2.5"
                          style={{
                            color:
                              entry.status === 'pending'
                                ? 'var(--muted-foreground)'
                                : entry.latencyMs < 300
                                  ? 'var(--success)'
                                  : entry.latencyMs < 1000
                                    ? 'var(--warning)'
                                    : 'var(--error)',
                          }}
                        >
                          {entry.status === 'pending' ? '…' : `${entry.latencyMs}ms`}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--muted-foreground)' }}>
                          {entry.ttfbMs !== undefined ? `${entry.ttfbMs}ms` : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="px-1.5 py-0.5 rounded text-2xs font-semibold"
                            style={{
                              backgroundColor:
                                entry.status === 'success'
                                  ? 'rgba(34,197,94,0.1)'
                                  : entry.status === 'error'
                                    ? 'rgba(239,68,68,0.1)'
                                    : 'rgba(99,102,241,0.1)',
                              color:
                                entry.status === 'success'
                                  ? 'var(--success)'
                                  : entry.status === 'error'
                                    ? 'var(--error)'
                                    : 'var(--accent)',
                            }}
                          >
                            {entry.status === 'pending' ? (
                              <LoadingSpinner size={10} />
                            ) : (
                              entry.status
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-2.5" style={{ color: 'var(--muted-foreground)' }}>
                          {formatTimestamp(entry.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
