import { skipToken, useQuery } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { clientsKeys } from '../constants/clientsKeys';
import { clientsService } from '../services/clientsService';
import type { ClientListPage, ClientListParams, ClientServiceError } from '../types/client.types';
import { clientError } from '../utils/clientErrors';
import { normalizeClientListParams } from '../utils/clientListParams';
import type { UseClientsResult } from './clientHook.types';
import { businessIdFrom } from './clientHookUtils';

export type { UseClientsResult } from './clientHook.types';

export function useClients(params?: ClientListParams): UseClientsResult {
  const businessId = businessIdFrom(useBusiness());
  const normalized = normalizeClientListParams(params);
  const enabled = businessId !== null && normalized !== null;
  const query = useQuery<ClientListPage, ClientServiceError>({
    // Disabled invalid input must never enter the cache as an invalid page key.
    queryKey: clientsKeys.list(
      businessId,
      normalized ?? { page: 1, pageSize: 25, status: 'active' },
    ),
    queryFn:
      businessId === null || normalized === null
        ? skipToken
        : async () => {
            const result = await clientsService.list(businessId, normalized);
            if (result.error !== null) throw result.error;
            return result.data;
          },
    enabled,
    retry: false,
  });

  if (businessId === null) {
    return { status: 'idle', data: null, error: null, isFetching: false };
  }
  if (normalized === null) {
    return { status: 'error', data: null, error: clientError('UNKNOWN_ERROR'), isFetching: false };
  }
  if (query.isError) {
    return { status: 'error', data: null, error: query.error, isFetching: query.isFetching };
  }
  if (query.isSuccess) {
    return { status: 'success', data: query.data, error: null, isFetching: query.isFetching };
  }
  return { status: 'pending', data: null, error: null, isFetching: query.isFetching };
}
