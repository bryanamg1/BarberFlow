import type { CheckoutScope } from '../store/checkoutDraftStore';

export const salesKeys = {
  byBusiness: (businessId: string | null) => ['sales', businessId] as const,
  detail: (scope: (CheckoutScope & { role?: 'OWNER' | 'BARBER' }) | null, saleId: string | null) =>
    ['sales', scope?.businessId ?? null, 'detail', scope, saleId] as const,
};
