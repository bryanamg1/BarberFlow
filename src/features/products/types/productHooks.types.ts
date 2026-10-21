import type { ProductListParams, ProductRow } from './product.types';

export type ProductErrorCode =
  | 'INVALID_INPUT'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_ACCESS_DENIED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';
export type ProductError = { code: ProductErrorCode; message: string };
export type ProductResult<T = ProductRow> =
  { data: T; error: null } | { data: null; error: ProductError };
export type ProductListInput = Partial<ProductListParams>;
export type ProductListPage = {
  items: ProductRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};
export type ProductScope = Readonly<{
  businessId: string;
  userId: string;
  membershipId: string;
}>;
export type ProductState<T> =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: null; error: ProductError };
export type ProductQueryResult<T> = ProductState<T> & {
  isFetching: boolean;
  refetch: () => Promise<void>;
};
export type ProductMutationResult<T> = ProductState<ProductRow> & {
  mutateAsync: (input: T) => Promise<ProductRow>;
  retry: () => Promise<ProductRow>;
  reset: () => void;
  refreshError: boolean;
  retryReads: () => Promise<void>;
};
