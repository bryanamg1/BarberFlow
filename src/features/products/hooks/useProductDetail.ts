import type { ProductError, ProductQueryResult } from '../types/productHooks.types';
import { skipToken, useQuery } from '@tanstack/react-query';

import { productsKeys } from '../constants/productsKeys';
import { productsService } from '../services/productsService';
import type { ProductRow } from '../types/product.types';
import { productQueryState, readProduct } from './productQuery';
import { usableProductId, useProductLifecycle } from './useProductLifecycle';

export function useProductDetail(productId: string | null): ProductQueryResult<ProductRow> {
  const lifetime = useProductLifecycle(JSON.stringify({ detail: productId }));
  const { scope } = lifetime;
  const valid = usableProductId(productId);
  const query = useQuery<ProductRow, ProductError>({
    queryKey: productsKeys.detail(scope, productId),
    queryFn:
      scope === null || !valid
        ? skipToken
        : () =>
            readProduct(
              () => productsService.getById(scope.businessId, productId),
              lifetime.isCurrent,
            ),
    enabled: scope !== null && valid,
    retry: false,
  });
  const refetch = async () => {
    if (lifetime.isCurrent() && valid) await query.refetch();
  };
  return productQueryState(query, scope !== null, valid, refetch);
}
