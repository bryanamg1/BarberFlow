import type { FinanceDashboardSummary } from '@/features/analytics/types/finance.types';

export const financeSummary = (): FinanceDashboardSummary => ({
  total_revenue: '100.00',
  service_revenue: '40.00',
  product_revenue: '60.00',
  expenses: '10.00',
  merchandise_purchases: '20.00',
  profit: '-0.50',
  appointments: '2',
  active_clients: '3',
  average_ticket: null,
  products_sold: '4',
  cancellations: '0',
  no_shows: '0',
});
export const financeRevenue = () => [
  {
    date: '2026-10-28',
    service_revenue: '40.00',
    product_revenue: '60.00',
    total_revenue: '100.00',
  },
];
export const financeServices = () => [
  { service_id: 's', name: 'Corte histórico', quantity: '2', net_revenue: '40.00' },
];
export const financeProducts = () => [
  {
    product_id: 'p',
    name: 'Cera histórica',
    quantity: '1',
    net_revenue: '60.00',
    cogs: '60.50',
    gross_profit: '-0.50',
  },
];
export const financeExpenses = () => ({
  manual_total: '10.00',
  purchase_total: '20.00',
  total: '30.00',
  by_category: [],
});
