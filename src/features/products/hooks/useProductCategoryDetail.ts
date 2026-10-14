import { skipToken, useQuery } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { productCategoriesKeys } from '../constants/productCategoriesKeys';
import type { ProductCategoryRow } from '../repositories/productCategoriesRepository';
import { productCategoriesService } from '../services/productCategoriesService';
import type { ProductCategoryError } from '../types/productCategory.types';
import type { UseProductCategoryDetailResult } from './productCategoryHook.types';
import { availableId, businessIdFrom } from './productCategoryHookUtils';

export type { UseProductCategoryDetailResult } from './productCategoryHook.types';

export function useProductCategoryDetail(
  productCategoryId: string | null,
): UseProductCategoryDetailResult {
  const businessId = businessIdFrom(useBusiness());
  const id = availableId(productCategoryId);
  const query = useQuery<ProductCategoryRow, ProductCategoryError>({
    queryKey: productCategoriesKeys.detail(businessId, id),
    queryFn:
      businessId === null || id === null
        ? skipToken
        : async () => {
            const result = await productCategoriesService.getById(businessId, id);
            if (result.error !== null) throw result.error;
            return result.data;
          },
    enabled: businessId !== null && id !== null,
    retry: false,
  });

  if (businessId === null || id === null) {
    return { status: 'idle', data: null, error: null, isFetching: false };
  }
  if (query.isError) {
    return { status: 'error', data: null, error: query.error, isFetching: query.isFetching };
  }
  if (query.isSuccess) {
    return { status: 'success', data: query.data, error: null, isFetching: query.isFetching };
  }
  return { status: 'pending', data: null, error: null, isFetching: query.isFetching };
}
