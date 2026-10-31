import type { CheckoutScope } from '../store/checkoutDraftStore';
import type { SaleHistoryParams, SaleScope } from '../types/saleCorrection.types';

export const salesKeys = {
  byBusiness: (businessId: string | null) => ['sales', businessId] as const,
  detail: (scope: (CheckoutScope & { role?: 'OWNER' | 'BARBER' }) | null, saleId: string | null) =>
    ['sales', scope?.businessId ?? null, 'detail', scope, saleId] as const,
  history: (scope: SaleScope | null, params: SaleHistoryParams) =>
    ['sales', scope?.businessId ?? null, 'history', scope, params] as const,
  correction: (scope: SaleScope | null, saleId: string | null) =>
    ['sales', scope?.businessId ?? null, 'correction', scope, saleId] as const,
};
