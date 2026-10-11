import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { clientsKeys } from '../constants/clientsKeys';
import type { ClientRow } from '../repositories/clientsRepository';
import type { CreateClientInput } from '../schemas/client.schema';
import { clientsService } from '../services/clientsService';
import type { ClientServiceError } from '../types/client.types';
import type { ClientMutationResult } from './clientHook.types';
import { businessIdFrom, mutationResult, requireBusiness } from './clientHookUtils';

export type { ClientMutationResult, ClientMutationStatus } from './clientHook.types';

type CreateVariables = { businessId: string | null; input: CreateClientInput };

export function useCreateClient(): ClientMutationResult<CreateClientInput> {
  const businessId = businessIdFrom(useBusiness());
  const queryClient = useQueryClient();
  const mutation = useMutation<ClientRow, ClientServiceError, CreateVariables>({
    mutationFn: async ({ businessId: capturedBusinessId, input }) => {
      requireBusiness(capturedBusinessId);
      const result = await clientsService.create(capturedBusinessId, input);
      if (result.error !== null) throw result.error;
      return result.data;
    },
    retry: false,
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: clientsKeys.byBusiness(variables.businessId) }),
  });

  return mutationResult(mutation, businessId, (input: CreateClientInput) =>
    mutation.mutateAsync({ businessId, input }),
  );
}
