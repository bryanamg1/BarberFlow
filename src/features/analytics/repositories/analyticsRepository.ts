import { supabase } from '@/lib/supabase/client';
import type { AnalyticsRange } from '../types/finance.types';

const args = (businessId: string, range: AnalyticsRange) => ({
  p_business_id: businessId,
  p_from: range.from,
  p_to: range.to,
});

export const analyticsRepository = {
  getDashboardSummary(businessId: string, range: AnalyticsRange, signal?: AbortSignal) {
    const query = supabase.rpc('get_dashboard_summary', args(businessId, range));
    return signal ? query.abortSignal(signal) : query;
  },
  getRevenueByDay(businessId: string, range: AnalyticsRange, signal?: AbortSignal) {
    const query = supabase.rpc('get_revenue_by_day', args(businessId, range));
    return signal ? query.abortSignal(signal) : query;
  },
  getExpenseSummary(businessId: string, range: AnalyticsRange, signal?: AbortSignal) {
    const query = supabase.rpc('get_expense_summary', args(businessId, range));
    return signal ? query.abortSignal(signal) : query;
  },
  getTopServices(businessId: string, range: AnalyticsRange, limit = 10, signal?: AbortSignal) {
    // Transport cast only: preserve SQL bigint exactly before JSON reaches JavaScript.
    const query = supabase
      .rpc('get_top_services', { ...args(businessId, range), p_limit: limit })
      .select('service_id,name,quantity::text,net_revenue');
    return signal ? query.abortSignal(signal) : query;
  },
  getTopProducts(businessId: string, range: AnalyticsRange, limit = 10, signal?: AbortSignal) {
    const query = supabase
      .rpc('get_top_products', { ...args(businessId, range), p_limit: limit })
      .select('product_id,name,quantity::text,net_revenue,cogs,gross_profit');
    return signal ? query.abortSignal(signal) : query;
  },
};
