import type { FinancePeriod } from '../utils/financePeriod';

// Exact BF240 projection. Adapters/query orchestration remain owned by BF256.
export type FinanceDashboardSummary = {
  total_revenue: string;
  service_revenue: string;
  product_revenue: string;
  expenses: string;
  merchandise_purchases: string;
  profit: string;
  appointments: string;
  active_clients: string;
  average_ticket: string | null;
  products_sold: string;
  cancellations: string;
  no_shows: string;
};

export type FinanceKpiResult =
  | { status: 'loading' | 'error' | 'unavailable' }
  | {
      status: 'success';
      data: FinanceDashboardSummary;
      scope: {
        userId: string;
        businessId: string;
        membershipId: string;
        timezone: string;
        period: FinancePeriod;
      };
    };
