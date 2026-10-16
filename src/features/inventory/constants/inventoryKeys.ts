import type { StockMovementListParams } from '../types/inventory.types';

export const inventoryKeys = {
  all: ['inventory'] as const,
  byBusiness: (businessId: string | null) => ['inventory', businessId] as const,
  lowStockAlerts: (
    scope: { businessId: string; membershipId: string; userId: string } | null,
    page: number,
    pageSize: number,
  ) => ['inventory', scope?.businessId ?? null, 'low-stock', scope, { page, pageSize }] as const,
  productStock: (businessId: string, productId: string) =>
    ['inventory', businessId, 'stock', productId] as const,
  stockMovements: (
    businessId: string | null,
    productId: string | null,
    params: StockMovementListParams,
  ) =>
    [
      ...inventoryKeys.byBusiness(businessId),
      'movements',
      productId,
      {
        page: params.page,
        pageSize: params.pageSize,
        type: params.type,
        from: params.from,
        to: params.to,
      },
    ] as const,
};
