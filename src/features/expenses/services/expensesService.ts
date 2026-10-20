import { isAuthRetryableFetchError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { z } from 'zod';

import { expensesRepository } from '../repositories/expensesRepository';
import {
  createManualExpenseSchema,
  updateManualExpenseSchema,
  type CreateManualExpenseInput,
  type UpdateManualExpenseInput,
} from '../schemas/expense.schema';
import type {
  ExpenseRow,
  ExpenseError,
  ExpenseErrorCode,
  ExpenseListParams,
  ExpenseListPage,
  ExpenseResult,
} from '../types/expense.types';
import { normalizeExpenseListParams } from '../utils/expenseListParams';

const usableId = z.string().refine((value) => value.trim().length > 0);
const rowSchema: z.ZodType<ExpenseRow> = z
  .object({
    id: usableId,
    business_id: usableId,
    category_id: usableId,
    source_type: z.enum(['MANUAL', 'PURCHASE']),
    purchase_id: usableId.nullable(),
    description: createManualExpenseSchema.shape.description,
    amount: z.number().finite().min(0).max(9999999999.99),
    payment_method: z.string(),
    expense_date: createManualExpenseSchema.shape.expense_date,
    receipt_path: z.string().nullable(),
    notes: z.string().nullable(),
    created_by: usableId,
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .refine((row) => (row.source_type === 'MANUAL') === (row.purchase_id === null));

const messages: Record<ExpenseErrorCode, string> = {
  EXPENSE_ACCESS_DENIED: 'No se pudo acceder al gasto.',
  EXPENSE_NOT_FOUND: 'No se encontró el gasto o no está disponible.',
  INVALID_INPUT: 'Revisa los datos del gasto.',
  NETWORK_ERROR: 'No se pudo conectar con los gastos. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación del gasto. Inténtalo nuevamente.',
};

function failure(code: ExpenseErrorCode): { data: null; error: ExpenseError } {
  return { data: null, error: { code, message: messages[code] } };
}

function errorCode(error: unknown, status?: number): ExpenseErrorCode {
  if (status === 0 || isAuthRetryableFetchError(error)) return 'NETWORK_ERROR';
  if (isAuthSessionMissingError(error)) return 'EXPENSE_ACCESS_DENIED';
  if (status === 401 || status === 403) return 'EXPENSE_ACCESS_DENIED';
  if (typeof error === 'object' && error !== null) {
    if ('status' in error && (error.status === 401 || error.status === 403))
      return 'EXPENSE_ACCESS_DENIED';
    if ('code' in error && error.code === '42501') return 'EXPENSE_ACCESS_DENIED';
  }
  return 'UNKNOWN_ERROR';
}

async function run<T>(
  operation: () => PromiseLike<{ data: unknown; error: unknown; status?: number }>,
  schema: z.ZodType<T>,
  nullCode: 'EXPENSE_NOT_FOUND' | 'UNKNOWN_ERROR',
): Promise<ExpenseResult<T>> {
  try {
    const result = await operation();
    if (result.error !== null) return failure(errorCode(result.error, result.status));
    if (result.data === null) return failure(nullCode);
    const parsed = schema.safeParse(result.data);
    return parsed.success ? { data: parsed.data, error: null } : failure('UNKNOWN_ERROR');
  } catch (error: unknown) {
    return failure(isAuthRetryableFetchError(error) ? 'NETWORK_ERROR' : 'UNKNOWN_ERROR');
  }
}

const scopedRow = (businessId: string, expenseId?: string, manual = false) =>
  rowSchema.refine(
    (row) =>
      row.business_id === businessId &&
      (expenseId === undefined || row.id === expenseId) &&
      (!manual || row.source_type === 'MANUAL'),
  );

export const expensesService = {
  async listByBusiness(
    businessId: string,
    params?: ExpenseListParams,
  ): Promise<ExpenseResult<ExpenseListPage>> {
    if (!usableId.safeParse(businessId).success) return failure('EXPENSE_ACCESS_DENIED');
    const normalized = normalizeExpenseListParams(params);
    if (normalized === null) return failure('INVALID_INPUT');
    const result = await run(
      () => expensesRepository.listByBusiness(businessId, normalized),
      z.array(scopedRow(businessId)),
      'UNKNOWN_ERROR',
    );
    if (result.error !== null) return result;
    return {
      data: {
        items: result.data.slice(0, normalized.pageSize),
        page: normalized.page,
        pageSize: normalized.pageSize,
        hasNextPage: result.data.length > normalized.pageSize,
      },
      error: null,
    };
  },

  getById(businessId: string, expenseId: string): Promise<ExpenseResult> {
    if (!usableId.safeParse(businessId).success)
      return Promise.resolve(failure('EXPENSE_ACCESS_DENIED'));
    if (!usableId.safeParse(expenseId).success) return Promise.resolve(failure('INVALID_INPUT'));
    return run(
      () => expensesRepository.getById(businessId, expenseId),
      scopedRow(businessId, expenseId),
      'EXPENSE_NOT_FOUND',
    );
  },

  createManual(businessId: string, input: CreateManualExpenseInput): Promise<ExpenseResult> {
    if (!usableId.safeParse(businessId).success)
      return Promise.resolve(failure('EXPENSE_ACCESS_DENIED'));
    const parsed = createManualExpenseSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(failure('INVALID_INPUT'));
    return run(
      () => expensesRepository.createManual(businessId, parsed.data),
      scopedRow(businessId, undefined, true),
      'UNKNOWN_ERROR',
    );
  },

  updateManual(
    businessId: string,
    expenseId: string,
    input: UpdateManualExpenseInput,
  ): Promise<ExpenseResult> {
    if (!usableId.safeParse(businessId).success)
      return Promise.resolve(failure('EXPENSE_ACCESS_DENIED'));
    if (!usableId.safeParse(expenseId).success) return Promise.resolve(failure('INVALID_INPUT'));
    const parsed = updateManualExpenseSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(failure('INVALID_INPUT'));
    return run(
      () => expensesRepository.updateManual(businessId, expenseId, parsed.data),
      scopedRow(businessId, expenseId, true),
      'EXPENSE_NOT_FOUND',
    );
  },
};
