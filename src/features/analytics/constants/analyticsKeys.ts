import type { AnalyticsRange, AnalyticsResource, AnalyticsScope } from '../types/finance.types';

export const analyticsKeys = {
  byBusiness: (businessId: string | null) => ['analytics', businessId] as const,
  resource: (
    resource: AnalyticsResource,
    scope: AnalyticsScope | null,
    range: AnalyticsRange | null,
    limit?: number,
  ) =>
    [
      'analytics',
      scope?.businessId ?? null,
      resource,
      scope,
      range?.from ?? null,
      range?.to ?? null,
      limit ?? null,
    ] as const,
};
