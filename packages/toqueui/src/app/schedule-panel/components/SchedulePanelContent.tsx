'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import SectionCard from '@/components/ui/SectionCard';
import StatusBadge from '@/components/ui/StatusBadge';
import JsonViewer from '@/components/ui/JsonViewer';
import Toggle from '@/components/ui/Toggle';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorAlert from '@/components/ui/ErrorAlert';
import {
  toqueScheduleCreate,
  toqueScheduleStatus,
  toqueScheduleCancel,
  toqueGroupsList,
  type ScheduledWorkflow,
  type Group,
} from '@/lib/toque/client';

type WorkflowStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

interface ScheduleFormValues {
  targetTime: string;
  groupId: string;
  captchaType: string;
}

const FALLBACK_GROUPS: Group[] = [
  { id: 'GRP-001', name: 'Hajj Group Alpha 2026' },
  { id: 'GRP-002', name: 'Umrah Package Delta' },
  { id: 'GRP-003', name: 'VIP Pilgrimage Group' },
  { id: 'GRP-004', name: 'Ramadan Umrah Batch 7' },
  { id: 'GRP-005', name: 'Corporate Hajj Delegation' },
];

const TIME_PRESETS = [
  { label: '06:00', value: '06:00:00.000' },
  { label: '09:00', value: '09:00:00.000' },
  { label: '12:00', value: '12:00:00.000' },
  { label: '14:30', value: '14:30:00.000' },
  { label: '18:00', value: '18:00:00.000' },
  { label: '22:00', value: '22:00:00.000' },
];

// Map Cloudflare Workflow status → our UI status.
function mapStatus(raw: unknown): WorkflowStatus {
  if (raw && typeof raw === 'object') {
    const s = (raw as { status?: string }).status?.toLowerCase?.() ?? '';
    if (s.includes('complete') && !s.includes('error')) return 'success';
    if (s.includes('error') || s.includes('errored')) return 'error';
    if (s.includes('terminat')) return 'cancelled';
    if (s.includes('running') || s.includes('started') || s.includes('queued')) return 'running';
    if (s.includes('pending') || s.includes('waiting')) return 'pending';
  }
  return 'running';
}

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export default function SchedulePanelContent() {
  const [workflows, setWorkflows] = useState<ScheduledWorkflow[]>([]);
  const [groups, setGroups] = useState<Group[]>(FALLBACK_GROUPS);
  const [pullBefore, setPullBefore] = useState(true);
  const [captcha, setCaptcha] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{
    instanceId: string;
    targetTime: string;
    groupId: string;
  } | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | 'all'>('all');
  const [mounted, setMounted] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [cliLog, setCliLog] = useState<string[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState<string>('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const appendLog = (line: string) => setCliLog((prev) => [...prev.slice(-99), line]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<ScheduleFormValues>({
    defaultValues: { targetTime: '', groupId: '', captchaType: 'visa' },
  });
  const watchedGroupId = watch('groupId');
  const watchedTargetTime = watch('targetTime');
  const watchedCaptchaType = watch('captchaType');

  // Outside-click for group dropdown
  useEffect(() => {
    if (!showGroupDropdown) return;
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setShowGroupDropdown(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showGroupDropdown]);

  // Countdown to next pending workflow
  useEffect(() => {
    const pending = workflows.filter((w) => w.status === 'pending');
    if (!pending.length || !mounted) return;
    const interval = setInterval(() => {
      const now = new Date();
      const times = pending.map((w) => {
        const [h, m, s] = w.targetTime.split(':').map(Number);
        const t = new Date();
        t.setHours(h, m, Math.floor(s || 0), 0);
        if (t < now) t.setDate(t.getDate() + 1);
        return t.getTime() - now.getTime();
      });
      const nearest = Math.min(...times);
      if (nearest < 0) {
        setCountdown('');
        return;
      }
      const h = Math.floor(nearest / 3600000);
      const m = Math.floor((nearest % 3600000) / 60000);
      const s = Math.floor((nearest % 60000) / 1000);
      setCountdown(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [workflows, mounted]);

  const handleRefreshWorkflows = useCallback(async () => {
    const active = workflows.filter((w) => w.status === 'pending' || w.status === 'running');
    if (!active.length) return;
    setIsRefreshing(true);
    appendLog(`$ toque schedule status ×${active.length}`);
    await Promise.all(
      active.map(async (wf) => {
        const r = await toqueScheduleStatus(wf.id);
        if (r.ok && r.data) {
          const st = mapStatus(r.data.status);
          setWorkflows((prev) => prev.map((w) => (w.id === wf.id ? { ...w, status: st } : w)));
          appendLog(`✓ status ${wf.id} → ${st} (${r.latencyMs}ms)`);
        }
      })
    );
    setIsRefreshing(false);
  }, [workflows, appendLog]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => void handleRefreshWorkflows(), 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, handleRefreshWorkflows]);

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
      appendLog(`✗ POST /groups → ${result.status || 'ERR'}: ${result.error}`);
    }
    setIsLoadingGroups(false);
  };

  const handleSelectGroup = (group: Group) => {
    setValue('groupId', group.id);
    setSelectedGroup(group.name);
    setShowGroupDropdown(false);
  };

  const onCreateSchedule = handleSubmit(async (data) => {
    setIsCreating(true);
    setCreateError(null);
    appendLog(
      `$ toque schedule create --group ${data.groupId} --time ${data.targetTime} --captcha ${captcha} --type ${data.captchaType} --pull-before ${pullBefore}`
    );
    appendLog(`→ POST /schedule/workflow`);

    const result = await toqueScheduleCreate({
      targetTime: data.targetTime,
      groupId: data.groupId,
      captcha,
      captchaType: data.captchaType,
      pullBefore,
    });

    if (result.ok && result.data) {
      const d = result.data;
      const wf: ScheduledWorkflow = {
        id: d.instanceId,
        groupId: d.groupId,
        groupName: groups.find((g) => g.id === d.groupId)?.name ?? d.groupId,
        targetTime: d.targetTime,
        status: 'pending',
        pullBefore,
        captcha,
        captchaType: data.captchaType,
        createdAt: new Date().toISOString(),
      };
      setWorkflows((prev) => [wf, ...prev]);
      setLastCreated({ instanceId: d.instanceId, targetTime: d.targetTime, groupId: d.groupId });
      appendLog(
        `✓ POST /schedule/workflow → ${result.status} (${result.latencyMs}ms)  instanceId: ${d.instanceId}`
      );
      toast.success(`Workflow ${d.instanceId.slice(0, 8)} scheduled for ${d.targetTime}`);
      reset({ targetTime: '', groupId: '', captchaType: 'visa' });
      setSelectedGroup('');
      setPullBefore(true);
      setCaptcha(true);
    } else {
      const errMsg = result.error || `HTTP ${result.status}`;
      setCreateError(`POST /schedule/workflow → ${result.status || 'ERR'}: ${errMsg}`);
      appendLog(`✗ POST /schedule/workflow → ${result.status || 'ERR'}: ${errMsg}`);
      toast.error('Workflow creation failed: ' + errMsg);
    }
    setIsCreating(false);
  });

  const handleCancelWorkflow = async (instanceId: string) => {
    setCancellingId(instanceId);
    setConfirmCancelId(null);
    appendLog(`$ toque schedule cancel ${instanceId}`);
    appendLog(`→ POST /schedule/workflow/terminate  { instanceId: "${instanceId}" }`);
    const result = await toqueScheduleCancel(instanceId);
    if (result.ok) {
      setWorkflows((prev) =>
        prev.map((w) => (w.id === instanceId ? { ...w, status: 'cancelled' as WorkflowStatus } : w))
      );
      appendLog(`✓ terminate ${instanceId} → ${result.status} (${result.latencyMs}ms)`);
      toast.success(`Workflow ${instanceId.slice(0, 8)} terminated`);
    } else {
      appendLog(`✗ terminate → ${result.status || 'ERR'}: ${result.error}`);
      toast.error('Cancel failed: ' + result.error);
    }
    setCancellingId(null);
  };

  const filteredWorkflows =
    statusFilter === 'all' ? workflows : workflows.filter((w) => w.status === statusFilter);
  const pendingCount = workflows.filter((w) => w.status === 'pending').length;
  const runningCount = workflows.filter((w) => w.status === 'running').length;
  const successCount = workflows.filter((w) => w.status === 'success').length;
  const errorCount = workflows.filter((w) => w.status === 'error').length;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold" style={{ color: 'var(--foreground)' }}>
            Schedule
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Durable Cloudflare Workflow visa sends — wired to{' '}
            <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
              POST /schedule/workflow · GET /schedule/workflow/status · POST
              /schedule/workflow/terminate
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {countdown && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: 'rgba(99,102,241,0.1)',
                border: '1px solid rgba(99,102,241,0.25)',
              }}
            >
              <Icon name="ClockIcon" size={12} />
              <span className="text-xs font-mono font-semibold" style={{ color: 'var(--accent)' }}>
                Next: {countdown}
              </span>
            </div>
          )}
          {pendingCount > 0 && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: 'rgba(245,158,11,0.1)',
                border: '1px solid rgba(245,158,11,0.25)',
              }}
            >
              <span
                className="w-2 h-2 rounded-full pulse-dot"
                style={{ backgroundColor: 'var(--warning)' }}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>
                {pendingCount} pending
              </span>
            </div>
          )}
          {runningCount > 0 && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.25)',
              }}
            >
              <span
                className="w-2 h-2 rounded-full pulse-dot"
                style={{ backgroundColor: 'var(--success)' }}
              />
              <span className="text-xs font-semibold" style={{ color: 'var(--success)' }}>
                {runningCount} running
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: 'Pending',
            value: pendingCount,
            color: 'var(--warning)',
            icon: 'ClockIcon',
            bg: 'rgba(245,158,11,0.06)',
            border: 'rgba(245,158,11,0.15)',
          },
          {
            label: 'Running',
            value: runningCount,
            color: 'var(--accent)',
            icon: 'PlayIcon',
            bg: 'rgba(99,102,241,0.06)',
            border: 'rgba(99,102,241,0.15)',
          },
          {
            label: 'Completed',
            value: successCount,
            color: 'var(--success)',
            icon: 'CheckCircleIcon',
            bg: 'rgba(34,197,94,0.06)',
            border: 'rgba(34,197,94,0.15)',
          },
          {
            label: 'Failed',
            value: errorCount,
            color: errorCount > 0 ? 'var(--error)' : 'var(--muted-foreground)',
            icon: 'XCircleIcon',
            bg: errorCount > 0 ? 'rgba(239,68,68,0.06)' : 'var(--card)',
            border: errorCount > 0 ? 'rgba(239,68,68,0.15)' : 'var(--border)',
          },
        ].map((stat) => (
          <div
            key={`sched-stat-${stat.label}`}
            className="p-4 rounded-lg"
            style={{ backgroundColor: stat.bg, border: `1px solid ${stat.border}` }}
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
            <p className="font-mono font-bold text-3xl tabular-nums" style={{ color: stat.color }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* Create form */}
        <div className="xl:col-span-2 space-y-4">
          <SectionCard
            title="Create Scheduled Send"
            description="Schedule a durable Cloudflare Workflow visa send"
          >
            <form onSubmit={onCreateSchedule} className="space-y-4">
              <div>
                <label
                  htmlFor="targetTime"
                  className="block text-sm font-medium mb-1"
                  style={{ color: 'var(--foreground)' }}
                >
                  Target Time (HH:MM:SS.mmm)
                </label>
                <p className="text-xs mb-2" style={{ color: 'var(--muted-foreground)' }}>
                  24-hour, sub-ms precision. Today if future, else tomorrow.
                </p>
                <input
                  id="targetTime"
                  type="text"
                  className="input-field w-full px-3 py-2.5 font-mono text-sm"
                  placeholder="14:30:00.000"
                  {...register('targetTime', {
                    required: 'Target time is required',
                    pattern: {
                      value: /^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/,
                      message: 'Format: HH:MM:SS.mmm',
                    },
                  })}
                />
                {errors.targetTime && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--error)' }}>
                    {errors.targetTime.message}
                  </p>
                )}
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {TIME_PRESETS.map((t) => (
                    <button
                      key={`preset-${t.value}`}
                      type="button"
                      onClick={() => setValue('targetTime', t.value)}
                      className="font-mono px-2 py-1 rounded text-2xs transition-colors duration-100"
                      style={{
                        backgroundColor:
                          watchedTargetTime === t.value ? 'rgba(99,102,241,0.2)' : 'var(--input)',
                        color:
                          watchedTargetTime === t.value
                            ? 'var(--accent)'
                            : 'var(--muted-foreground)',
                        border: `1px solid ${watchedTargetTime === t.value ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
                        fontSize: '10px',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="schedGroupId"
                    className="block text-sm font-medium"
                    style={{ color: 'var(--foreground)' }}
                  >
                    Group ID
                  </label>
                  <button
                    type="button"
                    onClick={handleLoadGroups}
                    disabled={isLoadingGroups}
                    className="text-xs flex items-center gap-1"
                    style={{ color: 'var(--accent)' }}
                  >
                    {isLoadingGroups ? (
                      <LoadingSpinner size={10} />
                    ) : (
                      <Icon name="ArrowPathIcon" size={10} />
                    )}
                    Reload
                  </button>
                </div>
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
                          key={`sched-group-${group.id}`}
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
                <input
                  id="schedGroupId"
                  type="text"
                  className="input-field w-full px-3 py-2.5 font-mono text-sm"
                  placeholder="GRP-001"
                  {...register('groupId', { required: 'Group ID is required' })}
                />
                {errors.groupId && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--error)' }}>
                    {errors.groupId.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="captchaType"
                  className="block text-sm font-medium mb-1"
                  style={{ color: 'var(--foreground)' }}
                >
                  Captcha Type
                </label>
                <select
                  id="captchaType"
                  className="input-field w-full px-3 py-2.5 text-sm"
                  {...register('captchaType')}
                >
                  <option value="visa">visa</option>
                  <option value="login">login</option>
                  <option value="general">general</option>
                </select>
              </div>

              <div
                className="space-y-3 p-3 rounded-lg"
                style={{ backgroundColor: 'var(--input)', border: '1px solid var(--border)' }}
              >
                <Toggle
                  checked={pullBefore}
                  onChange={setPullBefore}
                  label="Pull Before Send"
                  description="Refresh auth + captcha from autha-worker before executing"
                  id="pull-before-toggle"
                />
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                  <Toggle
                    checked={captcha}
                    onChange={setCaptcha}
                    label="Solve Captcha"
                    description="Solve a captcha as part of the workflow"
                    id="captcha-toggle"
                  />
                </div>
              </div>

              {watchedGroupId && watchedTargetTime && (
                <div
                  className="p-3 rounded font-mono text-xs"
                  style={{ backgroundColor: '#050508', border: '1px solid var(--border)' }}
                >
                  <span style={{ color: 'var(--accent)' }}>$ </span>
                  <span style={{ color: 'var(--foreground)' }}>
                    toque schedule create --group {watchedGroupId} --time {watchedTargetTime} --type{' '}
                    {watchedCaptchaType} --captcha {String(captcha)} --pull-before{' '}
                    {String(pullBefore)}
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={isCreating}
                className="btn-primary w-full py-3 text-sm font-semibold"
              >
                {isCreating ? (
                  <>
                    <LoadingSpinner size={16} /> Creating workflow...
                  </>
                ) : (
                  <>
                    <Icon name="CalendarDaysIcon" size={16} /> Schedule Send — POST
                    /schedule/workflow
                  </>
                )}
              </button>
            </form>
          </SectionCard>

          {createError && (
            <ErrorAlert
              message="Workflow creation failed"
              detail={createError}
              onRetry={() => void onCreateSchedule()}
            />
          )}

          {lastCreated && (
            <SectionCard title="Workflow Created" headerRight={<StatusBadge status="pending" />}>
              <JsonViewer
                data={lastCreated}
                maxHeight={140}
                title="POST /schedule/workflow response"
              />
            </SectionCard>
          )}
        </div>

        {/* Workflows table */}
        <div className="xl:col-span-3">
          <SectionCard
            title="Workflow Instances"
            description="Cloudflare Workflow instances — poll status per instanceId"
            headerRight={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAutoRefresh((v) => !v)}
                  className="px-2 py-1 rounded text-xs font-medium transition-all"
                  style={{
                    backgroundColor: autoRefresh ? 'rgba(34,197,94,0.1)' : 'var(--input)',
                    color: autoRefresh ? 'var(--success)' : 'var(--muted-foreground)',
                    border: `1px solid ${autoRefresh ? 'rgba(34,197,94,0.25)' : 'var(--border)'}`,
                  }}
                >
                  <Icon name="ArrowPathIcon" size={11} />
                  {autoRefresh ? 'Auto' : 'Manual'}
                </button>
                <button
                  onClick={() => void handleRefreshWorkflows()}
                  disabled={isRefreshing}
                  className="btn-ghost px-3 py-1.5 text-xs"
                >
                  {isRefreshing ? (
                    <LoadingSpinner size={12} />
                  ) : (
                    <Icon name="ArrowPathIcon" size={13} />
                  )}
                  {isRefreshing ? 'Polling...' : 'Poll Status'}
                </button>
                <span
                  className="font-mono text-xs px-2 py-1 rounded"
                  style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                >
                  {filteredWorkflows.length} instances
                </span>
              </div>
            }
            noPadding
          >
            <div
              className="flex gap-1 px-4 py-3 overflow-x-auto"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              {(['all', 'pending', 'running', 'success', 'error', 'cancelled'] as const).map(
                (f) => (
                  <button
                    key={`filter-${f}`}
                    onClick={() => setStatusFilter(f)}
                    className="px-3 py-1 rounded text-xs font-medium transition-all duration-150 whitespace-nowrap"
                    style={{
                      backgroundColor: statusFilter === f ? 'rgba(99,102,241,0.15)' : 'transparent',
                      color: statusFilter === f ? 'var(--accent)' : 'var(--muted-foreground)',
                      border: `1px solid ${statusFilter === f ? 'rgba(99,102,241,0.3)' : 'transparent'}`,
                    }}
                  >
                    {f === 'all'
                      ? `All (${workflows.length})`
                      : `${f.charAt(0).toUpperCase() + f.slice(1)} (${workflows.filter((w) => w.status === f).length})`}
                  </button>
                )
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {[
                      'Instance ID',
                      'Group',
                      'Target Time',
                      'Captcha',
                      'Pull?',
                      'Status',
                      'Created',
                      'Actions',
                    ].map((col) => (
                      <th
                        key={`sched-th-${col}`}
                        className="text-left px-4 py-3 font-medium"
                        style={{
                          color: 'var(--muted-foreground)',
                          fontSize: '11px',
                          letterSpacing: '0.04em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkflows.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <Icon name="CalendarDaysIcon" size={32} />
                          <p
                            className="mt-3 text-sm font-medium"
                            style={{ color: 'var(--foreground)' }}
                          >
                            No {statusFilter !== 'all' ? statusFilter : ''} workflows
                          </p>
                          <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                            Create a scheduled send using the form — instances are tracked locally
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredWorkflows.map((wf) => (
                      <tr key={wf.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td
                          className="px-4 py-3 font-mono text-xs font-semibold"
                          style={{ color: 'var(--accent)', whiteSpace: 'nowrap' }}
                        >
                          {wf.id.slice(0, 12)}…
                        </td>
                        <td className="px-4 py-3" style={{ maxWidth: '140px' }}>
                          <p
                            className="text-xs font-medium truncate"
                            style={{ color: 'var(--foreground)' }}
                          >
                            {wf.groupName}
                          </p>
                          <p
                            className="text-2xs font-mono"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {wf.groupId}
                          </p>
                        </td>
                        <td
                          className="px-4 py-3 font-mono text-xs font-semibold"
                          style={{ color: 'var(--foreground)', whiteSpace: 'nowrap' }}
                        >
                          {wf.targetTime}
                        </td>
                        <td
                          className="px-4 py-3 text-xs font-mono"
                          style={{ color: 'var(--muted-foreground)' }}
                        >
                          {wf.captcha ? `${wf.captchaType}` : 'off'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: wf.pullBefore
                                ? 'rgba(34,197,94,0.1)'
                                : 'rgba(100,116,139,0.1)',
                              color: wf.pullBefore ? 'var(--success)' : 'var(--muted-foreground)',
                            }}
                          >
                            {wf.pullBefore ? '✓' : '✗'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={wf.status} />
                        </td>
                        <td
                          className="px-4 py-3 text-2xs font-mono"
                          style={{ color: 'var(--muted-foreground)' }}
                        >
                          {mounted ? formatTimestamp(wf.createdAt) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {(wf.status === 'pending' || wf.status === 'running') && (
                            <>
                              {confirmCancelId === wf.id ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => void handleCancelWorkflow(wf.id)}
                                    disabled={cancellingId === wf.id}
                                    className="btn-danger px-2 py-1"
                                    style={{ fontSize: '11px' }}
                                  >
                                    {cancellingId === wf.id ? (
                                      <LoadingSpinner size={10} />
                                    ) : (
                                      'Confirm'
                                    )}
                                  </button>
                                  <button
                                    onClick={() => setConfirmCancelId(null)}
                                    className="btn-ghost px-2 py-1"
                                    style={{ fontSize: '11px' }}
                                  >
                                    Keep
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmCancelId(wf.id)}
                                  className="btn-ghost px-2.5 py-1.5"
                                  style={{
                                    fontSize: '11px',
                                    color: 'var(--error)',
                                    borderColor: 'rgba(239,68,68,0.25)',
                                  }}
                                >
                                  <Icon name="XMarkIcon" size={12} /> Terminate
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>

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
                key={`sched-log-${i}`}
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

      <SectionCard title="CLI Command Reference" description="Toque commands mapped to this panel">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            {
              cmd: 'toque schedule create --group <id> --time HH:MM:SS.mmm',
              http: 'POST /schedule/workflow',
              desc: 'Create a durable Workflow instance',
            },
            {
              cmd: 'toque schedule status <instanceId>',
              http: 'GET /schedule/workflow/status?instanceId=',
              desc: 'Poll a Workflow instance status',
            },
            {
              cmd: 'toque schedule cancel <instanceId>',
              http: 'POST /schedule/workflow/terminate',
              desc: 'Terminate a running/pending instance',
            },
          ].map((item) => (
            <div
              key={item.cmd.slice(0, 20)}
              className="p-3 rounded-lg"
              style={{ backgroundColor: 'var(--input)', border: '1px solid var(--border)' }}
            >
              <p
                className="font-mono text-xs font-bold mb-1 break-all"
                style={{ color: 'var(--accent)', fontSize: '10px' }}
              >
                $ {item.cmd}
              </p>
              <p className="font-mono text-xs mb-1.5" style={{ color: 'var(--muted-foreground)' }}>
                → {item.http}
              </p>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
