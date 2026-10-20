import type { UpdateManualExpenseInput } from '../schemas/expense.schema';
import type { ExpenseMutationResult } from '../types/expenseHooks.types';
import { useManualExpenseMutation } from './useManualExpenseMutation';

export function useUpdateManualExpense(
  expenseId: string | null,
): ExpenseMutationResult<UpdateManualExpenseInput> {
  return useManualExpenseMutation('update', expenseId);
}
