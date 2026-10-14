import type { ProductCategoryListParams } from '../types/productCategory.types';

export const productCategoriesKeys = {
  all: ['productCategories'] as const,
  byBusiness: (businessId: string | null) => [...productCategoriesKeys.all, businessId] as const,
  detail: (businessId: string | null, productCategoryId: string | null) =>
    [...productCategoriesKeys.byBusiness(businessId), 'detail', productCategoryId] as const,
  list: (businessId: string | null, params: Required<ProductCategoryListParams>) =>
    [
      ...productCategoriesKeys.byBusiness(businessId),
      'list',
      { page: params.page, pageSize: params.pageSize, status: params.status },
    ] as const,
};
