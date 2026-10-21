import { skipToken, useQuery } from '@tanstack/react-query';

import { productCategoriesKeys } from '../constants/productCategoriesKeys';
import type { ProductCategoryRow } from '../repositories/productCategoriesRepository';
import { productCategoriesService } from '../services/productCategoriesService';
import type { ProductCategoryError } from '../types/productCategory.types';
import { usableProductId, useProductLifecycle } from './useProductLifecycle';

type BatchState =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: ProductCategoryRow[]; error: null }
  | { status: 'error'; data: null; error: ProductCategoryError };
export type ProductCategoryBatchResult = BatchState & {
  refetch: () => Promise<void>;
  isFetching: boolean;
};
const unavailable = (): ProductCategoryError => ({
  code: 'PRODUCT_CATEGORY_ACCESS_DENIED',
  message: 'No se pudo acceder a las categorías.',
});
const unknown = (): ProductCategoryError => ({
  code: 'UNKNOWN_ERROR',
  message: 'No se pudieron cargar las categorías.',
});

export function useProductCategoriesByIds(
  categoryIds: readonly string[],
): ProductCategoryBatchResult {
  const valid = Array.isArray(categoryIds) && categoryIds.every(usableProductId);
  const ids = valid ? [...new Set(categoryIds)].sort() : [];
  const lifetime = useProductLifecycle(JSON.stringify({ categories: ids }));
  const { scope } = lifetime;
  const active = scope !== null && valid && ids.length > 0;
  const query = useQuery<ProductCategoryRow[], ProductCategoryError>({
    queryKey: productCategoriesKeys.batch(scope, ids),
    enabled: active,
    retry: false,
    queryFn: !active
      ? skipToken
      : async () => {
          if (!lifetime.isCurrent()) throw unavailable();
          const result = await productCategoriesService
            .getByIds(scope.businessId, ids)
            .catch(() => {
              throw unknown();
            });
          if (!lifetime.isCurrent()) throw unavailable();
          if (result.error) throw result.error;
          return result.data;
        },
  });
  const actions = {
    isFetching: active && query.isFetching,
    refetch: async () => {
      if (active && lifetime.isCurrent()) await query.refetch();
    },
  };
  if (!scope) return { ...actions, status: 'idle', data: null, error: null };
  if (!valid) return { ...actions, status: 'error', data: null, error: unknown() };
  if (!ids.length) return { ...actions, status: 'success', data: [], error: null };
  if (query.isError) return { ...actions, status: 'error', data: null, error: query.error };
  if (query.isSuccess) return { ...actions, status: 'success', data: query.data, error: null };
  return { ...actions, status: 'pending', data: null, error: null };
}
