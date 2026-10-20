import type { UseQueryResult } from '@tanstack/react-query';

import type { ExpenseError, ExpenseResult } from '../types/expense.types';
import type { ExpenseQueryResult } from '../types/expenseHooks.types';
import { expenseError } from '../utils/expenseErrors';

export async function readExpense<T>(
  operation: () => Promise<ExpenseResult<T>>,
  current: () => boolean,
): Promise<T> {
  if (!current()) throw expenseError('EXPENSE_ACCESS_DENIED');
  let result: ExpenseResult<T>;
  try {
    result = await operation();
  } catch {
    throw expenseError('UNKNOWN_ERROR');
  }
  if (!current()) throw expenseError('EXPENSE_ACCESS_DENIED');
  if (result.error !== null) throw result.error;
  return result.data;
}

export function expenseQueryState<T>(
  query: UseQueryResult<T, ExpenseError>,
  active: boolean,
  valid: boolean,
  refetch: () => Promise<void>,
): ExpenseQueryResult<T> {
  const actions = { refetch, isFetching: active && valid && query.isFetching };
  if (!active) return { ...actions, status: 'idle', data: null, error: null };
  if (!valid)
    return { ...actions, status: 'error', data: null, error: expenseError('INVALID_INPUT') };
  if (query.isError) return { ...actions, status: 'error', data: null, error: query.error };
  if (query.isSuccess) return { ...actions, status: 'success', data: query.data, error: null };
  return { ...actions, status: 'pending', data: null, error: null };
}
