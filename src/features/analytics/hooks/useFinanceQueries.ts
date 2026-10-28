import { skipToken, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { analyticsKeys } from '../constants/analyticsKeys';
import { analyticsService } from '../services/analyticsService';
import type { FinanceTab } from '../components/FinanceTabs';
import type {
  AnalyticsError,
  AnalyticsResult,
  AnalyticsScope,
  FinanceKpiResult,
  FinanceRevenueResult,
  FinanceDashboardSummary,
  FinanceRevenuePoint,
  FinanceServiceRow,
  FinanceProductRow,
  FinanceExpenseSummary,
} from '../types/finance.types';
import { financePeriodBounds, type FinancePeriod } from '../utils/financePeriod';

const usable = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function state<T>(
  query: UseQueryResult<T, AnalyticsError>,
  enabled: boolean,
  waitingClock = false,
): { status: 'unavailable' | 'loading' | 'error' } | { status: 'success'; data: T } {
  if (waitingClock) return { status: 'loading' };
  if (!enabled) return { status: 'unavailable' };
  if (query.isError)
    return { status: query.error.code === 'INVALID_DATA' ? 'unavailable' : 'error' };
  if (query.isFetching || !query.isSuccess) return { status: 'loading' };
  return { status: 'success', data: query.data };
}

function useFinanceClock(transitionKey: string) {
  const [clock, setClock] = useState<{ key: string; at: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      setClock({ key: transitionKey, at: Date.now() });
    }, [transitionKey]),
  );
  return clock;
}

function useFinanceLifetime(lifetimeKey: string) {
  const client = useQueryClient();
  const lifetime = useMemo(() => ({ key: lifetimeKey, epoch: Symbol() }), [lifetimeKey]);
  const { epoch } = lifetime;
  const live = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    live.current = epoch;
    const captured = JSON.parse(lifetime.key) as {
      scope: AnalyticsScope | null;
      range: import('../types/finance.types').AnalyticsRange | null;
      tab: FinanceTab;
    };
    const resources =
      captured.tab === 'overview' ? (['summary', 'revenue'] as const) : ([captured.tab] as const);
    return () => {
      live.current = null;
      // Cancel only this captured active range, never invalidate/remove Finance cache.
      if (captured.scope && captured.range)
        for (const resource of resources)
          void client.cancelQueries({
            queryKey: analyticsKeys.resource(
              resource,
              captured.scope,
              captured.range,
              resource === 'services' || resource === 'products' ? 10 : undefined,
            ),
            exact: true,
          });
    };
  }, [client, epoch, lifetime]);
  return { epoch, live };
}

export function useFinanceQueries(tab: FinanceTab, period: FinancePeriod) {
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
  const transitionKey = JSON.stringify({ scope, tab, period });
  const clock = useFinanceClock(transitionKey);
  const clockReady = clock?.key === transitionKey;
  const timezone = scope?.timezone;
  let range: import('../types/finance.types').AnalyticsRange | null = null;
  if (timezone && clockReady && clock) {
    try {
      range = financePeriodBounds(period, timezone, clock.at);
    } catch {
      /* Invalid context remains unavailable. */
    }
  }
  const available = scope !== null && (!clockReady || range !== null);
  const active = scope !== null && range !== null && clockReady;
  const enabled = {
    summary: active && tab === 'overview',
    revenue: active && tab === 'overview',
    services: active && tab === 'services',
    products: active && tab === 'products',
    expenses: active && tab === 'expenses',
  };
  const keys = {
    summary: analyticsKeys.resource('summary', scope, range),
    revenue: analyticsKeys.resource('revenue', scope, range),
    services: analyticsKeys.resource('services', scope, range, 10),
    products: analyticsKeys.resource('products', scope, range, 10),
    expenses: analyticsKeys.resource('expenses', scope, range),
  };
  const lifetimeKey = JSON.stringify({ scope, range, tab, period });
  const { epoch, live } = useFinanceLifetime(lifetimeKey);
  const read = async <T>(signal: AbortSignal, operation: () => Promise<AnalyticsResult<T>>) => {
    const denied: AnalyticsError = {
      code: 'ACCESS_DENIED',
      message: 'La información financiera no está disponible.',
    };
    if (signal.aborted || live.current !== epoch) throw denied;
    const result = await operation();
    if (signal.aborted || live.current !== epoch) throw denied;
    if (result.error !== null) throw result.error;
    return result.data;
  };
  const summary = useQuery<FinanceDashboardSummary, AnalyticsError>({
    queryKey: keys.summary,
    enabled: enabled.summary,
    retry: false,
    queryFn: !enabled.summary
      ? skipToken
      : ({ signal }) =>
          read(signal, () =>
            analyticsService.getDashboardSummary(scope!.businessId, range!, signal),
          ),
  });
  const revenue = useQuery<FinanceRevenuePoint[], AnalyticsError>({
    queryKey: keys.revenue,
    enabled: enabled.revenue,
    retry: false,
    queryFn: !enabled.revenue
      ? skipToken
      : ({ signal }) =>
          read(signal, () => analyticsService.getRevenueByDay(scope!.businessId, range!, signal)),
  });
  const services = useQuery<FinanceServiceRow[], AnalyticsError>({
    queryKey: keys.services,
    enabled: enabled.services,
    retry: false,
    queryFn: !enabled.services
      ? skipToken
      : ({ signal }) =>
          read(signal, () =>
            analyticsService.getTopServices(scope!.businessId, range!, 10, signal),
          ),
  });
  const products = useQuery<FinanceProductRow[], AnalyticsError>({
    queryKey: keys.products,
    enabled: enabled.products,
    retry: false,
    queryFn: !enabled.products
      ? skipToken
      : ({ signal }) =>
          read(signal, () =>
            analyticsService.getTopProducts(scope!.businessId, range!, 10, signal),
          ),
  });
  const expenses = useQuery<FinanceExpenseSummary, AnalyticsError>({
    queryKey: keys.expenses,
    enabled: enabled.expenses,
    retry: false,
    queryFn: !enabled.expenses
      ? skipToken
      : ({ signal }) =>
          read(signal, () => analyticsService.getExpenseSummary(scope!.businessId, range!, signal)),
  });
  const waiting = scope !== null && !clockReady;
  const summaryState = state(summary, enabled.summary, waiting && tab === 'overview');
  const kpis: FinanceKpiResult =
    summaryState.status === 'success'
      ? scope
        ? { ...summaryState, scope: { ...scope, period } }
        : { status: 'unavailable' }
      : summaryState;
  const revenueState: FinanceRevenueResult = state(
    revenue,
    enabled.revenue,
    waiting && tab === 'overview',
  );
  return {
    available,
    kpis,
    revenue: revenueState,
    services: state(services, enabled.services, waiting && tab === 'services'),
    products: state(products, enabled.products, waiting && tab === 'products'),
    expenses: state(expenses, enabled.expenses, waiting && tab === 'expenses'),
    retrySummary: async () => {
      if (enabled.summary && live.current === epoch) await summary.refetch();
    },
  };
}
