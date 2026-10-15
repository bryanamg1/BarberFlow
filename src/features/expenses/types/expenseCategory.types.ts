import type { ExpenseCategoryRow } from '../repositories/expenseCategoriesRepository';

export type ExpenseCategoryErrorCode =
  | 'EXPENSE_CATEGORY_NOT_FOUND'
  | 'EXPENSE_CATEGORY_ACCESS_DENIED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export type ExpenseCategoryError = { code: ExpenseCategoryErrorCode; message: string };

export type ExpenseCategoryResult =
  { data: ExpenseCategoryRow; error: null } | { data: null; error: ExpenseCategoryError };

export type ExpenseCategoryListParams = {
  page?: number;
  pageSize?: number;
  status?: 'active' | 'inactive' | 'all';
};

export type ExpenseCategoryListPage = {
  items: ExpenseCategoryRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};

export type ExpenseCategoryListResult =
  { data: ExpenseCategoryListPage; error: null } | { data: null; error: ExpenseCategoryError };
