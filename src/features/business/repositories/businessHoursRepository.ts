import { supabase } from '@/lib/supabase/client';

export type BusinessHour = {
  id: string;
  business_id: string;
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  open_time: string;
  close_time: string;
  is_closed: boolean;
};

export const businessHoursRepository = {
  getByBusinessId(businessId: string) {
    // businessId selects rows; the existing authenticated client and RLS authorize access.
    return supabase
      .from('business_hours')
      .select('id, business_id, day_of_week, open_time, close_time, is_closed')
      .eq('business_id', businessId)
      .order('day_of_week', { ascending: true })
      .overrideTypes<BusinessHour[], { merge: false }>();
  },
};
