import { skipToken, useQuery } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { servicesKeys } from '../constants/servicesKeys';
import { servicesService } from '../services/servicesService';
import type { ServiceListPage, ServiceListParams, ServiceError } from '../types/service.types';
import { normalizeServiceListParams } from '../utils/serviceListParams';
import type { UseServiceListResult } from './serviceHook.types';
import { businessIdFrom, serviceHookError } from './serviceHookUtils';

export type { UseServiceListResult } from './serviceHook.types';

export function useServiceList(params?: ServiceListParams): UseServiceListResult {
  const businessId = businessIdFrom(useBusiness());
  const normalized = normalizeServiceListParams(params);
  const query = useQuery<ServiceListPage, ServiceError>({
    queryKey: servicesKeys.list(
      businessId,
      normalized ?? { page: 1, pageSize: 25, status: 'active' },
    ),
    queryFn:
      businessId === null || normalized === null
        ? skipToken
        : async () => {
            const result = await servicesService.list(businessId, normalized);
            if (result.error !== null) throw result.error;
            return result.data;
          },
    enabled: businessId !== null && normalized !== null,
    retry: false,
  });

  if (businessId === null) {
    return { status: 'idle', data: null, error: null, isFetching: false };
  }
  if (normalized === null) {
    return {
      status: 'error',
      data: null,
      error: serviceHookError('UNKNOWN_ERROR'),
      isFetching: false,
    };
  }
  if (query.isError) {
    return { status: 'error', data: null, error: query.error, isFetching: query.isFetching };
  }
  if (query.isSuccess) {
    return { status: 'success', data: query.data, error: null, isFetching: query.isFetching };
  }
  return { status: 'pending', data: null, error: null, isFetching: query.isFetching };
}
