import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';

import type { CompletePurchaseInput } from '../schemas/purchase.schema';
import type { CompletePurchaseData } from '../types/completePurchase.types';
import type { VoidPurchaseData, VoidPurchaseInput } from '../types/voidPurchase.types';

import type {
  PurchaseHistoryRow,
  PurchaseDetailData,
  PurchaseListParams,
} from '../types/purchaseRead.types';

export const purchasesRepository = {
  listByBusiness(businessId: string, params: Required<PurchaseListParams>) {
    const offset = (params.page - 1) * params.pageSize;
    return supabase
      .from('purchases')
      .select('id, supplier, total, purchased_at, status')
      .eq('business_id', businessId)
      .order('purchased_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(offset, offset + params.pageSize)
      .overrideTypes<PurchaseHistoryRow[], { merge: false }>();
  },
  getById(
    businessId: string,
    purchaseId: string,
  ): PromiseLike<PostgrestSingleResponse<PurchaseDetailData>> {
    return supabase.rpc('get_purchase_detail', {
      p_business_id: businessId,
      p_purchase_id: purchaseId,
    });
  },
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
