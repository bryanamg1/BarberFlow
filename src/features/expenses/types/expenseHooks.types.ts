import type { ExpenseError, ExpenseRow } from './expense.types';

export type ExpenseScope = Readonly<{
  businessId: string;
  userId: string;
  membershipId: string;
}>;

export type ExpenseState<T> =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: null; error: ExpenseError };

export type ExpenseQueryResult<T> = ExpenseState<T> & {
  isFetching: boolean;
  refetch: () => Promise<void>;
};

export type ExpenseMutationResult<TInput> = ExpenseState<ExpenseRow> & {
  mutateAsync: (input: TInput) => Promise<ExpenseRow>;
  retry: () => Promise<ExpenseRow>;
  reset: () => void;
  refreshError: boolean;
  retryReads: () => Promise<void>;
};
