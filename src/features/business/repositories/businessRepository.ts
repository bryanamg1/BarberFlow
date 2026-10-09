import { supabase } from '@/lib/supabase/client';

export type BusinessMembership = {
  id: string;
  user_id: string;
  business_id: string;
  role: 'OWNER' | 'BARBER';
  is_active: boolean;
  business: {
    id: string;
    name: string;
    currency_code: string;
    timezone: string;
    is_active: boolean;
  } | null;
};

export const businessRepository = {
  getActiveMembershipsByUserId(userId: string) {
    // userId selects rows; the caller's existing authenticated client and RLS authorize access.
    return supabase
      .from('business_members')
      .select(
        'id, user_id, business_id, role, is_active, business:businesses(id, name, currency_code, timezone, is_active)',
      )
      .eq('user_id', userId)
      .eq('is_active', true)
      .overrideTypes<BusinessMembership[], { merge: false }>();
  },
};
