import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';

import type { BusinessHoursInput } from '../schemas/businessHours.schema';

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
  upsert(
    businessId: string,
    input: BusinessHoursInput,
  ): PromiseLike<PostgrestSingleResponse<BusinessHour[]>> {
    const days = input.map(({ day_of_week, open_time, close_time, is_closed }) => ({
      day_of_week,
      open_time,
      close_time,
      is_closed,
    }));
    return (
      supabase
        .rpc('save_business_hours', { p_business_id: businessId, p_days: days })
        // The RPC RETURNS TABLE is already the exact six-field BF-105 projection.
        .order('day_of_week', { ascending: true })
    );
  },
};
