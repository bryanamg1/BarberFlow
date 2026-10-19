import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';

import type { CompletePurchaseInput } from '../schemas/purchase.schema';
import type { CompletePurchaseData } from '../types/completePurchase.types';
import type { VoidPurchaseData, VoidPurchaseInput } from '../types/voidPurchase.types';

export const purchasesRepository = {
  voidPurchase(
    businessId: string,
    input: VoidPurchaseInput,
  ): PromiseLike<PostgrestSingleResponse<VoidPurchaseData>> {
    return supabase.rpc('void_purchase', {
      p_business_id: businessId,
      p_operation_id: input.operationId,
      p_purchase_id: input.purchaseId,
      p_reason: input.reason,
    });
  },
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
