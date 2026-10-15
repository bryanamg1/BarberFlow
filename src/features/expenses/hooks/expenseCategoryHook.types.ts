import type { ExpenseCategoryRow } from '../repositories/expenseCategoriesRepository';
import type { UpdateExpenseCategoryInput } from '../schemas/expenseCategory.schema';
import type { ExpenseCategoryListPage, ExpenseCategoryError } from '../types/expenseCategory.types';

export type UseExpenseCategoryDetailResult =
  | { status: 'idle'; data: null; error: null; isFetching: false }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: ExpenseCategoryRow; error: null; isFetching: boolean }
  | { status: 'error'; data: null; error: ExpenseCategoryError; isFetching: boolean };

export type UseExpenseCategoryListResult =
  | { status: 'idle'; data: null; error: null; isFetching: false }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: ExpenseCategoryListPage; error: null; isFetching: boolean }
  | { status: 'error'; data: null; error: ExpenseCategoryError; isFetching: boolean };

export type ExpenseCategoryMutationStatus = 'idle' | 'pending' | 'success' | 'error';

export type ExpenseCategoryMutationResult<TInput> = {
  mutateAsync: (input: TInput) => Promise<ExpenseCategoryRow>;
  reset: () => void;
} & (
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: ExpenseCategoryRow; error: null }
  | { status: 'error'; data: null; error: ExpenseCategoryError }
);

export type UpdateExpenseCategoryVariables = {
  expenseCategoryId: string;
  input: UpdateExpenseCategoryInput;
};
