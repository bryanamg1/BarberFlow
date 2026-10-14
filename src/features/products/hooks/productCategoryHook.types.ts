import type { ProductCategoryRow } from '../repositories/productCategoriesRepository';
import type { UpdateProductCategoryInput } from '../schemas/productCategory.schema';
import type { ProductCategoryListPage, ProductCategoryError } from '../types/productCategory.types';

export type UseProductCategoryDetailResult =
  | { status: 'idle'; data: null; error: null; isFetching: false }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: ProductCategoryRow; error: null; isFetching: boolean }
  | { status: 'error'; data: null; error: ProductCategoryError; isFetching: boolean };

export type UseProductCategoryListResult =
  | { status: 'idle'; data: null; error: null; isFetching: false }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: ProductCategoryListPage; error: null; isFetching: boolean }
  | { status: 'error'; data: null; error: ProductCategoryError; isFetching: boolean };

export type ProductCategoryMutationStatus = 'idle' | 'pending' | 'success' | 'error';

export type ProductCategoryMutationResult<TInput> = {
  mutateAsync: (input: TInput) => Promise<ProductCategoryRow>;
  reset: () => void;
} & (
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: ProductCategoryRow; error: null }
  | { status: 'error'; data: null; error: ProductCategoryError }
);

export type UpdateProductCategoryVariables = {
  productCategoryId: string;
  input: UpdateProductCategoryInput;
};
