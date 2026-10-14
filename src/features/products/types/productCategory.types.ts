import type { ProductCategoryRow } from '../repositories/productCategoriesRepository';

export type ProductCategoryErrorCode =
  | 'PRODUCT_CATEGORY_NOT_FOUND'
  | 'PRODUCT_CATEGORY_ACCESS_DENIED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export type ProductCategoryError = { code: ProductCategoryErrorCode; message: string };

export type ProductCategoryResult =
  { data: ProductCategoryRow; error: null } | { data: null; error: ProductCategoryError };

export type ProductCategoryListParams = {
  page?: number;
  pageSize?: number;
  status?: 'active' | 'inactive' | 'all';
};

export type ProductCategoryListPage = {
  items: ProductCategoryRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};

export type ProductCategoryListResult =
  { data: ProductCategoryListPage; error: null } | { data: null; error: ProductCategoryError };
