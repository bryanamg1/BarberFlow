import { z } from 'zod';

import { createManualExpenseSchema } from '../schemas/expense.schema';
import type { ExpenseListParams, ResolvedExpenseListParams } from '../types/expense.types';

const listParams = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  sourceType: z.enum(['MANUAL', 'PURCHASE']).optional(),
  categoryId: createManualExpenseSchema.shape.category_id.optional(),
  from: createManualExpenseSchema.shape.expense_date.optional(),
  to: createManualExpenseSchema.shape.expense_date.optional(),
});

export function normalizeExpenseListParams(
  params: ExpenseListParams = {},
): ResolvedExpenseListParams | null {
  const parsed = listParams.safeParse(params);
  if (!parsed.success) return null;
  const value = parsed.data;
  const offset = (value.page - 1) * value.pageSize;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(offset + value.pageSize) ||
    (value.from !== undefined && value.to !== undefined && value.from > value.to)
  )
    return null;
  return value;
}
