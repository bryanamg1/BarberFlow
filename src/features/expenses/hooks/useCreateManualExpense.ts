import type { CreateManualExpenseInput } from '../schemas/expense.schema';
import type { ExpenseMutationResult } from '../types/expenseHooks.types';
import { useManualExpenseMutation } from './useManualExpenseMutation';

export function useCreateManualExpense(): ExpenseMutationResult<CreateManualExpenseInput> {
  return useManualExpenseMutation('create', null);
}
