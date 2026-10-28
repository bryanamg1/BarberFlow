import { supabase } from '@/lib/supabase/client';

export const homeRepository = {
  getNextAppointment(businessId: string, signal?: AbortSignal) {
    const query = supabase.rpc('get_next_appointment', { p_business_id: businessId });
    return signal ? query.abortSignal(signal) : query;
  },
};
