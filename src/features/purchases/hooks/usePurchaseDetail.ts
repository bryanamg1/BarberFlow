import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';

import { purchasesKeys } from '../constants/purchasesKeys';
import { voidPurchaseIdSchema } from '../schemas/voidPurchase.schema';
import { purchasesService } from '../services/purchasesService';
import { purchaseReadError } from '../services/purchaseRead';
import type { PurchaseDetailData, PurchaseReadError } from '../types/purchaseRead.types';
import { usePurchaseScope } from './usePurchaseScope';

export function usePurchaseDetail(purchaseId: string | null) {
  const scope = usePurchaseScope();
  const client = useQueryClient();
  const valid = voidPurchaseIdSchema.safeParse(purchaseId).success;
  const query = useQuery<PurchaseDetailData, PurchaseReadError>({
    queryKey: purchasesKeys.detail(scope, purchaseId),
    queryFn:
      scope === null || !valid || purchaseId === null
        ? skipToken
        : async () => {
            const result = await purchasesService.getById(scope.businessId, purchaseId);
            if (result.error) throw result.error;
            const confirmed = client.getQueryData<PurchaseDetailData>(
              purchasesKeys.detail(scope, purchaseId),
            );
            return confirmed?.purchase.status === 'VOIDED' &&
              result.data.purchase.status !== 'VOIDED'
              ? confirmed
              : result.data;
          },
    retry: false,
    refetchOnMount: 'always',
  });
  if (scope === null)
    return {
      status: 'idle' as const,
      data: null,
      error: null,
      isFetching: false,
      refetch: query.refetch,
    };
  if (!valid)
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
      data: query.data ?? null,
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
