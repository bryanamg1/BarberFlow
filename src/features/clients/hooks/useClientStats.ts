import { skipToken, useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';

import { clientsKeys } from '../constants/clientsKeys';
import { clientStatsService } from '../services/clientStatsService';
import type { ClientServiceError } from '../types/client.types';
import type { ClientStats, UseClientStatsResult } from '../types/clientStats.types';
import { availableId, businessIdFrom } from './clientHookUtils';

export type { UseClientStatsResult } from '../types/clientStats.types';

export function useClientStats(clientId: string | null): UseClientStatsResult {
  const auth = useAuth();
  const business = useBusiness();
  const businessId = businessIdFrom(business);
  const id = availableId(clientId);
  const userId = auth.status === 'authenticated' ? availableId(auth.user.id) : null;
  const role = business.status === 'success' ? business.data.role : null;
  const enabled = businessId !== null && id !== null && userId !== null && role !== null;
  const query = useQuery<ClientStats, ClientServiceError>({
    queryKey: clientsKeys.stats(businessId, id, userId, role),
    queryFn: !enabled
      ? skipToken
      : async () => {
          const result = await clientStatsService.getByClient(businessId, id);
          if (result.error !== null) throw result.error;
          return result.data;
        },
    enabled,
    retry: false,
  });

  if (!enabled) return { status: 'idle', data: null, error: null, isFetching: false };
  if (query.isError) {
    return { status: 'error', data: null, error: query.error, isFetching: query.isFetching };
  }
  if (query.isSuccess) {
    // Even a previously cached OWNER result must never surface financial data to BARBER.
    const data = role === 'BARBER' ? { ...query.data, totalSpent: null } : query.data;
    return { status: 'success', data, error: null, isFetching: query.isFetching };
  }
  return { status: 'pending', data: null, error: null, isFetching: query.isFetching };
}
