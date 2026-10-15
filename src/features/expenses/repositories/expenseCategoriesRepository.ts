import { supabase } from '@/lib/supabase/client';

import type {
  CreateExpenseCategoryInput,
  UpdateExpenseCategoryInput,
} from '../schemas/expenseCategory.schema';
import type { ExpenseCategoryListParams } from '../types/expenseCategory.types';

export type ExpenseCategoryRow = {
  id: string;
  business_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const columns = 'id, business_id, name, is_active, created_at, updated_at';

export const expenseCategoriesRepository = {
  getById(businessId: string, expenseCategoryId: string) {
    return supabase
      .from('expense_categories')
      .select(columns)
      .eq('business_id', businessId)
      .eq('id', expenseCategoryId)
      .maybeSingle()
      .overrideTypes<ExpenseCategoryRow, { merge: false }>();
  },

  create(businessId: string, input: CreateExpenseCategoryInput) {
    return supabase
      .from('expense_categories')
      .insert({
        business_id: businessId,
        name: input.name,
      })
      .select(columns)
      .single()
      .overrideTypes<ExpenseCategoryRow, { merge: false }>();
  },

  update(businessId: string, expenseCategoryId: string, input: UpdateExpenseCategoryInput) {
    const payload: UpdateExpenseCategoryInput = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.is_active !== undefined) payload.is_active = input.is_active;

    return supabase
      .from('expense_categories')
      .update(payload)
      .eq('business_id', businessId)
      .eq('id', expenseCategoryId)
      .select(columns)
      .maybeSingle()
      .overrideTypes<ExpenseCategoryRow, { merge: false }>();
  },

  listByBusiness(businessId: string, params: Required<ExpenseCategoryListParams>) {
    const from = (params.page - 1) * params.pageSize;
    let query = supabase.from('expense_categories').select(columns).eq('business_id', businessId);
    if (params.status !== 'all') query = query.eq('is_active', params.status === 'active');
    return query
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + params.pageSize)
      .overrideTypes<ExpenseCategoryRow[], { merge: false }>();
  },
};
