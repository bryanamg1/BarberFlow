import type { Session } from '@supabase/supabase-js';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import type { ExpenseRow } from '@/features/expenses/types/expense.types';
import type { ExpenseCategoryRow } from '@/features/expenses/repositories/expenseCategoriesRepository';
import { createTestQueryClient } from '@/test/createTestQueryClient';

export const expenseAt = '2026-01-01T00:00:00Z';
export const expenseRow = (id = 'expense-hidden-id', businessId = 'b'): ExpenseRow => ({
  id,
  business_id: businessId,
  category_id: 'category-hidden-id',
  source_type: 'MANUAL',
  purchase_id: null,
  description: 'Alquiler del local',
  amount: 1500.5,
  payment_method: 'CASH',
  expense_date: '2026-09-20',
  receipt_path: null,
  notes: null,
  created_by: 'u',
  created_at: expenseAt,
  updated_at: expenseAt,
});
export const expenseCategory = (id = 'category-hidden-id', active = true): ExpenseCategoryRow => ({
  id,
  business_id: 'b',
  name: active ? 'Alquiler' : 'Categoría histórica',
  is_active: active,
  created_at: expenseAt,
  updated_at: expenseAt,
});
export function expenseContext(
  businessId = 'b',
  userId = 'u',
  membershipId = 'm',
  role: 'OWNER' | 'BARBER' = 'OWNER',
) {
  const session: Session = {
    access_token: 'test-only',
    refresh_token: 'test-only',
    token_type: 'bearer',
    expires_in: 3600,
    user: {
      id: userId,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: expenseAt,
    },
  };
  jest
    .mocked(useAuth)
    .mockReturnValue({ status: 'authenticated', session, user: session.user, error: null });
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    error: null,
    isFetching: false,
    data: {
      membershipId,
      role,
      business: {
        id: businessId,
        name: 'Demo',
        currency_code: 'ARS',
        timezone: 'America/Argentina/Buenos_Aires',
        is_active: true,
      },
    },
  });
}
export function expenseDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
export async function mountExpense(node: ReactNode) {
  const client = createTestQueryClient();
  const tree = (child: ReactNode) => (
    <QueryClientProvider client={client}>{child}</QueryClientProvider>
  );
  const view = await render(tree(node));
  return {
    client,
    unmount: () => view.unmount(),
    rerender: (child: ReactNode) => view.rerender(tree(child)),
  };
}
