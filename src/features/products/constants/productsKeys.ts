import type { ProductListParams } from '../types/product.types';
import type { ProductScope } from '../types/productHooks.types';

export const productsKeys = {
  all: ['products'] as const,
  byBusiness: (businessId: string | null) => ['products', businessId] as const,
  list: (scope: ProductScope | null, params: ProductListParams) =>
    [
      'products',
      scope?.businessId ?? null,
      'list',
      scope,
      {
        page: params.page,
        pageSize: params.pageSize,
        status: params.status,
        categoryId: params.categoryId,
      },
    ] as const,
  detail: (scope: ProductScope | null, productId: string | null) =>
    ['products', scope?.businessId ?? null, 'detail', scope, productId] as const,
};
