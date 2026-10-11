import type {
  CreateClientInput,
  UpdateClientInput,
} from '@/features/clients/schemas/client.schema';
import { supabase } from '@/lib/supabase/client';

export type ClientRow = {
  id: string;
  business_id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  birth_date: string | null;
  notes: string | null;
  preferences: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const columns =
  'id, business_id, first_name, last_name, phone, email, instagram, birth_date, notes, preferences, is_active, created_at, updated_at';

export const clientsRepository = {
  getById(businessId: string, clientId: string) {
    // IDs select rows; the existing authenticated client and RLS authorize access.
    return supabase
      .from('clients')
      .select(columns)
      .eq('business_id', businessId)
      .eq('id', clientId)
      .maybeSingle()
      .overrideTypes<ClientRow, { merge: false }>();
  },

  create(businessId: string, input: CreateClientInput) {
    return supabase
      .from('clients')
      .insert({
        business_id: businessId,
        first_name: input.first_name,
        last_name: input.last_name,
        phone: input.phone,
        email: input.email,
        instagram: input.instagram,
        birth_date: input.birth_date,
        notes: input.notes,
        preferences: input.preferences,
      })
      .select(columns)
      .single()
      .overrideTypes<ClientRow, { merge: false }>();
  },

  update(businessId: string, clientId: string, input: UpdateClientInput) {
    const payload: UpdateClientInput = {};
    if (input.first_name !== undefined) payload.first_name = input.first_name;
    if (input.last_name !== undefined) payload.last_name = input.last_name;
    if (input.phone !== undefined) payload.phone = input.phone;
    if (input.email !== undefined) payload.email = input.email;
    if (input.instagram !== undefined) payload.instagram = input.instagram;
    if (input.birth_date !== undefined) payload.birth_date = input.birth_date;
    if (input.notes !== undefined) payload.notes = input.notes;
    if (input.preferences !== undefined) payload.preferences = input.preferences;
    if (input.is_active !== undefined) payload.is_active = input.is_active;

    return supabase
      .from('clients')
      .update(payload)
      .eq('business_id', businessId)
      .eq('id', clientId)
      .select(columns)
      .maybeSingle()
      .overrideTypes<ClientRow, { merge: false }>();
  },
};
