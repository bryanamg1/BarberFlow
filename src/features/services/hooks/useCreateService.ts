import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { servicesKeys } from '../constants/servicesKeys';
import type { ServiceRow } from '../repositories/servicesRepository';
import type { CreateServiceInput } from '../schemas/service.schema';
import { servicesService } from '../services/servicesService';
import type { ServiceError } from '../types/service.types';
import type { ServiceMutationResult } from './serviceHook.types';
import { businessIdFrom, mutationResult, requireBusiness } from './serviceHookUtils';

export type { ServiceMutationResult, ServiceMutationStatus } from './serviceHook.types';

type CreateVariables = { businessId: string | null; input: CreateServiceInput };

export function useCreateService(): ServiceMutationResult<CreateServiceInput> {
  const businessId = businessIdFrom(useBusiness());
  const queryClient = useQueryClient();
  const mutation = useMutation<ServiceRow, ServiceError, CreateVariables>({
    mutationFn: async ({ businessId: capturedBusinessId, input }) => {
      requireBusiness(capturedBusinessId);
      const result = await servicesService.create(capturedBusinessId, input);
      if (result.error !== null) throw result.error;
      return result.data;
    },
    retry: false,
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: servicesKeys.byBusiness(variables.businessId) }),
  });

  return mutationResult(mutation, businessId, (input: CreateServiceInput) =>
    mutation.mutateAsync({ businessId, input }),
  );
}
