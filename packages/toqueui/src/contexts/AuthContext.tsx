'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { UserRole } from '@/lib/rbac';

const AuthContext = createContext<any>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  // During static prerender the provider may be absent; return a safe default
  // instead of throwing so client components that call useAuth don't break SSG.
  if (!context) {
    return {
      user: null,
      session: null,
      loading: true,
      userRole: null,
      signUp: async () => {},
      signIn: async () => {},
      signOut: async () => {},
      getCurrentUser: async () => null,
      isEmailVerified: () => false,
      getUserProfile: async () => null,
      logAudit: async () => {},
    };
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const supabase = createClient();

  const fetchUserRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', userId)
        .single();
      if (!error && data?.role) {
        setUserRole(data.role as UserRole);
      } else {
        setUserRole('viewer');
      }
    } catch {
      setUserRole('viewer');
    }
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchUserRole(session.user.id);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchUserRole(session.user.id);
      } else {
        setUserRole(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Email/Password Sign Up
  const signUp = async (email: string, password: string, metadata = {}) => {
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: (metadata as any)?.fullName || '',
          avatar_url: (metadata as any)?.avatarUrl || '',
        },
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    });
    if (error) throw error;
    return data;
  };

  // Email/Password Sign In
  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  // Sign Out
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  // Get Current User
  const getCurrentUser = async () => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
  };

  // Check if Email is Verified
  const isEmailVerified = () => {
    return user?.email_confirmed_at !== null;
  };

  // Get User Profile from Database
  const getUserProfile = async () => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    return data;
  };

  // Log an audit event
  const logAudit = async (action: string, panel?: string, details?: Record<string, any>) => {
    if (!user) return;
    try {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        user_email: user.email,
        action,
        panel: panel ?? null,
        details: details ?? {},
      });
    } catch {
      // Silently fail — audit logging should not break the app
    }
  };

  const value = {
    user,
    session,
    loading,
    userRole,
    signUp,
    signIn,
    signOut,
    getCurrentUser,
    isEmailVerified,
    getUserProfile,
    logAudit,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
