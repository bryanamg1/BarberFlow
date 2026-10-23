import { skipToken, useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useLayoutEffect, useMemo, useRef } from 'react';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { salesKeys } from '../constants/salesKeys';
import { useCheckoutScope } from '../store/useCheckoutScope';
import { usableCheckoutId } from '../store/checkoutDraftStore';
import { salesService, saleReadError } from '../services/salesService';
import type { SaleDetail, SaleReadError } from '../types/saleDetail.types';

function useSaleLifecycle(saleId: string | null) {
  const identity = useCheckoutScope(),
    focused = useIsFocused(),
    business = useBusiness();
  // A role downgrade can keep the same membership ID but change row visibility.
  const scope =
    focused && identity && business.status === 'success'
      ? { ...identity, role: business.data.role }
      : null;
  const key = JSON.stringify([
    scope?.userId ?? null,
    scope?.businessId ?? null,
    scope?.membershipId ?? null,
    scope?.role ?? null,
    saleId,
  ]);
  const lifetime = useMemo(() => ({ key, epoch: Symbol() }), [key]);
  const live = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    live.current = lifetime.epoch;
    return () => {
      live.current = null;
    };
  }, [lifetime]);
  return { scope, isCurrent: () => scope !== null && live.current === lifetime.epoch };
}

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
  if (scope === null) return { status: 'idle' as const, data: null, error: null, refetch };
  if (!valid)
    return { status: 'error' as const, data: null, error: saleReadError('INVALID_INPUT'), refetch };
  if (query.isError) return { status: 'error' as const, data: null, error: query.error, refetch };
  if (query.data !== undefined)
    return { status: 'success' as const, data: query.data, error: null, refetch };
  return { status: 'pending' as const, data: null, error: null, refetch };
}
