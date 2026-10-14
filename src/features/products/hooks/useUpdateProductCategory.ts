import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { productCategoriesKeys } from '../constants/productCategoriesKeys';
import type { ProductCategoryRow } from '../repositories/productCategoriesRepository';
import { productCategoriesService } from '../services/productCategoriesService';
import type { ProductCategoryError } from '../types/productCategory.types';
import type {
  ProductCategoryMutationResult,
  UpdateProductCategoryVariables,
} from './productCategoryHook.types';
import {
  availableId,
  businessIdFrom,
  mutationResult,
  requireBusiness,
  productCategoryHookError,
} from './productCategoryHookUtils';

export type {
  ProductCategoryMutationResult,
  ProductCategoryMutationStatus,
  UpdateProductCategoryVariables,
} from './productCategoryHook.types';

type UpdateVariables = UpdateProductCategoryVariables & { businessId: string | null };

export function useUpdateProductCategory(): ProductCategoryMutationResult<UpdateProductCategoryVariables> {
  const businessId = businessIdFrom(useBusiness());
  const queryClient = useQueryClient();
  const mutation = useMutation<ProductCategoryRow, ProductCategoryError, UpdateVariables>({
    mutationFn: async ({ businessId: capturedBusinessId, productCategoryId, input }) => {
      requireBusiness(capturedBusinessId);
      if (availableId(productCategoryId) === null) {
        throw productCategoryHookError('PRODUCT_CATEGORY_NOT_FOUND');
      }
      const result = await productCategoriesService.update(
        capturedBusinessId,
        productCategoryId,
        input,
      );
      if (result.error !== null) throw result.error;
      return result.data;
    },
    retry: false,
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({
        queryKey: productCategoriesKeys.byBusiness(variables.businessId),
      }),
  });

  return mutationResult(
    mutation,
    businessId,
    ({ productCategoryId, input }: UpdateProductCategoryVariables) =>
      mutation.mutateAsync({ businessId, productCategoryId, input }),
  );
}
