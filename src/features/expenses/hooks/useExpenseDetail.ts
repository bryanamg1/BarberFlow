import { skipToken, useQuery } from '@tanstack/react-query';

import { expensesKeys } from '../constants/expensesKeys';
import { expensesService } from '../services/expensesService';
import type { ExpenseError, ExpenseRow } from '../types/expense.types';
import type { ExpenseQueryResult } from '../types/expenseHooks.types';
import { expenseQueryState, readExpense } from './expenseQuery';
import { usableExpenseId, useExpenseLifecycle } from './useExpenseLifecycle';

export function useExpenseDetail(expenseId: string | null): ExpenseQueryResult<ExpenseRow> {
  const lifetime = useExpenseLifecycle(JSON.stringify({ detail: expenseId }));
  const { scope } = lifetime;
  const valid = usableExpenseId(expenseId);
  const query = useQuery<ExpenseRow, ExpenseError>({
    queryKey: expensesKeys.detail(scope, expenseId),
    queryFn:
      scope === null || !valid
        ? skipToken
        : () =>
            readExpense(
              () => expensesService.getById(scope.businessId, expenseId),
              lifetime.isCurrent,
            ),
    enabled: scope !== null && valid,
    retry: false,
  });
  const refetch = async () => {
    if (lifetime.isCurrent() && valid) await query.refetch();
  };
  return expenseQueryState(query, scope !== null, valid, refetch);
}
