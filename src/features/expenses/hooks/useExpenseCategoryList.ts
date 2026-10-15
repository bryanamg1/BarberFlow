import { skipToken, useQuery } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { expenseCategoriesKeys } from '../constants/expenseCategoriesKeys';
import { expenseCategoriesService } from '../services/expenseCategoriesService';
import type {
  ExpenseCategoryListPage,
  ExpenseCategoryListParams,
  ExpenseCategoryError,
} from '../types/expenseCategory.types';
import { normalizeExpenseCategoryListParams } from '../utils/expenseCategoryListParams';
import type { UseExpenseCategoryListResult } from './expenseCategoryHook.types';
import { businessIdFrom, expenseCategoryHookError } from './expenseCategoryHookUtils';

export type { UseExpenseCategoryListResult } from './expenseCategoryHook.types';

export function useExpenseCategoryList(
  params?: ExpenseCategoryListParams,
): UseExpenseCategoryListResult {
  const businessId = businessIdFrom(useBusiness());
  const normalized = normalizeExpenseCategoryListParams(params);
  const query = useQuery<ExpenseCategoryListPage, ExpenseCategoryError>({
    queryKey: expenseCategoriesKeys.list(
      businessId,
      normalized ?? { page: 1, pageSize: 25, status: 'active' },
    ),
    queryFn:
      businessId === null || normalized === null
        ? skipToken
        : async () => {
            const result = await expenseCategoriesService.listByBusiness(businessId, normalized);
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
      error: expenseCategoryHookError('UNKNOWN_ERROR'),
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
