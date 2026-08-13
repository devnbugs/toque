import { createBrowserClient } from '@supabase/ssr';

/**
 * Create a Supabase browser client.
 * Falls back to a no-op stub when env vars are absent (e.g. during static
 * prerendering or local builds without Supabase configured) so that pages
 * calling createClient() at module load don't crash the build.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Return a minimal stub that won't crash but signals unconfigured state.
    return {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
        getUser: async () => ({ data: { user: null }, error: null }),
        signInWithPassword: async () => ({ data: null, error: new Error('Supabase not configured') }),
        signUp: async () => ({ data: null, error: new Error('Supabase not configured') }),
        signOut: async () => ({ error: null }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
        insert: async () => ({ error: null }),
        update: async () => ({ error: null }),
        delete: async () => ({ error: null }),
      }),
    } as any;
  }

  return createBrowserClient(url, anonKey);
}
