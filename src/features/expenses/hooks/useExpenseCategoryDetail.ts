import { skipToken, useQuery } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { expenseCategoriesKeys } from '../constants/expenseCategoriesKeys';
import type { ExpenseCategoryRow } from '../repositories/expenseCategoriesRepository';
import { expenseCategoriesService } from '../services/expenseCategoriesService';
import type { ExpenseCategoryError } from '../types/expenseCategory.types';
import type { UseExpenseCategoryDetailResult } from './expenseCategoryHook.types';
import { availableId, businessIdFrom } from './expenseCategoryHookUtils';

export type { UseExpenseCategoryDetailResult } from './expenseCategoryHook.types';

export function useExpenseCategoryDetail(
  expenseCategoryId: string | null,
): UseExpenseCategoryDetailResult {
  const businessId = businessIdFrom(useBusiness());
  const id = availableId(expenseCategoryId);
  const query = useQuery<ExpenseCategoryRow, ExpenseCategoryError>({
    queryKey: expenseCategoriesKeys.detail(businessId, id),
    queryFn:
      businessId === null || id === null
        ? skipToken
        : async () => {
            const result = await expenseCategoriesService.getById(businessId, id);
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
