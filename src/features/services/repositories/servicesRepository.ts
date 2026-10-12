import { supabase } from '@/lib/supabase/client';

import type { CreateServiceInput, UpdateServiceInput } from '../schemas/service.schema';
import type { ServiceListParams } from '../types/service.types';

export type ServiceRow = {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  price: number;
  duration_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const columns =
  'id, business_id, name, description, price, duration_minutes, is_active, created_at, updated_at';

export const servicesRepository = {
  getById(businessId: string, serviceId: string) {
    return supabase
      .from('services')
      .select(columns)
      .eq('business_id', businessId)
      .eq('id', serviceId)
      .maybeSingle()
      .overrideTypes<ServiceRow, { merge: false }>();
  },

  create(businessId: string, input: CreateServiceInput) {
    return supabase
      .from('services')
      .insert({
        business_id: businessId,
        name: input.name,
        description: input.description,
        price: input.price,
        duration_minutes: input.duration_minutes,
      })
      .select(columns)
      .single()
      .overrideTypes<ServiceRow, { merge: false }>();
  },

  update(businessId: string, serviceId: string, input: UpdateServiceInput) {
    const payload: UpdateServiceInput = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.description !== undefined) payload.description = input.description;
    if (input.price !== undefined) payload.price = input.price;
    if (input.duration_minutes !== undefined) payload.duration_minutes = input.duration_minutes;
    if (input.is_active !== undefined) payload.is_active = input.is_active;

    return supabase
      .from('services')
      .update(payload)
      .eq('business_id', businessId)
      .eq('id', serviceId)
      .select(columns)
      .maybeSingle()
      .overrideTypes<ServiceRow, { merge: false }>();
  },

  listByBusiness(businessId: string, params: Required<ServiceListParams>) {
    const from = (params.page - 1) * params.pageSize;
    let query = supabase.from('services').select(columns).eq('business_id', businessId);
    if (params.status !== 'all') query = query.eq('is_active', params.status === 'active');
    return query
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + params.pageSize)
      .overrideTypes<ServiceRow[], { merge: false }>();
  },
};
