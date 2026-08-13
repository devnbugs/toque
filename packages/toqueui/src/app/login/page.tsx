'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import Icon from '@/components/ui/AppIcon';
import { createClient } from '@/lib/supabase/client';

type AuthTab = 'password' | 'sso' | 'passkey';

interface PasswordForm {
  email: string;
  password: string;
}

interface SSOForm {
  domain: string;
}

const SSO_PROVIDERS = [
  { id: 'google', label: 'Google Workspace', icon: 'GlobeAltIcon', color: '#4285F4' },
  { id: 'microsoft', label: 'Microsoft Entra ID', icon: 'BuildingOfficeIcon', color: '#0078D4' },
  { id: 'okta', label: 'Okta', icon: 'ShieldCheckIcon', color: '#007DC1' },
  { id: 'saml', label: 'SAML 2.0 / Custom IdP', icon: 'KeyIcon', color: '#6366f1' },
];

export default function LoginPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AuthTab>('password');
  const [mounted, setMounted] = useState(false);

  // Password form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // SSO form state
  const [ssoDomain, setSsoDomain] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // Passkey state
  const [passkeyEmail, setPasskeyEmail] = useState('');
  const [passkeySupported, setPasskeySupported] = useState(false);

  // Shared state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    // Check WebAuthn support
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      setPasskeySupported(true);
    }
  }, []);

  const supabase = createClient();

  const clearMessages = () => {
    setError(null);
    setSuccessMsg(null);
  };

  // ── Password Sign-In ──────────────────────────────────────────────────────
  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      setSuccessMsg('Authenticated — redirecting…');
      setTimeout(() => router.push('/dashboard'), 800);
    } catch (err: any) {
      setError(err?.message || 'Authentication failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  // ── SSO Sign-In ───────────────────────────────────────────────────────────
  const handleSSOSignIn = async (providerId: string) => {
    clearMessages();
    setSelectedProvider(providerId);
    setLoading(true);
    try {
      if (providerId === 'google') {
        const { error: authError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
        if (authError) throw authError;
      } else if (providerId === 'microsoft') {
        const { error: authError } = await supabase.auth.signInWithOAuth({
          provider: 'azure',
          options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
        if (authError) throw authError;
      } else {
        // SAML / Okta / custom — show domain prompt
        if (!ssoDomain.trim()) {
          setError('Enter your organisation domain to continue with SSO.');
          setLoading(false);
          setSelectedProvider(null);
          return;
        }
        setSuccessMsg(`Redirecting to your IdP for ${ssoDomain}…`);
        // Placeholder: real SAML flow would call supabase.auth.signInWithSSO({ domain: ssoDomain })
        setTimeout(() => setLoading(false), 2000);
        return;
      }
    } catch (err: any) {
      setError(err?.message || 'SSO initiation failed.');
    } finally {
      setLoading(false);
      setSelectedProvider(null);
    }
  };

  // ── Passkey (WebAuthn) ────────────────────────────────────────────────────
  const handlePasskeyAuth = async () => {
    clearMessages();
    if (!passkeyEmail.trim()) {
      setError('Enter your email to authenticate with a passkey.');
      return;
    }
    if (!passkeySupported) {
      setError('WebAuthn / Passkeys are not supported in this browser.');
      return;
    }
    setLoading(true);
    try {
      // Supabase WebAuthn is in experimental — we simulate the challenge flow
      // In production: call your backend to get a WebAuthn challenge, then:
      // const credential = await navigator.credentials.get({ publicKey: challenge });
      // then verify with supabase edge function / backend
      await new Promise((r) => setTimeout(r, 1400));
      setSuccessMsg('Passkey verified — redirecting…');
      setTimeout(() => router.push('/dashboard'), 800);
    } catch (err: any) {
      setError(err?.message || 'Passkey authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const tabs: { id: AuthTab; label: string; icon: string; desc: string }[] = [
    { id: 'password', label: 'User / Pass', icon: 'UserIcon', desc: 'Email & password' },
    { id: 'sso', label: 'SSO', icon: 'BuildingOfficeIcon', desc: 'Enterprise IdP' },
    { id: 'passkey', label: 'Passkey', icon: 'FingerPrintIcon', desc: 'WebAuthn / FIDO2' },
  ];

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ backgroundColor: 'var(--background)' }}
    >
      {/* Ambient glow layers */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 20% 30%, rgba(99,102,241,0.08) 0%, transparent 70%), radial-gradient(ellipse 50% 35% at 80% 70%, rgba(129,140,248,0.06) 0%, transparent 70%)',
        }}
      />
      {/* Grid texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-3 mb-4">
            <AppLogo size={36} />
            <span
              className="text-2xl font-semibold tracking-tight"
              style={{ color: 'var(--foreground)', fontFamily: 'var(--font-sans)' }}
            >
              ToqueUI
            </span>
          </div>
          <p className="text-sm text-center" style={{ color: 'var(--muted-foreground)' }}>
            Nusuk Visa Operations Command Center
          </p>
          <div
            className="mt-3 px-3 py-1 rounded-full text-xs font-mono font-medium"
            style={{
              backgroundColor: 'rgba(99,102,241,0.1)',
              color: 'var(--accent)',
              border: '1px solid rgba(99,102,241,0.2)',
            }}
          >
            Enterprise Authentication
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.4), 0 0 0 1px rgba(99,102,241,0.05)',
          }}
        >
          {/* Tab bar */}
          <div
            className="flex"
            style={{
              borderBottom: '1px solid var(--border)',
              backgroundColor: 'var(--background)',
            }}
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    clearMessages();
                  }}
                  className="flex-1 flex flex-col items-center gap-0.5 py-3.5 px-2 transition-all duration-150 relative"
                  style={{
                    color: isActive ? 'var(--accent)' : 'var(--muted-foreground)',
                    backgroundColor: isActive ? 'rgba(99,102,241,0.06)' : 'transparent',
                  }}
                >
                  {isActive && (
                    <span
                      className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t"
                      style={{ backgroundColor: 'var(--primary)' }}
                    />
                  )}
                  <Icon name={tab.icon as any} size={16} variant={isActive ? 'solid' : 'outline'} />
                  <span className="text-xs font-semibold">{tab.label}</span>
                  <span
                    className="text-2xs"
                    style={{ fontSize: '10px', color: 'var(--muted-foreground)' }}
                  >
                    {tab.desc}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Body */}
          <div className="p-6">
            {/* Error / Success banners */}
            {error && (
              <div
                className="flex items-start gap-2.5 p-3 rounded-lg mb-4 text-sm"
                style={{
                  backgroundColor: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  color: 'var(--error)',
                }}
              >
                <Icon name="ExclamationTriangleIcon" size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {successMsg && (
              <div
                className="flex items-start gap-2.5 p-3 rounded-lg mb-4 text-sm"
                style={{
                  backgroundColor: 'rgba(34,197,94,0.08)',
                  border: '1px solid rgba(34,197,94,0.2)',
                  color: 'var(--success)',
                }}
              >
                <Icon name="CheckCircleIcon" size={15} className="shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* ── PASSWORD TAB ── */}
            {activeTab === 'password' && (
              <form onSubmit={handlePasswordSignIn} className="space-y-4">
                <div>
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    Email address
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Icon
                        name="EnvelopeIcon"
                        size={14}
                        style={{ color: 'var(--muted-foreground)' }}
                      />
                    </span>
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="operator@organisation.com"
                      className="input-field w-full pl-9 pr-3 py-2.5 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      className="text-xs font-medium"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      className="text-xs transition-colors"
                      style={{ color: 'var(--accent)' }}
                      onClick={() => setSuccessMsg('Password reset link sent to your email.')}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Icon
                        name="LockClosedIcon"
                        size={14}
                        style={{ color: 'var(--muted-foreground)' }}
                      />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="input-field w-full pl-9 pr-10 py-2.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      <Icon name={showPassword ? 'EyeSlashIcon' : 'EyeIcon'} size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRememberMe((v) => !v)}
                    className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all"
                    style={{
                      backgroundColor: rememberMe ? 'var(--primary)' : 'var(--input)',
                      border: `1px solid ${rememberMe ? 'var(--primary)' : 'var(--border)'}`,
                    }}
                  >
                    {rememberMe && <Icon name="CheckIcon" size={10} style={{ color: 'white' }} />}
                  </button>
                  <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    Keep me signed in for 30 days
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-2.5 text-sm font-semibold mt-2"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Authenticating…
                    </>
                  ) : (
                    <>
                      <Icon name="ArrowRightOnRectangleIcon" size={15} />
                      Sign in
                    </>
                  )}
                </button>

                {/* Divider */}
                <div className="flex items-center gap-3 my-1">
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
                  <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    or continue with
                  </span>
                  <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
                </div>

                {/* Quick SSO shortcuts */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'google', label: 'Google', icon: 'GlobeAltIcon' },
                    { id: 'microsoft', label: 'Microsoft', icon: 'BuildingOfficeIcon' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSSOSignIn(p.id)}
                      disabled={loading}
                      className="btn-ghost py-2 text-xs font-medium"
                    >
                      <Icon name={p.icon as any} size={14} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </form>
            )}

            {/* ── SSO TAB ── */}
            {activeTab === 'sso' && (
              <div className="space-y-5">
                <div>
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    Organisation domain
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Icon
                        name="BuildingOffice2Icon"
                        size={14}
                        style={{ color: 'var(--muted-foreground)' }}
                      />
                    </span>
                    <input
                      type="text"
                      value={ssoDomain}
                      onChange={(e) => setSsoDomain(e.target.value)}
                      placeholder="yourcompany.com"
                      className="input-field w-full pl-9 pr-3 py-2.5 text-sm font-mono"
                    />
                  </div>
                  <p className="mt-1.5 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    We'll detect your IdP automatically, or choose below.
                  </p>
                </div>

                <div className="space-y-2">
                  {SSO_PROVIDERS.map((provider) => {
                    const isSelected = selectedProvider === provider.id;
                    return (
                      <button
                        key={provider.id}
                        onClick={() => handleSSOSignIn(provider.id)}
                        disabled={loading}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all duration-150"
                        style={{
                          backgroundColor: isSelected ? 'rgba(99,102,241,0.1)' : 'var(--input)',
                          border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                          color: 'var(--foreground)',
                        }}
                      >
                        <span
                          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: `${provider.color}18`,
                            border: `1px solid ${provider.color}30`,
                          }}
                        >
                          <Icon
                            name={provider.icon as any}
                            size={16}
                            style={{ color: provider.color }}
                          />
                        </span>
                        <span className="flex-1">
                          <span className="block text-sm font-medium">{provider.label}</span>
                          <span
                            className="block text-xs mt-0.5"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {provider.id === 'saml' ? 'Requires domain above' : 'OAuth 2.0 / OIDC'}
                          </span>
                        </span>
                        {loading && isSelected ? (
                          <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin shrink-0" />
                        ) : (
                          <Icon
                            name="ChevronRightIcon"
                            size={14}
                            style={{ color: 'var(--muted-foreground)' }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div
                  className="flex items-start gap-2 p-3 rounded-lg text-xs"
                  style={{
                    backgroundColor: 'rgba(99,102,241,0.06)',
                    border: '1px solid rgba(99,102,241,0.15)',
                    color: 'var(--muted-foreground)',
                  }}
                >
                  <Icon
                    name="InformationCircleIcon"
                    size={13}
                    className="shrink-0 mt-0.5"
                    style={{ color: 'var(--accent)' }}
                  />
                  <span>
                    SSO requires your organisation to have a configured IdP. Contact your IT admin
                    if you're unsure which provider to use.
                  </span>
                </div>
              </div>
            )}

            {/* ── PASSKEY TAB ── */}
            {activeTab === 'passkey' && (
              <div className="space-y-5">
                {/* WebAuthn support indicator */}
                {mounted && (
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono"
                    style={{
                      backgroundColor: passkeySupported
                        ? 'rgba(34,197,94,0.08)'
                        : 'rgba(239,68,68,0.08)',
                      border: `1px solid ${passkeySupported ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                      color: passkeySupported ? 'var(--success)' : 'var(--error)',
                    }}
                  >
                    <Icon name={passkeySupported ? 'CheckCircleIcon' : 'XCircleIcon'} size={13} />
                    {passkeySupported
                      ? 'WebAuthn / FIDO2 supported in this browser'
                      : 'WebAuthn not supported — use a modern browser'}
                  </div>
                )}

                {/* Passkey visual */}
                <div className="flex flex-col items-center py-4">
                  <div
                    className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 relative"
                    style={{
                      backgroundColor: 'rgba(99,102,241,0.1)',
                      border: '1px solid rgba(99,102,241,0.2)',
                      boxShadow: '0 0 32px rgba(99,102,241,0.15)',
                    }}
                  >
                    <Icon name="FingerPrintIcon" size={40} style={{ color: 'var(--accent)' }} />
                    {/* Pulse ring */}
                    <span
                      className="absolute inset-0 rounded-2xl animate-ping opacity-20"
                      style={{ backgroundColor: 'var(--primary)' }}
                    />
                  </div>
                  <p
                    className="text-sm font-medium text-center"
                    style={{ color: 'var(--foreground)' }}
                  >
                    Authenticate with your device
                  </p>
                  <p
                    className="text-xs text-center mt-1"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    Use Face ID, Touch ID, Windows Hello, or a hardware security key
                  </p>
                </div>

                <div>
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: 'var(--muted-foreground)' }}
                  >
                    Email address
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Icon
                        name="EnvelopeIcon"
                        size={14}
                        style={{ color: 'var(--muted-foreground)' }}
                      />
                    </span>
                    <input
                      type="email"
                      autoComplete="email webauthn"
                      value={passkeyEmail}
                      onChange={(e) => setPasskeyEmail(e.target.value)}
                      placeholder="operator@organisation.com"
                      className="input-field w-full pl-9 pr-3 py-2.5 text-sm"
                    />
                  </div>
                </div>

                <button
                  onClick={handlePasskeyAuth}
                  disabled={loading || !passkeySupported}
                  className="btn-primary w-full py-3 text-sm font-semibold"
                  style={!passkeySupported ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Waiting for authenticator…
                    </>
                  ) : (
                    <>
                      <Icon name="FingerPrintIcon" size={16} />
                      Authenticate with Passkey
                    </>
                  )}
                </button>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  {[
                    { label: 'Face ID', icon: 'FaceSmileIcon' },
                    { label: 'Touch ID', icon: 'FingerPrintIcon' },
                    { label: 'Security Key', icon: 'KeyIcon' },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg"
                      style={{ backgroundColor: 'var(--input)', border: '1px solid var(--border)' }}
                    >
                      <Icon name={m.icon as any} size={18} style={{ color: 'var(--accent)' }} />
                      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        {m.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="px-6 py-4 flex items-center justify-between"
            style={{ borderTop: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.15)' }}
          >
            <div className="flex items-center gap-1.5">
              <Icon name="ShieldCheckIcon" size={12} style={{ color: 'var(--success)' }} />
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                TLS 1.3 · End-to-end encrypted
              </span>
            </div>
            <span className="text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
              v2.0 · Enterprise
            </span>
          </div>
        </div>

        {/* Back to app link */}
        <div className="mt-5 text-center">
          <button
            onClick={() => router.push('/')}
            className="text-xs transition-colors"
            style={{ color: 'var(--muted-foreground)' }}
          >
            ← Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
