import { authStorage } from '@/lib/supabase/storage';

const key = 'barberflow.auth.recovery-pending.v1';
let persistenceFailed = false;

// This key contains only a purpose flag. Supabase owns all credentials and PKCE data.
export const recoveryIntent = {
  activate() {
    try {
      if (!authStorage) throw new Error('Recovery storage unavailable.');
      authStorage.setItem(key, '1');
      persistenceFailed = false;
    } catch {
      persistenceFailed = true;
    }
  },
  clear() {
    authStorage?.removeItem(key);
    persistenceFailed = false;
  },
  isPending() {
    // Never reinterpret a recovery session as normal Auth after a storage failure.
    if (persistenceFailed) throw new Error('Recovery storage unavailable.');
    return authStorage?.getItem(key) === '1';
  },
};
