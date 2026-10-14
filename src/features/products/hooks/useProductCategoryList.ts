import { skipToken, useQuery } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { productCategoriesKeys } from '../constants/productCategoriesKeys';
import { productCategoriesService } from '../services/productCategoriesService';
import type {
  ProductCategoryListPage,
  ProductCategoryListParams,
  ProductCategoryError,
} from '../types/productCategory.types';
import { normalizeProductCategoryListParams } from '../utils/productCategoryListParams';
import type { UseProductCategoryListResult } from './productCategoryHook.types';
import { businessIdFrom, productCategoryHookError } from './productCategoryHookUtils';

export type { UseProductCategoryListResult } from './productCategoryHook.types';

export function useProductCategoryList(
  params?: ProductCategoryListParams,
): UseProductCategoryListResult {
  const businessId = businessIdFrom(useBusiness());
  const normalized = normalizeProductCategoryListParams(params);
  const query = useQuery<ProductCategoryListPage, ProductCategoryError>({
    queryKey: productCategoriesKeys.list(
      businessId,
      normalized ?? { page: 1, pageSize: 25, status: 'active' },
    ),
    queryFn:
      businessId === null || normalized === null
        ? skipToken
        : async () => {
            const result = await productCategoriesService.listByBusiness(businessId, normalized);
            if (result.error !== null) throw result.error;
            return result.data;
          },
    enabled: businessId !== null && normalized !== null,
    retry: false,
  });

  if (businessId === null) {
    return { status: 'idle', data: null, error: null, isFetching: false };
  }
  if (normalized === null) {
    return {
      status: 'error',
      data: null,
      error: productCategoryHookError('UNKNOWN_ERROR'),
      isFetching: false,
    };
  }
  if (query.isError) {
    return { status: 'error', data: null, error: query.error, isFetching: query.isFetching };
  }
  if (query.isSuccess) {
    return { status: 'success', data: query.data, error: null, isFetching: query.isFetching };
  }
  return { status: 'pending', data: null, error: null, isFetching: query.isFetching };
}
