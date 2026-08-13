'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import SectionCard from '@/components/ui/SectionCard';
import StatusBadge from '@/components/ui/StatusBadge';
import JsonViewer from '@/components/ui/JsonViewer';
import TimingDisplay from '@/components/ui/TimingDisplay';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorAlert from '@/components/ui/ErrorAlert';
import SkeletonBlock from '@/components/ui/SkeletonBlock';
import {
  toqueHealth,
  toqueAuthPing,
  toqueAuthRefresh,
  toquePull,
  toqueLogin,
  toqueVerifyLogin,
  toqueAuthaEntities,
  type RecoveryHint,
} from '@/lib/toque/client';

type AuthMode = 'api-key' | 'jwt';
type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

interface ConfigFormValues {
  baseUrl: string;
  apiKey: string;
  jwtToken: string;
}

interface LoginValues {
  username: string;
  password: string;
  provider: 'capmonster' | 'capsolver';
}

export default function AuthPanelContent() {
  const [authMode, setAuthMode] = useState<AuthMode>('api-key');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showJwt, setShowJwt] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [testLatency, setTestLatency] = useState<number | null>(null);
  const [healthData, setHealthData] = useState<unknown>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPinging, setIsPinging] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [recoveryHint, setRecoveryHint] = useState<RecoveryHint | null>(null);
  const [testAttempts, setTestAttempts] = useState<number>(0);
  const [isSaving, setIsSaving] = useState(false);
  const [lastTestedAt, setLastTestedAt] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [cliLog, setCliLog] = useState<string[]>([]);

  // Auth pipeline state
  const [entities, setEntities] = useState<string[]>([]);
  const [entityId, setEntityId] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginResult, setLoginResult] = useState<{
    otpRequired: boolean;
    transactionId?: string;
  } | null>(null);
  const [otp, setOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [lastResponse, setLastResponse] = useState<unknown>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<ConfigFormValues>({
    defaultValues: { baseUrl: 'https://toque.decloud.workers.dev', apiKey: '', jwtToken: '' },
  });
  const watchedBaseUrl = watch('baseUrl');

  const loginForm = useForm<LoginValues>({
    defaultValues: { username: '', password: '', provider: 'capmonster' },
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      const storedUrl = localStorage.getItem('toque_base_url') || 'https://toque.decloud.workers.dev';
      const storedKey = localStorage.getItem('toque_api_key') || '';
      const storedJwt = localStorage.getItem('toque_jwt') || '';
      const storedMode = (localStorage.getItem('toque_auth_mode') as AuthMode) || 'api-key';
      const storedStatus =
        (localStorage.getItem('toque_connection_status') as ConnectionStatus) || 'disconnected';
      setValue('baseUrl', storedUrl);
      setValue('apiKey', storedKey);
      setValue('jwtToken', storedJwt);
      setAuthMode(storedMode);
      setConnectionStatus(storedStatus);
      setIsLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [setValue]);

  const appendLog = (line: string) => setCliLog((prev) => [...prev.slice(-49), line]);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestError(null);
    setRecoveryHint(null);
    setTestAttempts(0);
    setConnectionStatus('checking');
    setCliLog([]);
    appendLog('$ toque health');
    appendLog('→ Connecting to ' + (watchedBaseUrl || 'https://toque.decloud.workers.dev') + ' ...');
    const result = await toqueHealth();
    setTestLatency(result.latencyMs);
    if (result.attempts && result.attempts > 1)
      appendLog(`  ↻ Retried ${result.attempts - 1}x with exponential backoff`);
    setTestAttempts(result.attempts ?? 1);
    if (result.ok && result.data) {
      setConnectionStatus('connected');
      setHealthData(result.data);
      setLastTestedAt(new Date().toLocaleTimeString('en-US', { hour12: false }));
      localStorage.setItem('toque_connection_status', 'connected');
      appendLog(`✓ GET /health → ${result.status} (${result.latencyMs}ms)  ok: ${result.data.ok}`);
      toast.success('Connection established — backend is healthy');
      void loadEntities();
    } else {
      setConnectionStatus('disconnected');
      const errMsg = result.error || `HTTP ${result.status}`;
      setTestError(
        `GET /health → ${result.status || 'ERR'}: ${errMsg}. Check base URL and API key.`
      );
      if (result.recoveryHint) setRecoveryHint(result.recoveryHint);
      localStorage.setItem('toque_connection_status', 'disconnected');
      appendLog(`✗ GET /health → ${result.status || 'ERR'}: ${errMsg}`);
      if (result.recoveryHint) {
        appendLog(`  ⚑ [${result.recoveryHint.category}] ${result.recoveryHint.title}`);
        appendLog(`  → ${result.recoveryHint.action || result.recoveryHint.hint}`);
      }
      toast.error('Connection failed — see error details below');
    }
    setIsTesting(false);
  };

  const loadEntities = async () => {
    const r = await toqueAuthaEntities(true);
    if (r.ok && r.data?.entities?.length) {
      setEntities(r.data.entities);
      if (!entityId) setEntityId(r.data.entities[0]);
      appendLog(
        `✓ GET /autha/entities → ${r.status} (${r.latencyMs}ms)  ${r.data.entities.length} entities`
      );
    }
  };

  const handleAuthPing = async () => {
    setIsPinging(true);
    appendLog('$ toque auth ping → POST /info');
    const result = await toqueAuthPing();
    if (result.ok) {
      setLastResponse(result.data);
      appendLog(`✓ POST /info → ${result.status} (${result.latencyMs}ms)  authenticated`);
      toast.success(`Auth valid — /info returned ${result.status} in ${result.latencyMs}ms`);
    } else {
      appendLog(`✗ POST /info → ${result.status || 'ERR'}: ${result.error}`);
      toast.error('Auth ping failed: ' + result.error);
    }
    setIsPinging(false);
  };

  const handleAuthRefresh = async () => {
    setIsRefreshing(true);
    appendLog('$ toque auth refresh → POST /refresh-token');
    const result = await toqueAuthRefresh();
    if (result.ok && result.data) {
      setLastResponse(result.data);
      appendLog(
        `✓ POST /refresh-token → ${result.status} (${result.latencyMs}ms)  saved: ${result.data.saved}  method: ${result.data.method}`
      );
      toast.success('Token refreshed (auth.json updated on container)');
    } else {
      appendLog(`✗ POST /refresh-token → ${result.status || 'ERR'}: ${result.error}`);
      toast.error('Token refresh failed: ' + result.error);
    }
    setIsRefreshing(false);
  };

  const handlePull = async () => {
    if (!entityId) {
      toast.error('Enter or select an entity ID first');
      return;
    }
    setIsPulling(true);
    appendLog(`$ toque pull --entity ${entityId} --refresh`);
    const result = await toquePull(entityId, true);
    if (result.ok && result.data) {
      setLastResponse(result.data);
      appendLog(
        `✓ POST /pull → ${result.status} (${result.latencyMs}ms)  auth:${result.data.saved?.auth} captcha:${result.data.saved?.captcha}`
      );
      toast.success('Credentials pulled — auth.json + captcha.json populated. /send is now ready.');
    } else {
      appendLog(`✗ POST /pull → ${result.status || 'ERR'}: ${result.error}`);
      toast.error('Pull failed: ' + result.error);
    }
    setIsPulling(false);
  };

  const onLogin = loginForm.handleSubmit(async (data) => {
    setIsLoggingIn(true);
    setLoginResult(null);
    appendLog(`$ toque login ${data.username} --provider ${data.provider}`);
    const result = await toqueLogin({
      username: data.username,
      password: data.password,
      provider: data.provider,
    });
    if (result.ok && result.data) {
      setLastResponse(result.data);
      if (result.data.otpRequired) {
        setLoginResult({ otpRequired: true, transactionId: result.data.transactionId });
        appendLog(
          `✓ POST /login → ${result.status}  OTP required — transactionId: ${result.data.transactionId}`
        );
        toast.message('OTP required — enter the code sent to your device');
      } else {
        appendLog(
          `✓ POST /login → ${result.status} (${result.latencyMs}ms)  saved: ${result.data.saved}`
        );
        toast.success('Login successful — auth.json populated');
      }
    } else {
      appendLog(`✗ POST /login → ${result.status || 'ERR'}: ${result.error}`);
      toast.error('Login failed: ' + result.error);
    }
    setIsLoggingIn(false);
  });

  const handleVerify = async () => {
    if (!loginResult?.transactionId || !otp) return;
    setIsVerifying(true);
    appendLog(`$ toque verify-login ${loginResult.transactionId}`);
    const result = await toqueVerifyLogin(loginResult.transactionId, otp);
    if (result.ok && result.data) {
      setLastResponse(result.data);
      appendLog(
        `✓ POST /verify-login → ${result.status} (${result.latencyMs}ms)  saved: ${result.data.saved}`
      );
      toast.success('OTP verified — auth.json populated');
      setLoginResult(null);
      setOtp('');
    } else {
      appendLog(`✗ POST /verify-login → ${result.status || 'ERR'}: ${result.error}`);
      toast.error('Verify failed: ' + result.error);
    }
    setIsVerifying(false);
  };

  const onSave = handleSubmit(async (data) => {
    setIsSaving(true);
    localStorage.setItem('toque_base_url', data.baseUrl);
    localStorage.setItem('toque_api_key', data.apiKey);
    localStorage.setItem('toque_jwt', data.jwtToken);
    localStorage.setItem('toque_auth_mode', authMode);
    await new Promise((r) => setTimeout(r, 200));
    setIsSaving(false);
    toast.success('Configuration saved');
  });

  const handleClearAll = () => {
    [
      'toque_base_url',
      'toque_api_key',
      'toque_jwt',
      'toque_auth_mode',
      'toque_connection_status',
    ].forEach((k) => localStorage.removeItem(k));
    setValue('baseUrl', 'https://toque.decloud.workers.dev');
    setValue('apiKey', '');
    setValue('jwtToken', '');
    setAuthMode('api-key');
    setConnectionStatus('disconnected');
    setHealthData(null);
    setTestLatency(null);
    setCliLog([]);
    toast.success('Configuration cleared');
  };

  if (isLoading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <SkeletonBlock height={28} width="220px" />
        <SkeletonBlock height={12} width="340px" />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
          <SkeletonBlock height={320} />
          <SkeletonBlock height={320} />
        </div>
        <SkeletonBlock height={240} />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold" style={{ color: 'var(--foreground)' }}>
            Authentication
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Configure connection &amp; Nusuk auth pipeline — wired to{' '}
            <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>
              GET /health · POST /info · POST /refresh-token · POST /pull · POST /login · POST
              /verify-login
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span
              className="text-xs font-mono px-2 py-1 rounded"
              style={{
                backgroundColor: 'rgba(245,158,11,0.1)',
                color: 'var(--warning)',
                border: '1px solid rgba(245,158,11,0.25)',
              }}
            >
              Unsaved changes
            </span>
          )}
          <StatusBadge status={connectionStatus} />
          {testLatency !== null && <TimingDisplay ms={testLatency} />}
        </div>
      </div>

      <form onSubmit={onSave}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* Connection Config */}
          <SectionCard
            title="Connection Configuration"
            description="Base URL + API key for your Toque Worker endpoint"
            headerRight={
              <span
                className="font-mono text-xs px-2 py-1 rounded"
                style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
              >
                Cloudflare Worker
              </span>
            }
          >
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="baseUrl"
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: 'var(--foreground)' }}
                >
                  Base URL
                </label>
                <input
                  id="baseUrl"
                  type="url"
                  className="input-field w-full px-3 py-2.5 font-mono text-sm"
                  placeholder="https://toque.decloud.workers.dev"
                  {...register('baseUrl', {
                    required: 'Base URL is required',
                    pattern: { value: /^https?:\/\/.+/, message: 'Must be a valid URL' },
                  })}
                />
                {errors.baseUrl && (
                  <p className="mt-1.5 text-xs" style={{ color: 'var(--error)' }}>
                    {errors.baseUrl.message}
                  </p>
                )}
              </div>

              <div
                className="flex items-center gap-2 p-3 rounded font-mono text-xs"
                style={{ backgroundColor: 'var(--input)', border: '1px solid var(--border)' }}
              >
                <Icon name="GlobeAltIcon" size={13} />
                <span style={{ color: 'var(--muted-foreground)' }}>Active endpoint:</span>
                <span className="truncate" style={{ color: 'var(--accent)' }}>
                  {watchedBaseUrl || 'Not set'}
                </span>
              </div>

              <div>
                <label
                  className="block text-sm font-medium mb-2"
                  style={{ color: 'var(--foreground)' }}
                >
                  Authentication Mode
                </label>
                <div className="flex gap-2">
                  {(['api-key', 'jwt'] as AuthMode[]).map((mode) => (
                    <button
                      key={`auth-mode-${mode}`}
                      type="button"
                      onClick={() => setAuthMode(mode)}
                      className="flex-1 py-2 px-3 rounded text-xs font-semibold transition-all duration-150"
                      style={{
                        backgroundColor: authMode === mode ? 'var(--primary)' : 'var(--input)',
                        color: authMode === mode ? 'white' : 'var(--muted-foreground)',
                        border: `1px solid ${authMode === mode ? 'var(--primary)' : 'var(--border)'}`,
                      }}
                    >
                      {mode === 'api-key' ? 'X-API-Key' : 'CF JWT Assertion'}
                    </button>
                  ))}
                </div>
              </div>

              {authMode === 'api-key' ? (
                <div>
                  <label
                    htmlFor="apiKey"
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: 'var(--foreground)' }}
                  >
                    API Key
                  </label>
                  <div className="relative">
                    <input
                      id="apiKey"
                      type={showApiKey ? 'text' : 'password'}
                      className="input-field w-full px-3 py-2.5 font-mono text-sm pr-10"
                      placeholder="autharoot"
                      {...register('apiKey')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                    >
                      <Icon name={showApiKey ? 'EyeSlashIcon' : 'EyeIcon'} size={15} />
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    Sent as <span className="font-mono">X-API-Key</span> header
                  </p>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="jwtToken"
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: 'var(--foreground)' }}
                  >
                    JWT Token
                  </label>
                  <div className="relative">
                    <input
                      id="jwtToken"
                      type={showJwt ? 'text' : 'password'}
                      className="input-field w-full px-3 py-2.5 font-mono text-sm pr-10"
                      placeholder="eyJhbGciOiJSUzI1NiJ9..."
                      {...register('jwtToken')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowJwt((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                    >
                      <Icon name={showJwt ? 'EyeSlashIcon' : 'EyeIcon'} size={15} />
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    Sent as <span className="font-mono">Authorization: Bearer</span> header
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="btn-primary flex-1 py-2.5 text-sm"
                >
                  {isSaving ? <LoadingSpinner size={14} /> : <Icon name="CheckIcon" size={14} />}
                  {isSaving ? 'Saving...' : 'Save Configuration'}
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="btn-ghost px-4 py-2.5 text-sm"
                >
                  <Icon name="TrashIcon" size={14} />
                  Clear
                </button>
              </div>
            </div>
          </SectionCard>

          {/* Connection Test */}
          <SectionCard
            title="Connection Test"
            description="Verify liveness &amp; credentials against the backend"
            headerRight={
              lastTestedAt ? (
                <span className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                  Last: {lastTestedAt}
                </span>
              ) : undefined
            }
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="btn-primary w-full py-3 text-sm font-semibold"
                >
                  {isTesting ? <LoadingSpinner size={16} /> : <Icon name="SignalIcon" size={16} />}
                  {isTesting ? 'Testing...' : 'Test Connection — GET /health'}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleAuthPing}
                    disabled={isPinging}
                    className="btn-ghost py-2.5 text-sm"
                  >
                    {isPinging ? <LoadingSpinner size={14} /> : <Icon name="KeyIcon" size={14} />}
                    Auth Ping (POST /info)
                  </button>
                  <button
                    type="button"
                    onClick={handleAuthRefresh}
                    disabled={isRefreshing}
                    className="btn-ghost py-2.5 text-sm"
                  >
                    {isRefreshing ? (
                      <LoadingSpinner size={14} />
                    ) : (
                      <Icon name="ArrowPathIcon" size={14} />
                    )}
                    Refresh Token
                  </button>
                </div>
              </div>

              {testError && (
                <div className="space-y-3">
                  <ErrorAlert
                    message="Connection failed"
                    detail={testError}
                    onRetry={handleTestConnection}
                  />
                  {testAttempts > 1 && (
                    <div
                      className="flex items-center gap-2 px-3 py-2 rounded text-xs font-mono"
                      style={{
                        backgroundColor: 'rgba(245,158,11,0.08)',
                        border: '1px solid rgba(245,158,11,0.2)',
                        color: 'var(--warning)',
                      }}
                    >
                      <Icon name="ArrowPathIcon" size={12} />
                      <span>
                        Retried {testAttempts - 1}× with exponential backoff — all attempts failed
                      </span>
                    </div>
                  )}
                  {recoveryHint && (
                    <div
                      className="rounded-lg p-3 space-y-2"
                      style={{
                        backgroundColor: 'rgba(239,68,68,0.06)',
                        border: '1px solid rgba(239,68,68,0.2)',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs font-semibold uppercase tracking-wider"
                          style={{
                            backgroundColor:
                              recoveryHint.category === 'timeout'
                                ? 'rgba(245,158,11,0.15)'
                                : recoveryHint.category === 'invalid_auth'
                                  ? 'rgba(168,85,247,0.15)'
                                  : 'rgba(239,68,68,0.15)',
                            color:
                              recoveryHint.category === 'timeout'
                                ? 'var(--warning)'
                                : recoveryHint.category === 'invalid_auth'
                                  ? '#a855f7'
                                  : 'var(--error)',
                          }}
                        >
                          <Icon
                            name={
                              recoveryHint.category === 'timeout'
                                ? 'ClockIcon'
                                : recoveryHint.category === 'invalid_auth'
                                  ? 'KeyIcon'
                                  : 'ExclamationTriangleIcon'
                            }
                            size={10}
                          />
                          {recoveryHint.category.replace('_', ' ')}
                        </span>
                        <span
                          className="text-xs font-semibold"
                          style={{ color: 'var(--foreground)' }}
                        >
                          {recoveryHint.title}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        {recoveryHint.hint}
                      </p>
                      {recoveryHint.action && (
                        <div className="flex items-start gap-2 pt-1">
                          <Icon
                            name="LightBulbIcon"
                            size={12}
                            style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '1px' }}
                          />
                          <p className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
                            {recoveryHint.action}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {cliLog.length > 0 && (
                <div
                  className="rounded-lg p-3 font-mono text-xs space-y-0.5 overflow-y-auto"
                  style={{
                    backgroundColor: '#050508',
                    border: '1px solid var(--border)',
                    maxHeight: '160px',
                  }}
                >
                  {cliLog.map((line, i) => (
                    <div
                      key={`cli-log-${i}`}
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
              )}

              {healthData ? (
                <JsonViewer data={healthData} maxHeight={120} title="GET /health response" />
              ) : null}
              {lastResponse && !testError ? (
                <JsonViewer data={lastResponse} maxHeight={160} title="Last response" />
              ) : null}
            </div>
          </SectionCard>
        </div>
      </form>

      {/* Nusuk Auth Pipeline */}
      <SectionCard
        title="Nusuk Auth Pipeline"
        description="Populate auth.json + captcha.json on the container so /send and /schedule/workflow succeed"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Pull path */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded text-2xs font-mono font-semibold"
                style={{
                  backgroundColor: 'rgba(99,102,241,0.1)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(99,102,241,0.2)',
                }}
              >
                PRIMARY
              </span>
              <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                Pull pre-captured credentials
              </p>
            </div>
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              Loads auth + captcha for an entity from the autha-worker (D1). No password needed.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                className="input-field flex-1 px-3 py-2.5 font-mono text-sm"
                placeholder="entityId e.g. 525513"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                list="auth-entity-list"
              />
              <datalist id="auth-entity-list">
                {entities.map((en) => (
                  <option key={en} value={en} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={handlePull}
                disabled={isPulling}
                className="btn-primary px-4 py-2.5 text-sm"
              >
                {isPulling ? (
                  <LoadingSpinner size={14} />
                ) : (
                  <Icon name="ArrowDownTrayIcon" size={14} />
                )}
                {isPulling ? 'Pulling...' : 'Pull Auth'}
              </button>
            </div>
          </div>

          {/* Login path */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded text-2xs font-mono font-semibold"
                style={{
                  backgroundColor: 'rgba(34,197,94,0.1)',
                  color: 'var(--success)',
                  border: '1px solid rgba(34,197,94,0.2)',
                }}
              >
                FRESH
              </span>
              <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                Login with Nusuk credentials
              </p>
            </div>
            <form onSubmit={onLogin} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  className="input-field px-3 py-2.5 text-sm"
                  placeholder="Username"
                  {...loginForm.register('username', { required: true })}
                />
                <input
                  type="password"
                  className="input-field px-3 py-2.5 text-sm"
                  placeholder="Password"
                  {...loginForm.register('password', { required: true })}
                />
              </div>
              <div className="flex gap-2">
                <select
                  className="input-field flex-1 px-3 py-2.5 text-sm"
                  {...loginForm.register('provider')}
                >
                  <option value="capmonster">capmonster</option>
                  <option value="capsolver">capsolver</option>
                </select>
                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="btn-primary px-4 py-2.5 text-sm"
                >
                  {isLoggingIn ? (
                    <LoadingSpinner size={14} />
                  ) : (
                    <Icon name="ArrowRightOnRectangleIcon" size={14} />
                  )}
                  Login
                </button>
              </div>
            </form>
            {loginResult?.otpRequired && (
              <div className="flex gap-2 pt-1">
                <input
                  type="text"
                  className="input-field flex-1 px-3 py-2.5 font-mono text-sm"
                  placeholder="OTP code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={isVerifying || !otp}
                  className="btn-primary px-4 py-2.5 text-sm"
                >
                  {isVerifying ? <LoadingSpinner size={14} /> : <Icon name="CheckIcon" size={14} />}
                  Verify OTP
                </button>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* CLI Reference */}
      <SectionCard title="CLI Command Reference" description="Toque commands mapped to this panel">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            {
              cmd: 'toque health',
              http: 'GET /health',
              desc: 'Liveness check — returns { ok: true }',
            },
            {
              cmd: 'toque auth ping',
              http: 'POST /info',
              desc: 'Verify credentials (200 = valid)',
            },
            {
              cmd: 'toque auth refresh',
              http: 'POST /refresh-token',
              desc: 'Refresh Nusuk JWT via stored refreshToken',
            },
            {
              cmd: 'toque pull --entity <id>',
              http: 'POST /pull',
              desc: 'Pull auth+captcha from autha-worker',
            },
            {
              cmd: 'toque login <user>',
              http: 'POST /login',
              desc: 'Fresh login (solves captcha, may require OTP)',
            },
            {
              cmd: 'toque verify-login',
              http: 'POST /verify-login',
              desc: 'Complete OTP login → save JWT',
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
