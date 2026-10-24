import { supabase } from '@/lib/supabase/client';

export type WorkingMember = { id: string; role: 'OWNER' | 'BARBER'; is_active: boolean };

export const businessDirectoryRepository = {
  listWorkingMembers(businessId: string, membershipId?: string) {
    let query = supabase
      .from('business_members')
      .select('id, role, is_active')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .in('role', ['OWNER', 'BARBER']);
    // The hook supplies only the BARBER's current authorized membership, never a route/user ID.
    if (membershipId !== undefined) query = query.eq('id', membershipId);
    return query
      .order('id', { ascending: true })
      .overrideTypes<WorkingMember[], { merge: false }>();
  },
};
