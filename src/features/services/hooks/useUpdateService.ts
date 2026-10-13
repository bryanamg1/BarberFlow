import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { servicesKeys } from '../constants/servicesKeys';
import type { ServiceRow } from '../repositories/servicesRepository';
import { servicesService } from '../services/servicesService';
import type { ServiceError } from '../types/service.types';
import type { ServiceMutationResult, UpdateServiceVariables } from './serviceHook.types';
import {
  availableId,
  businessIdFrom,
  mutationResult,
  requireBusiness,
  serviceHookError,
} from './serviceHookUtils';

export type {
  ServiceMutationResult,
  ServiceMutationStatus,
  UpdateServiceVariables,
} from './serviceHook.types';

type UpdateVariables = UpdateServiceVariables & { businessId: string | null };

export function useUpdateService(): ServiceMutationResult<UpdateServiceVariables> {
  const businessId = businessIdFrom(useBusiness());
  const queryClient = useQueryClient();
  const mutation = useMutation<ServiceRow, ServiceError, UpdateVariables>({
    mutationFn: async ({ businessId: capturedBusinessId, serviceId, input }) => {
      requireBusiness(capturedBusinessId);
      if (availableId(serviceId) === null) {
        throw serviceHookError('SERVICE_NOT_FOUND');
      }
      const result = await servicesService.update(capturedBusinessId, serviceId, input);
      if (result.error !== null) throw result.error;
      return result.data;
    },
    retry: false,
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: servicesKeys.byBusiness(variables.businessId) }),
  });

  return mutationResult(mutation, businessId, ({ serviceId, input }: UpdateServiceVariables) =>
    mutation.mutateAsync({ businessId, serviceId, input }),
  );
}
