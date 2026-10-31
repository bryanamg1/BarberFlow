import { skipToken, useQuery } from '@tanstack/react-query';

import { salesKeys } from '../constants/salesKeys';
import { usableCheckoutId } from '../store/checkoutDraftStore';
import { salesService, saleReadError } from '../services/salesService';
import type { SaleDetail, SaleReadError } from '../types/saleDetail.types';
import { useSaleLifecycle } from './useSaleLifecycle';

export function useSaleDetail(saleId: string | null) {
  const lifetime = useSaleLifecycle(saleId);
  const { scope } = lifetime;
  const valid = usableCheckoutId(saleId);
  const query = useQuery<SaleDetail, SaleReadError>({
    queryKey: salesKeys.detail(scope, saleId),
    queryFn:
      scope === null || !valid
        ? skipToken
        : async ({ signal }) => {
            if (!lifetime.isCurrent() || signal.aborted) throw saleReadError('ACCESS_DENIED');
            const result = await salesService.getById(scope.businessId, saleId);
            if (!lifetime.isCurrent() || signal.aborted) throw saleReadError('ACCESS_DENIED');
            if (result.error) throw result.error;
            return result.data;
          },
    enabled: scope !== null && valid,
    retry: false,
    refetchOnMount: 'always',
  });
  const refetch = async () => {
    if (lifetime.isCurrent() && valid) await query.refetch();
  };
  const isFetching = query.isFetching;
  if (scope === null)
    return { status: 'idle' as const, data: null, error: null, refetch, isFetching: false };
  if (!valid)
    return {
      status: 'error' as const,
      data: null,
      error: saleReadError('INVALID_INPUT'),
      refetch,
      isFetching,
    };
  if (query.isError)
    return { status: 'error' as const, data: null, error: query.error, refetch, isFetching };
  if (query.data !== undefined)
    return { status: 'success' as const, data: query.data, error: null, refetch, isFetching };
  return { status: 'pending' as const, data: null, error: null, refetch, isFetching };
}
