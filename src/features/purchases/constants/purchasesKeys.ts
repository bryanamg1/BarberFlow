import type { PurchaseScope, PurchaseListParams } from '../types/purchaseRead.types';

export const purchasesKeys = {
  all: ['purchases'] as const,
  byBusiness: (businessId: string | null) => ['purchases', businessId] as const,
  list: (scope: PurchaseScope | null, params: Required<PurchaseListParams>) =>
    ['purchases', scope?.businessId ?? null, 'list', scope, params] as const,
  detail: (scope: PurchaseScope | null, purchaseId: string | null) =>
    ['purchases', scope?.businessId ?? null, 'detail', scope, purchaseId] as const,
};
