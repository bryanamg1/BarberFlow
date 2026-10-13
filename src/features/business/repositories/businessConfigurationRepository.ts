import { supabase } from '@/lib/supabase/client';

import type {
  BusinessProfileInput,
  UpdateBusinessProfileInput,
} from '../schemas/businessSettings.schema';

export type BusinessConfiguration = BusinessProfileInput & { id: string };
const columns = 'id, name, phone, email, address, currency_code, timezone';
export const businessConfigurationRepository = {
  getByBusinessId(businessId: string) {
    return supabase
      .from('businesses')
      .select(columns)
      .eq('id', businessId)
      .maybeSingle()
      .overrideTypes<BusinessConfiguration, { merge: false }>();
  },
  update(businessId: string, input: UpdateBusinessProfileInput) {
    const { name, phone, email, address, currency_code, timezone } = input;
    return supabase
      .from('businesses')
      .update({ name, phone, email, address, currency_code, timezone })
      .eq('id', businessId)
      .select(columns)
      .maybeSingle()
      .overrideTypes<BusinessConfiguration, { merge: false }>();
  },
};
