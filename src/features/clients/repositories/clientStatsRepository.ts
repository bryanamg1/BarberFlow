import { supabase } from '@/lib/supabase/client';

export const clientStatsRepository = {
  getByClient(businessId: string, clientId: string) {
    // Cast on the server, before the SDK parses JSON numbers. Never select '*'.
    return supabase
      .rpc('get_client_stats', { p_business_id: businessId, p_client_id: clientId })
      .select(
        'total_appointments::text,completed_visits::text,no_show_count::text,last_visit_at,next_appointment_at,total_spent::text',
      );
  },
};
