import { skipToken, useQuery } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { servicesKeys } from '../constants/servicesKeys';
import type { ServiceRow } from '../repositories/servicesRepository';
import { servicesService } from '../services/servicesService';
import type { ServiceError } from '../types/service.types';
import type { UseServiceDetailResult } from './serviceHook.types';
import { availableId, businessIdFrom } from './serviceHookUtils';

export type { UseServiceDetailResult } from './serviceHook.types';

export function useServiceDetail(serviceId: string | null): UseServiceDetailResult {
  const businessId = businessIdFrom(useBusiness());
  const id = availableId(serviceId);
  const query = useQuery<ServiceRow, ServiceError>({
    queryKey: servicesKeys.detail(businessId, id),
    queryFn:
      businessId === null || id === null
        ? skipToken
        : async () => {
            const result = await servicesService.getById(businessId, id);
            if (result.error !== null) throw result.error;
            return result.data;
          },
    enabled: businessId !== null && id !== null,
    retry: false,
  });

  if (businessId === null || id === null) {
    return { status: 'idle', data: null, error: null, isFetching: false };
  }
  if (query.isError) {
    return { status: 'error', data: null, error: query.error, isFetching: query.isFetching };
  }
  if (query.isSuccess) {
    return { status: 'success', data: query.data, error: null, isFetching: query.isFetching };
  }
  return { status: 'pending', data: null, error: null, isFetching: query.isFetching };
}
