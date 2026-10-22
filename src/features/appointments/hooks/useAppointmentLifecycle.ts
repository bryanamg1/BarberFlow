import { useIsFocused } from 'expo-router';
import { useLayoutEffect, useMemo, useRef } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';

import type { AppointmentScope } from '../types/appointmentHooks.types';

export const usableAppointmentId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function useAppointmentLifecycle(resource: string) {
  const auth = useAuth();
  const business = useBusiness();
  const focused = useIsFocused();
  const scope: AppointmentScope | null =
    focused &&
    auth.status === 'authenticated' &&
    business.status === 'success' &&
    ['OWNER', 'BARBER'].includes(business.data.role) &&
    usableAppointmentId(auth.user.id) &&
    usableAppointmentId(business.data.business.id) &&
    usableAppointmentId(business.data.membershipId)
      ? {
          businessId: business.data.business.id,
          userId: auth.user.id,
          membershipId: business.data.membershipId,
          role: business.data.role,
        }
      : null;
  const key = JSON.stringify({ scope, resource });
  const lifetime = useMemo(() => ({ epoch: Symbol(), key }), [key]);
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
