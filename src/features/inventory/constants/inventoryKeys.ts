import type { StockMovementListParams } from '../types/inventory.types';

export const inventoryKeys = {
  all: ['inventory'] as const,
  byBusiness: (businessId: string | null) => ['inventory', businessId] as const,
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
