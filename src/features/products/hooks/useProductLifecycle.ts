import { useIsFocused } from 'expo-router';
import { useLayoutEffect, useMemo, useRef } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';

import type { ProductScope } from '../types/productHooks.types';

export const usableProductId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function useProductLifecycle(resource: string, writable = false) {
  const auth = useAuth();
  const business = useBusiness();
  const focused = useIsFocused();
  const scope: ProductScope | null =
    focused &&
    auth.status === 'authenticated' &&
    business.status === 'success' &&
    (!writable || business.data.role === 'OWNER') &&
    usableProductId(business.data.business.id) &&
    usableProductId(business.data.membershipId) &&
    usableProductId(auth.user.id)
      ? {
          businessId: business.data.business.id,
          userId: auth.user.id,
          membershipId: business.data.membershipId,
        }
      : null;
  const key = JSON.stringify({ scope, resource });
  const lifetime = useMemo(() => ({ key, epoch: Symbol() }), [key]);
  const live = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    live.current = lifetime.epoch;
    return () => {
      live.current = null;
    };
  }, [lifetime]);
  return {
    scope,
    epoch: lifetime.epoch,
    isCurrent: () => scope !== null && live.current === lifetime.epoch,
  };
}
