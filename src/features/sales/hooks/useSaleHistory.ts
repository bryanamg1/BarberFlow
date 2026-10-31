import { skipToken, useQuery } from '@tanstack/react-query';
import { salesKeys } from '../constants/salesKeys';
import { normalizeSaleHistory, saleReadError, salesService } from '../services/salesService';
import type { SaleReadError } from '../types/saleDetail.types';
import type { SaleHistoryPage, SaleHistoryParams } from '../types/saleCorrection.types';
import { useSaleLifecycle } from './useSaleLifecycle';

export function useSaleHistory(params: SaleHistoryParams = {}) {
  const normalized = normalizeSaleHistory(params);
  const lifetime = useSaleLifecycle(JSON.stringify(['history', normalized]));
  const { scope } = lifetime;
  const query = useQuery<SaleHistoryPage, SaleReadError>({
    queryKey: salesKeys.history(scope, normalized ?? params),
    queryFn:
      !scope || !normalized
        ? skipToken
        : async ({ signal }) => {
            if (!lifetime.isCurrent() || signal.aborted) throw saleReadError('ACCESS_DENIED');
            const result = await salesService.listHistory({
              businessId: scope.businessId,
              ...normalized,
            });
            if (!lifetime.isCurrent() || signal.aborted) throw saleReadError('ACCESS_DENIED');
            if (result.error) throw result.error;
            return result.data;
          },
    retry: false,
    refetchOnMount: 'always',
  });
  const refetch = async () => {
    if (lifetime.isCurrent() && normalized) await query.refetch();
  };
  const shared = { refetch, isFetching: query.isFetching };
  if (!scope) return { ...shared, status: 'idle' as const, data: null, error: null };
  if (!normalized)
    return {
      ...shared,
      status: 'error' as const,
      data: null,
      error: saleReadError('INVALID_INPUT'),
    };
  if (query.isError) return { ...shared, status: 'error' as const, data: null, error: query.error };
  if (query.data) return { ...shared, status: 'success' as const, data: query.data, error: null };
  return { ...shared, status: 'pending' as const, data: null, error: null };
}
