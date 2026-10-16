import { supabase } from '@/lib/supabase/client';
import type { ProfileRow, ProfileUpdateInput } from '../schemas/profile.schema';

const columns = 'id, first_name, last_name, phone, avatar_path, created_at, updated_at';
// userId is a captured auth identity filter; self-only RLS authorizes the caller.
export const profileRepository = {
  getById(userId: string) {
    return supabase
      .from('profiles')
      .select(columns)
      .eq('id', userId)
      .maybeSingle()
      .overrideTypes<ProfileRow, { merge: false }>();
  },
  update(userId: string, input: ProfileUpdateInput) {
    const { first_name, last_name, phone, avatar_path } = input;
    return supabase
      .from('profiles')
      .update({ first_name, last_name, phone, avatar_path })
      .eq('id', userId)
      .select(columns)
      .maybeSingle()
      .overrideTypes<ProfileRow, { merge: false }>();
  },
};
