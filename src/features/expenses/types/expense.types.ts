// SDK row projection, including historical payment method text. BF-215 aligned
// the database CHECK; write inputs remain defined by the separate BF-230 schemas.
export type ExpenseRow = {
  id: string;
  business_id: string;
  category_id: string;
  source_type: 'MANUAL' | 'PURCHASE';
  purchase_id: string | null;
  description: string;
  amount: number;
  payment_method: string;
  expense_date: string;
  receipt_path: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ExpenseListParams = {
  page?: number;
  pageSize?: number;
  sourceType?: ExpenseRow['source_type'];
  categoryId?: string;
  from?: string;
  to?: string;
};

export type ResolvedExpenseListParams = ExpenseListParams & { page: number; pageSize: number };

export type ExpenseErrorCode =
  | 'EXPENSE_ACCESS_DENIED'
  | 'EXPENSE_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export type ExpenseError = { code: ExpenseErrorCode; message: string };
export type ExpenseResult<T = ExpenseRow> =
  { data: T; error: null } | { data: null; error: ExpenseError };
export type ExpenseListPage = {
  items: ExpenseRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};
