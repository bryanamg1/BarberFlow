import { skipToken, useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/context/AuthContext';

import { businessKeys } from '../constants/businessKeys';
import { currentBusinessService } from '../services/currentBusinessService';
import type { CurrentBusiness, CurrentBusinessServiceError } from '../types/business.types';

export type UseCurrentBusinessResult =
  | { status: 'idle'; data: null; error: null; isFetching: false }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: CurrentBusiness; error: null; isFetching: boolean }
  | {
      status: 'error';
      data: null;
      error: CurrentBusinessServiceError;
      isFetching: boolean;
    };

export function useCurrentBusiness(): UseCurrentBusinessResult {
  const auth = useAuth();
  const userId =
    auth.status === 'authenticated' &&
    typeof auth.user.id === 'string' &&
    auth.user.id.trim().length > 0
      ? auth.user.id
      : null;

  const query = useQuery<CurrentBusiness, CurrentBusinessServiceError>({
    queryKey: businessKeys.current(userId),
    queryFn:
      userId === null
        ? skipToken
        : async () => {
            const result = await currentBusinessService.getCurrentBusiness(userId);
            if (result.error !== null) throw result.error;
            return result.data;
          },
    enabled: userId !== null,
    retry: false,
  });

  // Disabled queries can retain pending status or cached data internally.
  if (userId === null) {
    return { status: 'idle', data: null, error: null, isFetching: false };
  }
  // A failed refresh must not expose an earlier business as still operational.
  if (query.isError) {
    return { status: 'error', data: null, error: query.error, isFetching: query.isFetching };
  }
  if (query.isSuccess) {
    return { status: 'success', data: query.data, error: null, isFetching: query.isFetching };
  }
  return { status: 'pending', data: null, error: null, isFetching: query.isFetching };
}
