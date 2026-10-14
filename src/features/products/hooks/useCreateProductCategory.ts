import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { productCategoriesKeys } from '../constants/productCategoriesKeys';
import type { ProductCategoryRow } from '../repositories/productCategoriesRepository';
import type { CreateProductCategoryInput } from '../schemas/productCategory.schema';
import { productCategoriesService } from '../services/productCategoriesService';
import type { ProductCategoryError } from '../types/productCategory.types';
import type { ProductCategoryMutationResult } from './productCategoryHook.types';
import { businessIdFrom, mutationResult, requireBusiness } from './productCategoryHookUtils';

export type {
  ProductCategoryMutationResult,
  ProductCategoryMutationStatus,
} from './productCategoryHook.types';

type CreateVariables = { businessId: string | null; input: CreateProductCategoryInput };

export function useCreateProductCategory(): ProductCategoryMutationResult<CreateProductCategoryInput> {
  const businessId = businessIdFrom(useBusiness());
  const queryClient = useQueryClient();
  const mutation = useMutation<ProductCategoryRow, ProductCategoryError, CreateVariables>({
    mutationFn: async ({ businessId: capturedBusinessId, input }) => {
      requireBusiness(capturedBusinessId);
      const result = await productCategoriesService.create(capturedBusinessId, input);
      if (result.error !== null) throw result.error;
      return result.data;
    },
    retry: false,
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({
        queryKey: productCategoriesKeys.byBusiness(variables.businessId),
      }),
  });

  return mutationResult(mutation, businessId, (input: CreateProductCategoryInput) =>
    mutation.mutateAsync({ businessId, input }),
  );
}
