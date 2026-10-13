import type { UseMutationResult } from '@tanstack/react-query';

import type { BusinessContextValue } from '@/features/business/context/BusinessContext';

import type { ServiceRow } from '../repositories/servicesRepository';
import type { ServiceError } from '../types/service.types';
import type { ServiceMutationResult } from './serviceHook.types';

export function availableId(value: string | null): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function businessIdFrom(context: BusinessContextValue): string | null {
  return context.status === 'success' ? availableId(context.data.business.id) : null;
}

export function requireBusiness(businessId: string | null): asserts businessId is string {
  if (businessId === null) {
    throw serviceHookError('SERVICE_ACCESS_DENIED');
  }
}

export function serviceHookError(
  code: 'SERVICE_ACCESS_DENIED' | 'SERVICE_NOT_FOUND' | 'UNKNOWN_ERROR',
): ServiceError {
  const messages = {
    SERVICE_ACCESS_DENIED: 'No se pudo acceder al servicio.',
    SERVICE_NOT_FOUND: 'No se encontró el servicio o no está disponible.',
    UNKNOWN_ERROR: 'No se pudo completar la operación del servicio. Inténtalo nuevamente.',
  };
  return { code, message: messages[code] };
}

export function mutationResult<TInput, TVariables extends { businessId: string | null }>(
  mutation: UseMutationResult<ServiceRow, ServiceError, TVariables>,
  businessId: string | null,
  mutateAsync: (input: TInput) => Promise<ServiceRow>,
): ServiceMutationResult<TInput> {
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
