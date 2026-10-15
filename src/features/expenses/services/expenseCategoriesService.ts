import { expenseCategoriesRepository } from '../repositories/expenseCategoriesRepository';
import {
  createExpenseCategorySchema,
  updateExpenseCategorySchema,
  type CreateExpenseCategoryInput,
  type UpdateExpenseCategoryInput,
} from '../schemas/expenseCategory.schema';
import type {
  ExpenseCategoryError,
  ExpenseCategoryErrorCode,
  ExpenseCategoryResult,
  ExpenseCategoryListParams,
  ExpenseCategoryListResult,
} from '../types/expenseCategory.types';
import { normalizeExpenseCategoryListParams } from '../utils/expenseCategoryListParams';

const usableId = (value: string) => typeof value === 'string' && value.trim().length > 0;

const messages: Record<ExpenseCategoryErrorCode, string> = {
  EXPENSE_CATEGORY_NOT_FOUND: 'No se encontró la categoría o no está disponible.',
  EXPENSE_CATEGORY_ACCESS_DENIED: 'No se pudo acceder a la categoría.',
  NETWORK_ERROR: 'No se pudo conectar con la categoría. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación de la categoría. Inténtalo nuevamente.',
};

function failure(code: ExpenseCategoryErrorCode): { data: null; error: ExpenseCategoryError } {
  return { data: null, error: { code, message: messages[code] } };
}

async function runOperation<T>(
  operation: () => PromiseLike<{ data: T | null; error: { code: string } | null; status: number }>,
  nullCode: 'EXPENSE_CATEGORY_NOT_FOUND' | 'UNKNOWN_ERROR',
): Promise<{ data: T; error: null } | { data: null; error: ExpenseCategoryError }> {
  try {
    const result = await operation();
    if (result.error !== null) {
      if (result.status === 0) return failure('NETWORK_ERROR');
      if (result.status === 401 || result.status === 403 || result.error.code === '42501') {
        return failure('EXPENSE_CATEGORY_ACCESS_DENIED');
      }
      return failure('UNKNOWN_ERROR');
    }
    if (result.data === null) return failure(nullCode);
    return { data: result.data, error: null };
  } catch {
    return failure('UNKNOWN_ERROR');
  }
}

export const expenseCategoriesService = {
  getById(businessId: string, expenseCategoryId: string): Promise<ExpenseCategoryResult> {
    if (!usableId(businessId) || !usableId(expenseCategoryId))
      return Promise.resolve(failure('EXPENSE_CATEGORY_NOT_FOUND'));
    return runOperation(
      () => expenseCategoriesRepository.getById(businessId, expenseCategoryId),
      'EXPENSE_CATEGORY_NOT_FOUND',
    );
  },

  create(businessId: string, input: CreateExpenseCategoryInput): Promise<ExpenseCategoryResult> {
    if (!usableId(businessId)) return Promise.resolve(failure('EXPENSE_CATEGORY_ACCESS_DENIED'));
    const validated = createExpenseCategorySchema.safeParse(input);
    if (!validated.success) return Promise.resolve(failure('UNKNOWN_ERROR'));
    return runOperation(
      () => expenseCategoriesRepository.create(businessId, validated.data),
      'UNKNOWN_ERROR',
    );
  },

  update(
    businessId: string,
    expenseCategoryId: string,
    input: UpdateExpenseCategoryInput,
  ): Promise<ExpenseCategoryResult> {
    if (!usableId(businessId) || !usableId(expenseCategoryId))
      return Promise.resolve(failure('EXPENSE_CATEGORY_NOT_FOUND'));
    const validated = updateExpenseCategorySchema.safeParse(input);
    if (!validated.success) return Promise.resolve(failure('UNKNOWN_ERROR'));
    return runOperation(
      () => expenseCategoriesRepository.update(businessId, expenseCategoryId, validated.data),
      'EXPENSE_CATEGORY_NOT_FOUND',
    );
  },

  async listByBusiness(
    businessId: string,
    params?: ExpenseCategoryListParams,
  ): Promise<ExpenseCategoryListResult> {
    if (!usableId(businessId)) return failure('EXPENSE_CATEGORY_ACCESS_DENIED');
    const normalized = normalizeExpenseCategoryListParams(params);
    if (normalized === null) return failure('UNKNOWN_ERROR');
    const result = await runOperation(
      () => expenseCategoriesRepository.listByBusiness(businessId, normalized),
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
};
