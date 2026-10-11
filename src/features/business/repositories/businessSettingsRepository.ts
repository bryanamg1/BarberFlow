import { supabase } from '@/lib/supabase/client';

export type BusinessSettings = {
  business_id: string;
  appointment_interval_minutes: number;
  default_service_buffer_minutes: number;
  allow_overlapping_appointments: boolean;
  low_stock_notifications: boolean;
};

export const businessSettingsRepository = {
  getByBusinessId(businessId: string) {
    // businessId selects rows; the existing authenticated client and RLS authorize access.
    return supabase
      .from('business_settings')
      .select(
        'business_id, appointment_interval_minutes, default_service_buffer_minutes, allow_overlapping_appointments, low_stock_notifications',
      )
      .eq('business_id', businessId)
      .maybeSingle()
      .overrideTypes<BusinessSettings, { merge: false }>();
  },
};
