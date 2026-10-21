import type { ProductCategoryListParams } from '../types/productCategory.types';
import type { ProductScope } from '../types/productHooks.types';

export const productCategoriesKeys = {
  all: ['productCategories'] as const,
  byBusiness: (businessId: string | null) => [...productCategoriesKeys.all, businessId] as const,
  batch: (scope: ProductScope | null, categoryIds: readonly string[]) =>
    [
      ...productCategoriesKeys.byBusiness(scope?.businessId ?? null),
      'batch',
      scope,
      [...new Set(categoryIds)].sort(),
    ] as const,
  detail: (businessId: string | null, productCategoryId: string | null) =>
    [...productCategoriesKeys.byBusiness(businessId), 'detail', productCategoryId] as const,
  list: (businessId: string | null, params: Required<ProductCategoryListParams>) =>
    [
      ...productCategoriesKeys.byBusiness(businessId),
      'list',
      { page: params.page, pageSize: params.pageSize, status: params.status },
    ] as const,
};
