import { skipToken, useQuery } from '@tanstack/react-query';

import { expensesKeys } from '../constants/expensesKeys';
import { expensesService } from '../services/expensesService';
import type { ExpenseError, ExpenseListPage, ExpenseListParams } from '../types/expense.types';
import type { ExpenseQueryResult } from '../types/expenseHooks.types';
import { normalizeExpenseListParams } from '../utils/expenseListParams';
import { expenseQueryState, readExpense } from './expenseQuery';
import { useExpenseLifecycle } from './useExpenseLifecycle';

export function useExpenses(params?: ExpenseListParams): ExpenseQueryResult<ExpenseListPage> {
  const normalized = normalizeExpenseListParams(params);
  const lifetime = useExpenseLifecycle(JSON.stringify({ list: normalized }));
  const { scope } = lifetime;
  const query = useQuery<ExpenseListPage, ExpenseError>({
    queryKey: expensesKeys.list(scope, normalized ?? { page: 1, pageSize: 25 }),
    queryFn:
      scope === null || normalized === null
        ? skipToken
        : () =>
            readExpense(
              () => expensesService.listByBusiness(scope.businessId, normalized),
              lifetime.isCurrent,
            ),
    enabled: scope !== null && normalized !== null,
    retry: false,
  });
  const refetch = async () => {
    if (lifetime.isCurrent() && normalized !== null) await query.refetch();
  };
  return expenseQueryState(query, scope !== null, normalized !== null, refetch);
}
