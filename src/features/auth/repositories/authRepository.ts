import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';

export type SignInCredentials = {
  email: string;
  password: string;
};

export type AuthStateChangeCallback = (event: AuthChangeEvent, session: Session | null) => void;

export const authRepository = {
  signInWithPassword({ email, password }: SignInCredentials) {
    return supabase.auth.signInWithPassword({ email, password });
  },

  // Local session state is not a server-side authorization check.
  getSession() {
    return supabase.auth.getSession();
  },

  getUser() {
    return supabase.auth.getUser();
  },

  signOut() {
    return supabase.auth.signOut({ scope: 'local' });
  },

  onAuthStateChange(callback: AuthStateChangeCallback) {
    return supabase.auth.onAuthStateChange(callback).data.subscription;
  },
};
