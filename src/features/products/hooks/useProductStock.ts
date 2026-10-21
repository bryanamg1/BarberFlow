import { skipToken, useQuery } from '@tanstack/react-query';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { inventoryService } from '@/features/inventory/services/inventoryService';
import type { ProductStockRow } from '@/features/inventory/types/inventory.types';
import type { ProductError } from '../types/productHooks.types';
import type { ProductStockResult } from '../types/productStock.types';
import { productError } from '../utils/productErrors';
import { productStockError } from '../utils/productStock';
import { usableProductId, useProductLifecycle } from './useProductLifecycle';

export function useProductStock(productIds: readonly string[]): ProductStockResult {
  const valid = Array.isArray(productIds) && productIds.every(usableProductId);
  const ids = valid ? [...new Set(productIds)].sort() : [];
  const lifetime = useProductLifecycle(JSON.stringify({ stock: ids }));
  const { scope } = lifetime;
  const enabled = scope !== null && valid && ids.length > 0;
  const query = useQuery<ProductStockRow[], ProductError>({
    queryKey: inventoryKeys.productStockBatch(scope, ids),
    enabled,
    retry: false,
    queryFn: !enabled
      ? skipToken
      : async () => {
          if (!lifetime.isCurrent()) throw productError('PRODUCT_ACCESS_DENIED');
          const result = await inventoryService.getProductStock(scope.businessId, ids).catch(() => {
            throw productError('UNKNOWN_ERROR');
          });
          if (!lifetime.isCurrent()) throw productError('PRODUCT_ACCESS_DENIED');
          if (result.error) throw productStockError(result.error);
          return result.data;
        },
  });
  const controls = {
    isFetching: enabled && query.isFetching,
    refetch: async () => {
      if (enabled && lifetime.isCurrent()) await query.refetch();
    },
  };
  if (!scope) return { ...controls, status: 'idle', data: null, error: null };
  if (!valid)
    return { ...controls, status: 'error', data: null, error: productError('INVALID_INPUT') };
  if (!ids.length) return { ...controls, status: 'success', data: [], error: null };
  if (query.isError) return { ...controls, status: 'error', data: null, error: query.error };
  if (query.isSuccess) return { ...controls, status: 'success', data: query.data, error: null };
  return { ...controls, status: 'pending', data: null, error: null };
}
