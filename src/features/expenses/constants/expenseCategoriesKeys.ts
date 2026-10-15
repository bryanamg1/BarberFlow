import type { ExpenseCategoryListParams } from '../types/expenseCategory.types';

export const expenseCategoriesKeys = {
  all: ['expenseCategories'] as const,
  byBusiness: (businessId: string | null) => [...expenseCategoriesKeys.all, businessId] as const,
  detail: (businessId: string | null, expenseCategoryId: string | null) =>
    [...expenseCategoriesKeys.byBusiness(businessId), 'detail', expenseCategoryId] as const,
  list: (businessId: string | null, params: Required<ExpenseCategoryListParams>) =>
    [
      ...expenseCategoriesKeys.byBusiness(businessId),
      'list',
      { page: params.page, pageSize: params.pageSize, status: params.status },
    ] as const,
};
