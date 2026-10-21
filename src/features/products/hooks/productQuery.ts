import type { ProductError, ProductResult, ProductQueryResult } from '../types/productHooks.types';
import type { UseQueryResult } from '@tanstack/react-query';

import { productError } from '../utils/productErrors';

export async function readProduct<T>(
  operation: () => Promise<ProductResult<T>>,
  current: () => boolean,
): Promise<T> {
  if (!current()) throw productError('PRODUCT_ACCESS_DENIED');
  let result: ProductResult<T>;
  try {
    result = await operation();
  } catch {
    throw productError('UNKNOWN_ERROR');
  }
  if (!current()) throw productError('PRODUCT_ACCESS_DENIED');
  if (result.error !== null) throw result.error;
  return result.data;
}

export function productQueryState<T>(
  query: UseQueryResult<T, ProductError>,
  active: boolean,
  valid: boolean,
  refetch: () => Promise<void>,
): ProductQueryResult<T> {
  const actions = { refetch, isFetching: active && valid && query.isFetching };
  if (!active) return { ...actions, status: 'idle', data: null, error: null };
  if (!valid)
    return { ...actions, status: 'error', data: null, error: productError('INVALID_INPUT') };
  if (query.isError) return { ...actions, status: 'error', data: null, error: query.error };
  if (query.isSuccess) return { ...actions, status: 'success', data: query.data, error: null };
  return { ...actions, status: 'pending', data: null, error: null };
}
