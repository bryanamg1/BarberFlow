import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { expenseCategoriesKeys } from '../constants/expenseCategoriesKeys';
import type { ExpenseCategoryRow } from '../repositories/expenseCategoriesRepository';
import type { CreateExpenseCategoryInput } from '../schemas/expenseCategory.schema';
import { expenseCategoriesService } from '../services/expenseCategoriesService';
import type { ExpenseCategoryError } from '../types/expenseCategory.types';
import type { ExpenseCategoryMutationResult } from './expenseCategoryHook.types';
import { businessIdFrom, mutationResult, requireBusiness } from './expenseCategoryHookUtils';

export type {
  ExpenseCategoryMutationResult,
  ExpenseCategoryMutationStatus,
} from './expenseCategoryHook.types';

type CreateVariables = { businessId: string | null; input: CreateExpenseCategoryInput };

export function useCreateExpenseCategory(): ExpenseCategoryMutationResult<CreateExpenseCategoryInput> {
  const businessId = businessIdFrom(useBusiness());
  const queryClient = useQueryClient();
  const mutation = useMutation<ExpenseCategoryRow, ExpenseCategoryError, CreateVariables>({
    mutationFn: async ({ businessId: capturedBusinessId, input }) => {
      requireBusiness(capturedBusinessId);
      const result = await expenseCategoriesService.create(capturedBusinessId, input);
      if (result.error !== null) throw result.error;
      return result.data;
    },
    retry: false,
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({
        queryKey: expenseCategoriesKeys.byBusiness(variables.businessId),
      }),
  });

  return mutationResult(mutation, businessId, (input: CreateExpenseCategoryInput) =>
    mutation.mutateAsync({ businessId, input }),
  );
}
