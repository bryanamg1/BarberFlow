import type {
  ProductError,
  ProductListPage,
  ProductListInput,
  ProductQueryResult,
} from '../types/productHooks.types';
import { skipToken, useQuery } from '@tanstack/react-query';

import { productsKeys } from '../constants/productsKeys';
import { productsService } from '../services/productsService';
import { normalizeProductListParams } from '../utils/productListParams';
import { productQueryState, readProduct } from './productQuery';
import { useProductLifecycle } from './useProductLifecycle';

export function useProductList(params?: ProductListInput): ProductQueryResult<ProductListPage> {
  const normalized = normalizeProductListParams(params);
  const lifetime = useProductLifecycle(JSON.stringify({ list: normalized }));
  const { scope } = lifetime;
  const query = useQuery<ProductListPage, ProductError>({
    queryKey: productsKeys.list(scope, normalized ?? { page: 1, pageSize: 25, status: 'active' }),
    queryFn:
      scope === null || normalized === null
        ? skipToken
        : () =>
            readProduct(
              () => productsService.listByBusiness(scope.businessId, normalized),
              lifetime.isCurrent,
            ),
    enabled: scope !== null && normalized !== null,
    retry: false,
  });
  const refetch = async () => {
    if (lifetime.isCurrent() && normalized !== null) await query.refetch();
  };
  return productQueryState(query, scope !== null, normalized !== null, refetch);
}
