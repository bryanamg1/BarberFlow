import { useIsFocused } from 'expo-router';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { useCheckoutScope } from '../store/useCheckoutScope';

export function useSaleLifecycle(resource: string | null) {
  const identity = useCheckoutScope(),
    focused = useIsFocused(),
    business = useBusiness();
  const scope =
    focused &&
    identity &&
    business.status === 'success' &&
    ['OWNER', 'BARBER'].includes(business.data.role)
      ? { ...identity, role: business.data.role }
      : null;
  const key = JSON.stringify([scope, resource]);
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
