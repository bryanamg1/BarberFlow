import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useBusiness } from '@/features/business/context/BusinessContext';

import { clientsKeys } from '../constants/clientsKeys';
import type { ClientRow } from '../repositories/clientsRepository';
import { clientsService } from '../services/clientsService';
import type { ClientServiceError } from '../types/client.types';
import type { ClientMutationResult, UpdateClientVariables } from './clientHook.types';
import { availableId, businessIdFrom, mutationResult, requireBusiness } from './clientHookUtils';

export type {
  ClientMutationResult,
  ClientMutationStatus,
  UpdateClientVariables,
} from './clientHook.types';

type UpdateVariables = UpdateClientVariables & { businessId: string | null };

export function useUpdateClient(): ClientMutationResult<UpdateClientVariables> {
  const businessId = businessIdFrom(useBusiness());
  const queryClient = useQueryClient();
  const mutation = useMutation<ClientRow, ClientServiceError, UpdateVariables>({
    mutationFn: async ({ businessId: capturedBusinessId, clientId, input }) => {
      requireBusiness(capturedBusinessId);
      if (availableId(clientId) === null) {
        throw {
          code: 'CLIENT_NOT_FOUND',
          message: 'No se encontró el cliente o no está disponible.',
        } satisfies ClientServiceError;
      }
      const result = await clientsService.update(capturedBusinessId, clientId, input);
      if (result.error !== null) throw result.error;
      return result.data;
    },
    retry: false,
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: clientsKeys.byBusiness(variables.businessId) }),
  });

  return mutationResult(mutation, businessId, ({ clientId, input }: UpdateClientVariables) =>
    mutation.mutateAsync({ businessId, clientId, input }),
  );
}
