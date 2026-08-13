'use client';

import React, { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessPanel, getAccessDeniedMessage, type Panel } from '@/lib/rbac';
import { useRouter } from 'next/navigation';

interface RoleGuardProps {
  panel: Panel;
  children: React.ReactNode;
}

export default function RoleGuard({ panel, children }: RoleGuardProps) {
  const { user, userRole, loading, logAudit } = useAuth();
  const router = useRouter();
  const loggedRef = useRef(false);

  const hasAccess = canAccessPanel(userRole, panel);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!hasAccess && !loggedRef.current) {
      loggedRef.current = true;
      logAudit('panel_access', panel, {
        status: 'denied',
        reason: 'insufficient_role',
        role: userRole,
      });
    }
    if (hasAccess && !loggedRef.current) {
      loggedRef.current = true;
      logAudit('panel_access', panel, { status: 'granted', role: userRole });
    }
  }, [loading, user, hasAccess, panel, userRole]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Checking permissions…
          </p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[400px] px-6">
        <div
          className="max-w-md w-full rounded-xl border p-8 text-center"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: 'var(--error, #ef4444)20' }}
          >
            <svg
              className="w-8 h-8 text-red-400"
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
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            Access Restricted
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
            {getAccessDeniedMessage(userRole, panel)}
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="mt-6 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
