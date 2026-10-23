import { supabase } from '@/lib/supabase/client';

import type { SaleDetail } from '../types/saleDetail.types';

const columns =
  'id, business_id, client_id, appointment_id, operation_id, status, subtotal, discount, total, sold_at, created_by, created_at, updated_at';
const itemColumns =
  'id, sale_id, item_type, service_id, product_id, item_name_snapshot, unit_price_snapshot, quantity, line_total, unit_cost_snapshot, created_at';
const paymentColumns =
  'id, business_id, sale_id, payment_method, amount, notes, paid_at, created_by, created_at';

export const salesRepository = {
  getById(businessId: string, saleId: string) {
    return supabase
      .from('sales')
      .select(`${columns}, sale_items(${itemColumns}), payments(${paymentColumns})`)
      .eq('business_id', businessId)
      .eq('id', saleId)
      .maybeSingle()
      .overrideTypes<SaleDetail, { merge: false }>();
  },
};
