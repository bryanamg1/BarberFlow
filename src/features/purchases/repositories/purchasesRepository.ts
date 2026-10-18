import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';

import type { CompletePurchaseInput } from '../schemas/purchase.schema';
import type { CompletePurchaseData } from '../types/completePurchase.types';

export const purchasesRepository = {
  completePurchase(
    businessId: string,
    input: CompletePurchaseInput,
  ): PromiseLike<PostgrestSingleResponse<CompletePurchaseData>> {
    return supabase.rpc('complete_purchase', {
      p_business_id: businessId,
      p_operation_id: input.operationId,
      p_supplier: input.supplierName,
      p_expense_category_id: input.expenseCategoryId,
      p_payment_method: input.paymentMethod,
      p_purchased_at: input.purchasedAt,
      p_notes: input.notes ?? null,
      p_items: input.items.map(({ productId, quantity, unitCost }) => ({
        productId,
        quantity,
        unitCost,
      })),
    });
  },
};
