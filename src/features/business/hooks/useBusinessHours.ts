import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { businessHoursService } from '../services/businessHoursService';
import { settingsError, type SettingsError } from '../services/businessSettingsService';
import type { BusinessHour } from '../repositories/businessHoursRepository';
import type { BusinessHoursInput } from '../schemas/businessHours.schema';
import { useSettingsScope } from './useBusinessSettings';

export const businessHoursKey = (scope: ReturnType<typeof useSettingsScope>) =>
  ['business', 'hours', scope] as const;
export function useBusinessHours() {
  const scope = useSettingsScope();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: businessHoursKey(scope),
    enabled: scope !== null,
    retry: false,
    queryFn:
      scope === null
        ? skipToken
        : async () => {
            const result = await businessHoursService.get(scope.businessId);
            if (result.error) throw result.error;
            return result.data;
          },
  });
  const mutation = useMutation<
    BusinessHour[],
    SettingsError,
    { scope: NonNullable<typeof scope>; input: BusinessHoursInput }
  >({
    retry: false,
    mutationFn: async ({ scope, input }) => {
      const result = await businessHoursService.save(scope.businessId, input);
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: (_data, variables) =>
      client.invalidateQueries({ queryKey: businessHoursKey(variables.scope), exact: true }),
  });
  const current = JSON.stringify(mutation.variables?.scope) === JSON.stringify(scope);
  return {
    query,
    scope,
    retry: () => client.invalidateQueries({ queryKey: businessHoursKey(scope), exact: true }),
    mutation: {
      isPending: current && mutation.isPending,
      error: current && mutation.isError ? mutation.error : null,
      reset: mutation.reset,
      async mutateAsync(input: BusinessHoursInput) {
        if (!scope) throw settingsError('BUSINESS_ACCESS_DENIED');
        return mutation.mutateAsync({ scope, input });
      },
    },
  };
}
