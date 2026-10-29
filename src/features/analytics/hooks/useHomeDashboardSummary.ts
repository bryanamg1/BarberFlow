import { skipToken, useQuery } from '@tanstack/react-query';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { analyticsKeys } from '../constants/analyticsKeys';
import { analyticsService } from '../services/analyticsService';
import type {
  AnalyticsError,
  AnalyticsRange,
  AnalyticsScope,
  FinanceDashboardSummary,
} from '../types/finance.types';
import type { HomeDashboardSummaryResult } from '../types/home.types';
import { financePeriodBounds } from '../utils/financePeriod';

const usable = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function useHomeClock(transitionKey: string) {
  const [clock, setClock] = useState<{ key: string; at: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      setClock({ key: transitionKey, at: Date.now() });
      // Refocus must capture a fresh day before enabling an old cached range.
      return () => setClock(null);
    }, [transitionKey]),
  );
  return clock;
}

export function useHomeDashboardSummary(): HomeDashboardSummaryResult {
  const auth = useAuth();
  const business = useBusiness();
  const focused = useIsFocused();
  const scope: AnalyticsScope | null =
    focused &&
    auth.status === 'authenticated' &&
    business.status === 'success' &&
    !business.isFetching &&
    business.data.role === 'OWNER' &&
    usable(auth.user.id) &&
    usable(business.data.business.id) &&
    usable(business.data.membershipId) &&
    usable(business.data.business.timezone)
      ? {
          userId: auth.user.id,
          businessId: business.data.business.id,
          membershipId: business.data.membershipId,
          timezone: business.data.business.timezone,
        }
      : null;
  const transitionKey = JSON.stringify(scope);
  const clock = useHomeClock(transitionKey);
  const clockReady = clock?.key === transitionKey;
  let range: AnalyticsRange | null = null;
  if (scope && clockReady && clock) {
    try {
      range = financePeriodBounds('TODAY', scope.timezone, clock.at);
    } catch {
      // Invalid timezone/context is unavailable, never an inferred device zone.
    }
  }
  const request = scope && range && clockReady ? { scope, range } : null;
  const query = useQuery<FinanceDashboardSummary, AnalyticsError>({
    queryKey: analyticsKeys.resource('summary', scope, range),
    enabled: request !== null,
    retry: false,
    queryFn: !request
      ? skipToken
      : async ({ signal }) => {
          const cancelled: AnalyticsError = {
            code: 'ACCESS_DENIED',
            message: 'La información financiera no está disponible.',
          };
          if (signal.aborted) throw cancelled;
          const result = await analyticsService.getDashboardSummary(
            request.scope.businessId,
            request.range,
            signal,
          );
          if (signal.aborted) throw cancelled;
          if (result.error) throw result.error;
          return result.data;
        },
  });
  // The exact scoped key isolates old results. TanStack owns shared-request
  // cancellation: one departing consumer must not abort another live observer.
  if (!scope) return { status: 'unavailable' };
  if (!clockReady) return { status: 'loading' };
  if (!range) return { status: 'unavailable' };
  if (query.isError)
    return { status: query.error.code === 'INVALID_DATA' ? 'unavailable' : 'error' };
  if (query.isFetching || !query.isSuccess) return { status: 'loading' };
  return { status: 'success', data: query.data };
}
