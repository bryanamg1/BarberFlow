import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { expenseCategoriesKeys } from '../constants/expenseCategoriesKeys';
import type { ExpenseCategoryRow } from '../repositories/expenseCategoriesRepository';
import { expenseCategoriesService } from '../services/expenseCategoriesService';
import type { ExpenseCategoryError } from '../types/expenseCategory.types';
import type {
  ExpenseCategoryMutationResult,
  UpdateExpenseCategoryVariables,
} from './expenseCategoryHook.types';
import {
  availableId,
  businessIdFrom,
  mutationResult,
  requireBusiness,
  expenseCategoryHookError,
} from './expenseCategoryHookUtils';

export type {
  ExpenseCategoryMutationResult,
  ExpenseCategoryMutationStatus,
  UpdateExpenseCategoryVariables,
} from './expenseCategoryHook.types';

type UpdateVariables = UpdateExpenseCategoryVariables & { businessId: string | null };

export function useUpdateExpenseCategory(): ExpenseCategoryMutationResult<UpdateExpenseCategoryVariables> {
  const businessId = businessIdFrom(useBusiness());
  const queryClient = useQueryClient();
  const mutation = useMutation<ExpenseCategoryRow, ExpenseCategoryError, UpdateVariables>({
    mutationFn: async ({ businessId: capturedBusinessId, expenseCategoryId, input }) => {
      requireBusiness(capturedBusinessId);
      if (availableId(expenseCategoryId) === null) {
        throw expenseCategoryHookError('EXPENSE_CATEGORY_NOT_FOUND');
      }
      const result = await expenseCategoriesService.update(
        capturedBusinessId,
        expenseCategoryId,
        input,
      );
      if (result.error !== null) throw result.error;
      return result.data;
    },
    retry: false,
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({
        queryKey: expenseCategoriesKeys.byBusiness(variables.businessId),
      }),
  });

  return mutationResult(
    mutation,
    businessId,
    ({ expenseCategoryId, input }: UpdateExpenseCategoryVariables) =>
      mutation.mutateAsync({ businessId, expenseCategoryId, input }),
  );
}
