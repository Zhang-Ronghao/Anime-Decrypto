import { createClient, type Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
    })
  : null;

export async function ensureSession(): Promise<Session | null> {
  if (!supabase) {
    return null;
  }

  const { data } = await supabase.auth.getSession();
  if (data.session) {
    return data.session;
  }

  const signInResult = await supabase.auth.signInAnonymously();
  if (signInResult.error) {
    throw signInResult.error;
  }

  return signInResult.data.session;
}
