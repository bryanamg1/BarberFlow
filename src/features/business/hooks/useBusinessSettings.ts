import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/context/AuthContext';

import { businessKeys } from '../constants/businessKeys';
import { useBusiness } from '../context/BusinessContext';
import {
  businessSettingsService,
  settingsError,
  type SettingsError,
  type SettingsResult,
} from '../services/businessSettingsService';
import type {
  UpdateBusinessProfileInput,
  UpdateBusinessPreferencesInput,
} from '../schemas/businessSettings.schema';

export function useSettingsScope() {
  const context = useBusiness();
  const auth = useAuth();
  return context.status === 'success' &&
    context.data.role === 'OWNER' &&
    auth.status === 'authenticated'
    ? {
        businessId: context.data.business.id,
        membershipId: context.data.membershipId,
        userId: auth.user.id,
      }
    : null;
}
export const businessSettingsKey = (scope: ReturnType<typeof useSettingsScope>) =>
  ['business', 'settings', scope] as const;
export function useBusinessSettings() {
  const scope = useSettingsScope();
  return useQuery({
    queryKey: businessSettingsKey(scope),
    enabled: scope !== null,
    retry: false,
    queryFn:
      scope === null
        ? skipToken
        : async () => {
            const result = await businessSettingsService.get(scope.businessId);
            if (result.error) throw result.error;
            return result.data;
          },
  });
}
function useSettingsWrite<TInput, TData>(
  operation: (businessId: string, input: TInput) => Promise<SettingsResult<TData>>,
  refreshCurrent: boolean,
) {
  const scope = useSettingsScope();
  const client = useQueryClient();
  const mutation = useMutation<
    TData,
    SettingsError,
    { scope: NonNullable<typeof scope>; input: TInput }
  >({
    retry: false,
    mutationFn: async ({ scope, input }) => {
      const result = await operation(scope.businessId, input);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: businessSettingsKey(variables.scope), exact: true }),
        ...(refreshCurrent
          ? [
              client.invalidateQueries({
                queryKey: businessKeys.current(variables.scope.userId),
                exact: true,
              }),
            ]
          : []),
      ]);
    },
  });
  const current = JSON.stringify(mutation.variables?.scope) === JSON.stringify(scope);
  return {
    isPending: current && mutation.isPending,
    error: current && mutation.isError ? mutation.error : null,
    reset: mutation.reset,
    async mutateAsync(input: TInput) {
      if (!scope) throw settingsError('BUSINESS_ACCESS_DENIED');
      return mutation.mutateAsync({ scope, input });
    },
  };
}
export const useUpdateBusinessProfile = () =>
  useSettingsWrite<
    UpdateBusinessProfileInput,
    NonNullable<Awaited<ReturnType<typeof businessSettingsService.updateProfile>>['data']>
  >(businessSettingsService.updateProfile, true);
export const useUpdateBusinessPreferences = () =>
  useSettingsWrite<
    UpdateBusinessPreferencesInput,
    NonNullable<Awaited<ReturnType<typeof businessSettingsService.updatePreferences>>['data']>
  >(businessSettingsService.updatePreferences, false);
