import { useIsFocused } from 'expo-router';
import { useLayoutEffect, useMemo, useRef } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';

import type { ExpenseScope } from '../types/expenseHooks.types';

export const usableExpenseId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function useExpenseLifecycle(resource: string) {
  const auth = useAuth();
  const business = useBusiness();
  const focused = useIsFocused();
  const scope: ExpenseScope | null =
    focused &&
    auth.status === 'authenticated' &&
    business.status === 'success' &&
    business.data.role === 'OWNER' &&
    usableExpenseId(business.data.business.id) &&
    usableExpenseId(business.data.membershipId) &&
    usableExpenseId(auth.user.id)
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
