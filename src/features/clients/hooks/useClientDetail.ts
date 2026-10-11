import { skipToken, useQuery } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { clientsKeys } from '../constants/clientsKeys';
import type { ClientRow } from '../repositories/clientsRepository';
import { clientsService } from '../services/clientsService';
import type { ClientServiceError } from '../types/client.types';
import type { UseClientDetailResult } from './clientHook.types';
import { availableId, businessIdFrom } from './clientHookUtils';

export type { UseClientDetailResult } from './clientHook.types';

export function useClientDetail(clientId: string | null): UseClientDetailResult {
  const businessId = businessIdFrom(useBusiness());
  const id = availableId(clientId);
  const query = useQuery<ClientRow, ClientServiceError>({
    queryKey: clientsKeys.detail(businessId, id),
    queryFn:
      businessId === null || id === null
        ? skipToken
        : async () => {
            const result = await clientsService.getById(businessId, id);
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
