import type { UseMutationResult } from '@tanstack/react-query';

import type { BusinessContextValue } from '@/features/business/context/BusinessContext';

import type { ClientRow } from '../repositories/clientsRepository';
import type { ClientServiceError } from '../types/client.types';
import type { ClientMutationResult } from './clientHook.types';

export function availableId(value: string | null): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function businessIdFrom(context: BusinessContextValue): string | null {
  return context.status === 'success' ? availableId(context.data.business.id) : null;
}

export function requireBusiness(businessId: string | null): asserts businessId is string {
  if (businessId === null) {
    throw {
      code: 'CLIENT_ACCESS_DENIED',
      message: 'No hay un negocio disponible para realizar esta operación.',
    } satisfies ClientServiceError;
  }
}

export function mutationResult<TInput, TVariables extends { businessId: string | null }>(
  mutation: UseMutationResult<ClientRow, ClientServiceError, TVariables>,
  businessId: string | null,
  mutateAsync: (input: TInput) => Promise<ClientRow>,
): ClientMutationResult<TInput> {
  const actions = { mutateAsync, reset: mutation.reset };
  // Null-scoped local validation errors remain visible; previous business results do not.
  if (mutation.variables?.businessId !== businessId || mutation.isIdle) {
    return { ...actions, status: 'idle', data: null, error: null };
  }
  if (mutation.isError) {
    return { ...actions, status: 'error', data: null, error: mutation.error };
  }
  if (mutation.isSuccess) {
    return { ...actions, status: 'success', data: mutation.data, error: null };
  }
  return { ...actions, status: 'pending', data: null, error: null };
}
