import type { UseMutationResult } from '@tanstack/react-query';

import type { BusinessContextValue } from '@/features/business/context/BusinessContext';

import type { ExpenseCategoryRow } from '../repositories/expenseCategoriesRepository';
import type { ExpenseCategoryError } from '../types/expenseCategory.types';
import type { ExpenseCategoryMutationResult } from './expenseCategoryHook.types';

export function availableId(value: string | null): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function businessIdFrom(context: BusinessContextValue): string | null {
  return context.status === 'success' && context.data.role === 'OWNER'
    ? availableId(context.data.business.id)
    : null;
}

export function requireBusiness(businessId: string | null): asserts businessId is string {
  if (businessId === null) {
    throw expenseCategoryHookError('EXPENSE_CATEGORY_ACCESS_DENIED');
  }
}

export function expenseCategoryHookError(
  code: 'EXPENSE_CATEGORY_ACCESS_DENIED' | 'EXPENSE_CATEGORY_NOT_FOUND' | 'UNKNOWN_ERROR',
): ExpenseCategoryError {
  const messages = {
    EXPENSE_CATEGORY_ACCESS_DENIED: 'No se pudo acceder a la categoría.',
    EXPENSE_CATEGORY_NOT_FOUND: 'No se encontró la categoría o no está disponible.',
    UNKNOWN_ERROR: 'No se pudo completar la operación de la categoría. Inténtalo nuevamente.',
  };
  return { code, message: messages[code] };
}

export function mutationResult<TInput, TVariables extends { businessId: string | null }>(
  mutation: UseMutationResult<ExpenseCategoryRow, ExpenseCategoryError, TVariables>,
  businessId: string | null,
  mutateAsync: (input: TInput) => Promise<ExpenseCategoryRow>,
): ExpenseCategoryMutationResult<TInput> {
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
