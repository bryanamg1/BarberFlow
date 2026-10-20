import { supabase } from '@/lib/supabase/client';

import type { CreateManualExpenseInput, UpdateManualExpenseInput } from '../schemas/expense.schema';
import type { ExpenseRow, ResolvedExpenseListParams } from '../types/expense.types';

const columns =
  'id, business_id, category_id, source_type, purchase_id, description, amount, payment_method, expense_date, receipt_path, notes, created_by, created_at, updated_at';

function manualFields(input: UpdateManualExpenseInput) {
  const payload: UpdateManualExpenseInput = {};
  if (input.category_id !== undefined) payload.category_id = input.category_id;
  if (input.description !== undefined) payload.description = input.description;
  if (input.amount !== undefined) payload.amount = input.amount;
  if (input.payment_method !== undefined) payload.payment_method = input.payment_method;
  if (input.expense_date !== undefined) payload.expense_date = input.expense_date;
  if (input.receipt_path !== undefined) payload.receipt_path = input.receipt_path;
  if (input.notes !== undefined) payload.notes = input.notes;
  return payload;
}

export const expensesRepository = {
  listByBusiness(businessId: string, params: ResolvedExpenseListParams) {
    const offset = (params.page - 1) * params.pageSize;
    let query = supabase.from('expenses').select(columns).eq('business_id', businessId);
    if (params.sourceType !== undefined) query = query.eq('source_type', params.sourceType);
    if (params.categoryId !== undefined) query = query.eq('category_id', params.categoryId);
    if (params.from !== undefined) query = query.gte('expense_date', params.from);
    if (params.to !== undefined) query = query.lt('expense_date', params.to);
    return query
      .order('expense_date', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + params.pageSize)
      .overrideTypes<ExpenseRow[], { merge: false }>();
  },

  getById(businessId: string, expenseId: string) {
    return supabase
      .from('expenses')
      .select(columns)
      .eq('business_id', businessId)
      .eq('id', expenseId)
      .maybeSingle()
      .overrideTypes<ExpenseRow, { merge: false }>();
  },

  async createManual(businessId: string, input: CreateManualExpenseInput) {
    const identity = await supabase.auth.getUser();
    // Preserve the SDK failure, including AuthError identity/status. A missing
    // identity without an SDK error is also returned for service validation.
    if (identity.error !== null || identity.data.user === null) return identity;
    return supabase
      .from('expenses')
      .insert({
        ...manualFields(input),
        business_id: businessId,
        source_type: 'MANUAL',
        purchase_id: null,
        created_by: identity.data.user.id,
      })
      .select(columns)
      .single()
      .overrideTypes<ExpenseRow, { merge: false }>();
  },

  updateManual(businessId: string, expenseId: string, input: UpdateManualExpenseInput) {
    return supabase
      .from('expenses')
      .update(manualFields(input))
      .eq('business_id', businessId)
      .eq('id', expenseId)
      .eq('source_type', 'MANUAL')
      .is('purchase_id', null)
      .select(columns)
      .maybeSingle()
      .overrideTypes<ExpenseRow, { merge: false }>();
  },
};
