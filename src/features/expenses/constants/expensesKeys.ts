import type { ResolvedExpenseListParams } from '../types/expense.types';
import type { ExpenseScope } from '../types/expenseHooks.types';

const scopeKey = (scope: ExpenseScope | null) =>
  scope === null
    ? null
    : Object.freeze({
        businessId: scope.businessId,
        userId: scope.userId,
        membershipId: scope.membershipId,
      });

export const expensesKeys = {
  all: ['expenses'] as const,
  byBusiness: (businessId: string | null) => ['expenses', businessId] as const,
  list: (scope: ExpenseScope | null, params: ResolvedExpenseListParams) =>
    [
      'expenses',
      scope?.businessId ?? null,
      'list',
      scopeKey(scope),
      {
        page: params.page,
        pageSize: params.pageSize,
        sourceType: params.sourceType,
        categoryId: params.categoryId,
        from: params.from,
        to: params.to,
      },
    ] as const,
  detail: (scope: ExpenseScope | null, expenseId: string | null) =>
    ['expenses', scope?.businessId ?? null, 'detail', scopeKey(scope), expenseId] as const,
};
