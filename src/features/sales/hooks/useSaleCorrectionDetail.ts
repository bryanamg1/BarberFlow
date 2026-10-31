import { skipToken, useQuery } from '@tanstack/react-query';
import { salesKeys } from '../constants/salesKeys';
import { salesService } from '../services/salesService';
import { saleCorrectionError, saleRestitution } from '../services/saleCorrection';
import type { SaleCorrectionData, SaleCorrectionError } from '../types/saleCorrection.types';
import type { SaleDetail } from '../types/saleDetail.types';
import { useSaleLifecycle } from './useSaleLifecycle';

export function useSaleCorrectionDetail(sale: SaleDetail | null) {
  const lifetime = useSaleLifecycle(sale?.id ?? null),
    { scope } = lifetime;
  const enabled = scope?.role === 'OWNER' && sale?.status === 'VOIDED';
  const query = useQuery<SaleCorrectionData, SaleCorrectionError>({
    queryKey: salesKeys.correction(scope, sale?.id ?? null),
    queryFn: !enabled
      ? skipToken
      : async ({ signal }) => {
          if (!lifetime.isCurrent() || signal.aborted) throw saleCorrectionError('ACCESS_DENIED');
          const result = await salesService.getCorrectionDetail(scope.businessId, sale.id);
          if (!lifetime.isCurrent() || signal.aborted) throw saleCorrectionError('ACCESS_DENIED');
          if (result.error) throw result.error;
          return result.data;
        },
    enabled,
    retry: false,
    refetchOnMount: 'always',
  });
  const refetch = async () => {
    if (enabled && lifetime.isCurrent()) await query.refetch();
  };
  if (!enabled) return { status: 'idle' as const, data: null, error: null, refetch };
  if (query.isError) return { status: 'error' as const, data: null, error: query.error, refetch };
  if (query.data) {
    if (!query.data.correction || saleRestitution(query.data, sale.sale_items) === null)
      return {
        status: 'error' as const,
        data: null,
        error: saleCorrectionError('INCOMPLETE_HISTORY'),
        refetch,
      };
    return { status: 'success' as const, data: query.data, error: null, refetch };
  }
  return { status: 'pending' as const, data: null, error: null, refetch };
}
