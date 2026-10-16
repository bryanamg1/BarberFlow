import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';
import type { AdjustStockInput } from '../schemas/stockAdjustment.schema';

import type {
  InventoryPageParams,
  LowStockProductRow,
  ProductStockRow,
  StockMovementListParams,
  StockMovementRow,
} from '../types/inventory.types';

const movementColumns =
  'id, business_id, product_id, type, quantity_delta, unit_cost, reference_type, reference_id, notes, occurred_at, created_by, created_at';

export const inventoryRepository = {
  adjustStock(
    businessId: string,
    input: AdjustStockInput,
  ): PromiseLike<PostgrestSingleResponse<StockMovementRow>> {
    return supabase.rpc('adjust_stock', {
      p_business_id: businessId,
      p_operation_id: input.operationId,
      p_product_id: input.productId,
      p_quantity_delta: input.quantityDelta,
      p_reason: input.reason,
      p_notes: input.notes ?? null,
    });
  },
  // Read-only BF-221 producers compute balances under the caller's existing RLS.
  getProductStock(
    businessId: string,
    productIds: string[],
  ): PromiseLike<PostgrestSingleResponse<ProductStockRow[]>> {
    return supabase.rpc('get_product_stock', {
      p_business_id: businessId,
      p_product_ids: productIds,
    });
  },

  getLowStockProducts(
    businessId: string,
    params: InventoryPageParams,
  ): PromiseLike<PostgrestSingleResponse<LowStockProductRow[]>> {
    return supabase.rpc('get_low_stock_products', {
      p_business_id: businessId,
      p_page: params.page,
      p_page_size: params.pageSize,
    });
  },

  listStockMovements(businessId: string, productId: string, params: StockMovementListParams) {
    const from = (params.page - 1) * params.pageSize;
    let query = supabase
      .from('stock_movements')
      .select(movementColumns)
      .eq('business_id', businessId)
      .eq('product_id', productId);
    if (params.type !== undefined) query = query.eq('type', params.type);
    if (params.from !== undefined) query = query.gte('occurred_at', params.from);
    if (params.to !== undefined) query = query.lt('occurred_at', params.to);

    return query
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + params.pageSize)
      .overrideTypes<StockMovementRow[], { merge: false }>();
  },
};
