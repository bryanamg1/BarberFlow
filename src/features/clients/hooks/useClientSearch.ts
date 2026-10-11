import { skipToken, useQuery } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { clientsKeys } from '../constants/clientsKeys';
import { clientsService } from '../services/clientsService';
import type { ClientListPage, ClientSearchParams, ClientServiceError } from '../types/client.types';
import { clientError } from '../utils/clientErrors';
import { normalizeClientSearchParams } from '../utils/clientSearchParams';
import type { UseClientsResult } from './clientHook.types';
import { businessIdFrom } from './clientHookUtils';

export type UseClientSearchResult = UseClientsResult;

export function useClientSearch(params: ClientSearchParams): UseClientSearchResult {
  const businessId = businessIdFrom(useBusiness());
  const normalized = normalizeClientSearchParams(params);
  const enabled = businessId !== null && normalized !== null && normalized.term.length >= 2;
  const query = useQuery<ClientListPage, ClientServiceError>({
    queryKey: clientsKeys.search(
      businessId,
      normalized ?? { term: '', page: 1, pageSize: 25, status: 'active' },
    ),
    queryFn:
      businessId === null || normalized === null || normalized.term.length < 2
        ? skipToken
        : async () => {
            const result = await clientsService.search(businessId, normalized);
            if (result.error !== null) throw result.error;
            return result.data;
          },
    enabled,
    retry: false,
  });

  if (businessId === null || (typeof params.term === 'string' && params.term.trim().length < 2)) {
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
