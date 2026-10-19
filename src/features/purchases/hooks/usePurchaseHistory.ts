import { skipToken, useQuery } from '@tanstack/react-query';

import { purchasesKeys } from '../constants/purchasesKeys';
import { purchasesService } from '../services/purchasesService';
import { normalizePurchaseList, purchaseReadError } from '../services/purchaseRead';
import type {
  PurchaseListParams,
  PurchaseListData,
  PurchaseReadError,
} from '../types/purchaseRead.types';
import { usePurchaseScope } from './usePurchaseScope';

export function usePurchaseHistory(params?: PurchaseListParams) {
  const scope = usePurchaseScope();
  const normalized = normalizePurchaseList(params);
  const query = useQuery<PurchaseListData, PurchaseReadError>({
    queryKey: purchasesKeys.list(scope, normalized ?? { page: 1, pageSize: 25 }),
    queryFn:
      scope === null || normalized === null
        ? skipToken
        : async () => {
            const result = await purchasesService.listByBusiness(scope.businessId, normalized);
            if (result.error) throw result.error;
            return result.data;
          },
    retry: false,
  });
  if (scope === null)
    return {
      status: 'idle' as const,
      data: null,
      error: null,
      isFetching: false,
      refetch: query.refetch,
    };
  if (normalized === null)
    return {
      status: 'error' as const,
      data: null,
      error: purchaseReadError('INVALID_INPUT'),
      isFetching: false,
      refetch: query.refetch,
    };
  if (query.isError)
    return {
      status: 'error' as const,
      data: null,
      error: query.error,
      isFetching: query.isFetching,
      refetch: query.refetch,
    };
  if (query.data !== undefined)
    return {
      status: 'success' as const,
      data: query.data,
      error: null,
      isFetching: query.isFetching,
      refetch: query.refetch,
    };
  return {
    status: 'pending' as const,
    data: null,
    error: null,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
