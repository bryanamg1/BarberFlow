import { supabase } from '@/lib/supabase/client';

import type { SaleDetail } from '../types/saleDetail.types';
import type {
  SaleHistoryQuery,
  SaleHistoryPage,
  SaleCorrectionData,
  VoidSaleInput,
  VoidSaleData,
} from '../types/saleCorrection.types';
import type { SaleRow } from '../types/checkout.types';

const columns =
  'id, business_id, client_id, appointment_id, operation_id, status, subtotal, discount, total, sold_at, created_by, created_at, updated_at';
const itemColumns =
  'id, sale_id, item_type, service_id, product_id, item_name_snapshot, unit_price_snapshot, quantity, line_total, unit_cost_snapshot, created_at';
const paymentColumns =
  'id, business_id, sale_id, payment_method, amount, notes, paid_at, created_by, created_at';

export const salesRepository = {
  async listHistory({ businessId, page, pageSize, status }: SaleHistoryQuery) {
    let query = supabase.from('sales').select(columns).eq('business_id', businessId);
    if (status !== undefined) query = query.eq('status', status);
    const result = await query
      .order('sold_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
      .overrideTypes<SaleRow[], { merge: false }>();
    if (result.error) return { ...result, data: null };
    const data: SaleHistoryPage = {
      items: result.data.slice(0, pageSize),
      page,
      pageSize,
      hasNextPage: result.data.length > pageSize,
    };
    return { ...result, data };
  },
  getById(businessId: string, saleId: string) {
    return supabase
      .from('sales')
      .select(`${columns}, sale_items(${itemColumns}), payments(${paymentColumns})`)
      .eq('business_id', businessId)
      .eq('id', saleId)
      .maybeSingle()
      .overrideTypes<SaleDetail, { merge: false }>();
  },
  getCorrectionDetail(businessId: string, saleId: string) {
    return supabase
      .rpc('get_sale_correction_detail', { p_business_id: businessId, p_sale_id: saleId })
      .overrideTypes<SaleCorrectionData, { merge: false }>();
  },
  voidSale(businessId: string, input: VoidSaleInput) {
    return supabase
      .rpc('void_sale', {
        p_business_id: businessId,
        p_operation_id: input.operationId,
        p_sale_id: input.saleId,
        p_reason: input.reason,
      })
      .overrideTypes<VoidSaleData, { merge: false }>();
  },
};
