'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_COLORS, ROLE_LABELS, type UserRole } from '@/lib/rbac';

interface TeamMember {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  suspended_at: string | null;
  suspension_reason: string | null;
  permissions: Record<string, boolean>;
  created_at: string;
}

const PANEL_KEYS = [
  'send-visa',
  'schedule',
  'captcha',
  'benchmarking',
  'pulling',
  'network',
  'api-builder',
] as const;

const PANEL_LABELS: Record<string, string> = {
  'send-visa': 'Send Visa',
  schedule: 'Schedule',
  captcha: 'Captcha',
  benchmarking: 'Benchmarking',
  pulling: 'Pulling',
  network: 'Network',
  'api-builder': 'API Builder',
};

type ModalMode = 'create' | 'edit-role' | 'suspend' | 'permissions' | null;

export default function TeamManagementContent() {
  const supabase = createClient();
  const { user, logAudit } = useAuth();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  // Create operator form
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('operator');
  const [creating, setCreating] = useState(false);

  // Edit role
  const [editRole, setEditRole] = useState<UserRole>('operator');
  const [saving, setSaving] = useState(false);

  // Suspend
  const [suspendReason, setSuspendReason] = useState('');

  // Permissions
  const [editPerms, setEditPerms] = useState<Record<string, boolean>>({});

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('user_profiles')
        .select(
          'id, email, full_name, role, suspended_at, suspension_reason, permissions, created_at'
        )
        .order('created_at', { ascending: false });
      if (err) throw err;
      setMembers((data as TeamMember[]) ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load team members');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3500);
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedMember(null);
    setNewEmail('');
    setNewName('');
    setNewPassword('');
    setNewRole('operator');
    setSuspendReason('');
    setEditPerms({});
  };

  // ── Create operator account ──────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      // Use Supabase admin signUp — creates auth user + triggers handle_new_user
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: newEmail,
        password: newPassword,
        options: {
          data: { full_name: newName, role: newRole },
          emailRedirectTo: `${siteUrl}/auth/callback`,
        },
      });
      if (signUpErr) throw signUpErr;
      if (data.user) {
        // Upsert profile with correct role (trigger may default to viewer)
        await supabase.from('user_profiles').upsert({
          id: data.user.id,
          email: newEmail,
          full_name: newName,
          role: newRole,
        });
        await logAudit('team_create_account', 'team-management', {
          target_email: newEmail,
          assigned_role: newRole,
        });
      }
      showSuccess(`Account created for ${newEmail}`);
      closeModal();
      fetchMembers();
    } catch (e: any) {
      setError(e.message ?? 'Failed to create account');
    } finally {
      setCreating(false);
    }
  };

  // ── Change role ──────────────────────────────────────────────────────────
  const handleRoleChange = async () => {
    if (!selectedMember) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from('user_profiles')
        .update({ role: editRole })
        .eq('id', selectedMember.id);
      if (err) throw err;
      await logAudit('team_role_change', 'team-management', {
        target_email: selectedMember.email,
        old_role: selectedMember.role,
        new_role: editRole,
      });
      showSuccess(`Role updated to ${ROLE_LABELS[editRole]} for ${selectedMember.email}`);
      closeModal();
      fetchMembers();
    } catch (e: any) {
      setError(e.message ?? 'Failed to update role');
    } finally {
      setSaving(false);
    }
  };

  // ── Suspend / Reactivate ─────────────────────────────────────────────────
  const handleSuspend = async () => {
    if (!selectedMember) return;
    setSaving(true);
    setError(null);
    const isSuspended = !!selectedMember.suspended_at;
    try {
      const update = isSuspended
        ? { suspended_at: null, suspended_by: null, suspension_reason: null }
        : {
            suspended_at: new Date().toISOString(),
            suspended_by: user?.id,
            suspension_reason: suspendReason || null,
          };
      const { error: err } = await supabase
        .from('user_profiles')
        .update(update)
        .eq('id', selectedMember.id);
      if (err) throw err;
      await logAudit(isSuspended ? 'team_reactivate' : 'team_suspend', 'team-management', {
        target_email: selectedMember.email,
        reason: suspendReason || null,
      });
      showSuccess(
        isSuspended ? `${selectedMember.email} reactivated` : `${selectedMember.email} suspended`
      );
      closeModal();
      fetchMembers();
    } catch (e: any) {
      setError(e.message ?? 'Failed to update suspension');
    } finally {
      setSaving(false);
    }
  };

  // ── Save permissions ─────────────────────────────────────────────────────
  const handleSavePermissions = async () => {
    if (!selectedMember) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from('user_profiles')
        .update({ permissions: editPerms })
        .eq('id', selectedMember.id);
      if (err) throw err;
      await logAudit('team_permissions_update', 'team-management', {
        target_email: selectedMember.email,
        permissions: editPerms,
      });
      showSuccess(`Permissions updated for ${selectedMember.email}`);
      closeModal();
      fetchMembers();
    } catch (e: any) {
      setError(e.message ?? 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const openEditRole = (m: TeamMember) => {
    setSelectedMember(m);
    setEditRole(m.role);
    setModalMode('edit-role');
  };

  const openSuspend = (m: TeamMember) => {
    setSelectedMember(m);
    setSuspendReason('');
    setModalMode('suspend');
  };

  const openPermissions = (m: TeamMember) => {
    setSelectedMember(m);
    setEditPerms({ ...(m.permissions ?? {}) });
    setModalMode('permissions');
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
            Team Management
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            Create operator accounts, assign roles, manage permissions and suspend users.
          </p>
        </div>
        <button
          onClick={() => setModalMode('create')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Operator
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm flex items-start gap-2"
          style={{
            backgroundColor: 'var(--error, #ef4444)15',
            borderColor: 'var(--error, #ef4444)40',
            color: '#f87171',
          }}
        >
          <svg
            className="w-4 h-4 mt-0.5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
          {error}
        </div>
      )}
      {success && (
        <div
          className="rounded-lg border px-4 py-3 text-sm flex items-start gap-2"
          style={{ backgroundColor: '#22c55e15', borderColor: '#22c55e40', color: '#4ade80' }}
        >
          <svg
            className="w-4 h-4 mt-0.5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {success}
        </div>
      )}

      {/* Members Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-3.5 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Team Members
            <span
              className="ml-2 px-1.5 py-0.5 rounded text-xs font-mono"
              style={{ backgroundColor: 'var(--accent)20', color: 'var(--accent)' }}
            >
              {members.length}
            </span>
          </span>
          <button
            onClick={fetchMembers}
            className="text-xs px-2.5 py-1 rounded transition-colors hover:bg-white/5"
            style={{ color: 'var(--muted-foreground)' }}
          >
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-16" style={{ color: 'var(--muted-foreground)' }}>
            <svg
              className="w-10 h-10 mx-auto mb-3 opacity-40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <p className="text-sm">No team members found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  style={{
                    borderBottom: '1px solid var(--border)',
                    backgroundColor: 'var(--background)',
                  }}
                >
                  {['User', 'Role', 'Status', 'Joined', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m, idx) => (
                  <tr
                    key={m.id}
                    style={{
                      borderBottom: idx < members.length - 1 ? '1px solid var(--border)' : 'none',
                      opacity: m.suspended_at ? 0.6 : 1,
                    }}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ backgroundColor: 'var(--accent)20', color: 'var(--accent)' }}
                        >
                          {(m.full_name || m.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p
                            className="font-medium truncate"
                            style={{ color: 'var(--foreground)' }}
                          >
                            {m.full_name || '—'}
                          </p>
                          <p
                            className="text-xs truncate"
                            style={{ color: 'var(--muted-foreground)' }}
                          >
                            {m.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${ROLE_COLORS[m.role]}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
                        {ROLE_LABELS[m.role]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {m.suspended_at ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border text-red-400 bg-red-400/10 border-red-400/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          Suspended
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border text-green-400 bg-green-400/10 border-green-400/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className="text-xs font-mono"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {formatDate(m.created_at)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {/* Don't allow self-modification */}
                      {m.id !== user?.id ? (
                        <div className="flex items-center gap-1.5">
                          <ActionBtn
                            label="Role"
                            icon="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                            onClick={() => openEditRole(m)}
                            color="text-blue-400"
                          />
                          <ActionBtn
                            label="Perms"
                            icon="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                            onClick={() => openPermissions(m)}
                            color="text-yellow-400"
                          />
                          <ActionBtn
                            label={m.suspended_at ? 'Activate' : 'Suspend'}
                            icon={
                              m.suspended_at
                                ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                                : 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636'
                            }
                            onClick={() => openSuspend(m)}
                            color={m.suspended_at ? 'text-green-400' : 'text-red-400'}
                          />
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                          You
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border shadow-2xl"
            style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
          >
            {/* Create Operator */}
            {modalMode === 'create' && (
              <form onSubmit={handleCreate}>
                <ModalHeader title="Create Operator Account" onClose={closeModal} />
                <div className="p-5 space-y-4">
                  <Field label="Full Name">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Jane Smith"
                      required
                      className="input-field w-full"
                    />
                  </Field>
                  <Field label="Email Address">
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="jane@example.com"
                      required
                      className="input-field w-full"
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      minLength={8}
                      required
                      className="input-field w-full"
                    />
                  </Field>
                  <Field label="Role">
                    <RoleSelect value={newRole} onChange={setNewRole} />
                  </Field>
                  {error && <p className="text-xs text-red-400">{error}</p>}
                </div>
                <ModalFooter
                  onClose={closeModal}
                  onConfirm={undefined}
                  confirmLabel="Create Account"
                  loading={creating}
                  isSubmit
                />
              </form>
            )}

            {/* Edit Role */}
            {modalMode === 'edit-role' && selectedMember && (
              <div>
                <ModalHeader title="Change Role" onClose={closeModal} />
                <div className="p-5 space-y-4">
                  <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    Changing role for{' '}
                    <strong style={{ color: 'var(--foreground)' }}>{selectedMember.email}</strong>
                  </p>
                  <Field label="New Role">
                    <RoleSelect value={editRole} onChange={setEditRole} />
                  </Field>
                  {error && <p className="text-xs text-red-400">{error}</p>}
                </div>
                <ModalFooter
                  onClose={closeModal}
                  onConfirm={handleRoleChange}
                  confirmLabel="Save Role"
                  loading={saving}
                />
              </div>
            )}

            {/* Suspend / Reactivate */}
            {modalMode === 'suspend' && selectedMember && (
              <div>
                <ModalHeader
                  title={selectedMember.suspended_at ? 'Reactivate User' : 'Suspend User'}
                  onClose={closeModal}
                />
                <div className="p-5 space-y-4">
                  {selectedMember.suspended_at ? (
                    <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                      Reactivate{' '}
                      <strong style={{ color: 'var(--foreground)' }}>{selectedMember.email}</strong>
                      ? They will regain access to their assigned panels.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                        Suspend{' '}
                        <strong style={{ color: 'var(--foreground)' }}>
                          {selectedMember.email}
                        </strong>
                        ? They will lose access immediately.
                      </p>
                      <Field label="Reason (optional)">
                        <input
                          type="text"
                          value={suspendReason}
                          onChange={(e) => setSuspendReason(e.target.value)}
                          placeholder="Policy violation, inactivity…"
                          className="input-field w-full"
                        />
                      </Field>
                    </>
                  )}
                  {error && <p className="text-xs text-red-400">{error}</p>}
                </div>
                <ModalFooter
                  onClose={closeModal}
                  onConfirm={handleSuspend}
                  confirmLabel={selectedMember.suspended_at ? 'Reactivate' : 'Suspend'}
                  loading={saving}
                  danger={!selectedMember.suspended_at}
                />
              </div>
            )}

            {/* Permissions */}
            {modalMode === 'permissions' && selectedMember && (
              <div>
                <ModalHeader title="Manage Panel Permissions" onClose={closeModal} />
                <div className="p-5 space-y-3">
                  <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                    Override panel access for{' '}
                    <strong style={{ color: 'var(--foreground)' }}>{selectedMember.email}</strong>.
                    These override role defaults.
                  </p>
                  <div className="space-y-2 mt-3">
                    {PANEL_KEYS.map((panel) => (
                      <label
                        key={panel}
                        className="flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-white/5"
                        style={{ border: '1px solid var(--border)' }}
                      >
                        <span
                          className="text-sm font-medium"
                          style={{ color: 'var(--foreground)' }}
                        >
                          {PANEL_LABELS[panel]}
                        </span>
                        <div className="relative">
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={editPerms[panel] ?? false}
                            onChange={(e) =>
                              setEditPerms((prev) => ({ ...prev, [panel]: e.target.checked }))
                            }
                          />
                          <div
                            className="w-9 h-5 rounded-full transition-colors"
                            style={{
                              backgroundColor: editPerms[panel] ? 'var(--accent)' : 'var(--border)',
                            }}
                          >
                            <div
                              className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                              style={{
                                transform: editPerms[panel]
                                  ? 'translateX(18px)'
                                  : 'translateX(2px)',
                              }}
                            />
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                  {error && <p className="text-xs text-red-400">{error}</p>}
                </div>
                <ModalFooter
                  onClose={closeModal}
                  onConfirm={handleSavePermissions}
                  confirmLabel="Save Permissions"
                  loading={saving}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ActionBtn({
  label,
  icon,
  onClick,
  color,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors hover:bg-white/5 ${color}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
      </svg>
      {label}
    </button>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      className="flex items-center justify-between px-5 py-4"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
        {title}
      </h2>
      <button
        onClick={onClose}
        className="p-1 rounded transition-colors hover:bg-white/10"
        style={{ color: 'var(--muted-foreground)' }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

function ModalFooter({
  onClose,
  onConfirm,
  confirmLabel,
  loading,
  danger,
  isSubmit,
}: {
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel: string;
  loading: boolean;
  danger?: boolean;
  isSubmit?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-end gap-2 px-5 py-4"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/5"
        style={{ color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}
      >
        Cancel
      </button>
      <button
        type={isSubmit ? 'submit' : 'button'}
        onClick={isSubmit ? undefined : onConfirm}
        disabled={loading}
        className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
        style={{
          backgroundColor: danger ? '#ef4444' : 'var(--accent)',
          color: danger ? '#fff' : 'var(--accent-foreground)',
        }}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
            {confirmLabel}
          </span>
        ) : (
          confirmLabel
        )}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label
        className="block text-xs font-semibold uppercase tracking-wider"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: UserRole; onChange: (r: UserRole) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as UserRole)}
      className="input-field w-full"
    >
      <option value="admin">Admin — Full access</option>
      <option value="operator">Operator — Restricted access</option>
      <option value="viewer">Viewer — Read-only access</option>
    </select>
  );
}
