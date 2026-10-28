import type { FinancePeriod } from '../utils/financePeriod';

export type AnalyticsResource = 'summary' | 'revenue' | 'expenses' | 'services' | 'products';
export type AnalyticsRange = { from: string | null; to: string | null };
export type AnalyticsScope = {
  userId: string;
  businessId: string;
  membershipId: string;
  timezone: string;
};
export type AnalyticsError = {
  code: 'ACCESS_DENIED' | 'INVALID_INPUT' | 'INVALID_DATA' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
  message: string;
};
export type AnalyticsResult<T> = { data: T; error: null } | { data: null; error: AnalyticsError };
export type FinanceRevenueResult =
  | { status: 'loading' | 'error' | 'unavailable' }
  | { status: 'success'; data: readonly FinanceRevenuePoint[] };

// BF243 projection mapped losslessly by BF256 into contextual presentation data.
export type FinanceServiceRow = {
  service_id: string;
  name: string;
  quantity: string;
  net_revenue: string;
};

export type FinanceServicesResult =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unavailable' }
  | { status: 'success'; data: readonly FinanceServiceRow[] };

// BF244 and BF242 projections; BF256 owns transport and contextual status mapping.
export type FinanceProductRow = {
  product_id: string;
  name: string;
  quantity: string;
  net_revenue: string;
  cogs: string;
  gross_profit: string;
};

export type FinanceProductsResult =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unavailable' }
  | { status: 'success'; data: readonly FinanceProductRow[] };

export type FinanceExpenseSummary = {
  manual_total: string;
  purchase_total: string;
  total: string;
  by_category: readonly { category_id: string | null; amount: string }[];
};

export type FinanceExpensesResult =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unavailable' }
  | { status: 'success'; data: FinanceExpenseSummary };

// Exact BF241 daily projection; these decimal strings remain authoritative.
export type FinanceRevenuePoint = {
  date: string;
  service_revenue: string;
  product_revenue: string;
  total_revenue: string;
};

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
