import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';

import { expensesKeys } from '../constants/expensesKeys';
import {
  createManualExpenseSchema,
  updateManualExpenseSchema,
  type CreateManualExpenseInput,
  type UpdateManualExpenseInput,
} from '../schemas/expense.schema';
import { expensesService } from '../services/expensesService';
import type { ExpenseError, ExpenseListPage, ExpenseRow } from '../types/expense.types';
import type {
  ExpenseMutationResult,
  ExpenseScope,
  ExpenseState,
} from '../types/expenseHooks.types';
import { expenseError, safeExpenseError } from '../utils/expenseErrors';
import { readExpense } from './expenseQuery';
import { usableExpenseId, useExpenseLifecycle } from './useExpenseLifecycle';

type Attempt = {
  scope: ExpenseScope;
  epoch: symbol;
  input: UpdateManualExpenseInput;
  expenseId: string | null;
  promise: Promise<ExpenseRow> | null;
  saved: ExpenseRow | null;
};
const idle: ExpenseState<ExpenseRow> = { status: 'idle', data: null, error: null };

// Internal common lifecycle for the two concrete approved MANUAL operations.
export function useManualExpenseMutation(
  kind: 'create' | 'update',
  expenseId: string | null,
): ExpenseMutationResult<UpdateManualExpenseInput> {
  const lifetime = useExpenseLifecycle(JSON.stringify({ kind, expenseId }));
  const { scope, epoch } = lifetime;
  const attempt = useRef<Attempt | null>(null);
  const [feedback, setFeedback] = useState<{
    epoch: symbol;
    state: ExpenseState<ExpenseRow>;
    refreshError: boolean;
  } | null>(null);
  const client = useQueryClient();
  const current = (a: Attempt) =>
    lifetime.isCurrent() && a.epoch === epoch && attempt.current === a;
  useLayoutEffect(() => {
    attempt.current = null;
    return () => {
      attempt.current = null;
    };
  }, [epoch]);
  const publish = (a: Attempt, state: ExpenseState<ExpenseRow>) => {
    if (current(a)) setFeedback({ epoch, state, refreshError: false });
  };
  const fail = (code: ExpenseError['code']) => Promise.reject<ExpenseRow>(expenseError(code));
  function knownPurchase(a: Attempt) {
    if (kind !== 'update') return false;
    const detail = client.getQueryData<ExpenseRow>(expensesKeys.detail(a.scope, a.expenseId));
    const lists = client.getQueriesData<ExpenseListPage>({
      queryKey: [...expensesKeys.byBusiness(a.scope.businessId), 'list', a.scope],
    });
    return (
      detail?.source_type === 'PURCHASE' ||
      lists.some(([, page]) =>
        page?.items?.some((row) => row.id === a.expenseId && row.source_type === 'PURCHASE'),
      )
    );
  }
  const mutation = useMutation<ExpenseRow, ExpenseError, Attempt>({
    retry: false,
    // Never queue an offline financial write to start on reconnect.
    networkMode: 'always',
    mutationFn: (a) => {
      if (!current(a)) return fail('EXPENSE_ACCESS_DENIED');
      if (knownPurchase(a)) return fail('EXPENSE_ACCESS_DENIED');
      return readExpense(
        () =>
          kind === 'create'
            ? expensesService.createManual(a.scope.businessId, a.input as CreateManualExpenseInput)
            : expensesService.updateManual(a.scope.businessId, a.expenseId!, a.input),
        () => current(a),
      );
    },
  });
  async function refresh(a: Attempt) {
    if (!current(a)) return;
    try {
      // One real prefix covers list AND affected detail; no duplicate refetch,
      // category mutation or invented Finance/Analytics key.
      await client.invalidateQueries(
        { queryKey: expensesKeys.byBusiness(a.scope.businessId) },
        { throwOnError: true },
      );
      if (current(a))
        setFeedback((old) => (old?.epoch === epoch ? { ...old, refreshError: false } : old));
    } catch {
      if (current(a))
        setFeedback((old) => (old?.epoch === epoch ? { ...old, refreshError: true } : old));
    }
  }
  function send(a: Attempt): Promise<ExpenseRow> {
    if (!current(a)) return fail('EXPENSE_ACCESS_DENIED');
    if (a.promise) return a.promise;
    if (a.saved) return Promise.resolve(a.saved);
    publish(a, { status: 'pending', data: null, error: null });
    a.promise = mutation
      .mutateAsync(a)
      .then(
        async (data) => {
          if (!current(a)) throw expenseError('EXPENSE_ACCESS_DENIED');
          a.saved = data;
          publish(a, { status: 'success', data, error: null });
          await refresh(a);
          if (!current(a)) throw expenseError('EXPENSE_ACCESS_DENIED');
          return data;
        },
        (reason: unknown) => {
          if (!current(a)) throw expenseError('EXPENSE_ACCESS_DENIED');
          const error = safeExpenseError(reason);
          publish(a, { status: 'error', data: null, error });
          throw error;
        },
      )
      .finally(() => {
        a.promise = null;
      });
    return a.promise;
  }
  function mutateAsync(input: UpdateManualExpenseInput) {
    if (scope === null || !lifetime.isCurrent()) return fail('EXPENSE_ACCESS_DENIED');
    if (kind === 'update' && !usableExpenseId(expenseId)) return fail('INVALID_INPUT');
    const previous = attempt.current;
    if (previous?.promise) return previous.promise;
    const parsed = (
      kind === 'create' ? createManualExpenseSchema : updateManualExpenseSchema
    ).safeParse(input);
    if (!parsed.success) return fail('INVALID_INPUT');
    if (previous)
      return JSON.stringify(previous.input) === JSON.stringify(parsed.data)
        ? send(previous)
        : fail('INVALID_INPUT');
    const a: Attempt = {
      scope,
      epoch,
      expenseId,
      input: Object.freeze({ ...parsed.data }),
      promise: null,
      saved: null,
    };
    attempt.current = a;
    return send(a);
  }
  function reset() {
    if (!lifetime.isCurrent() || attempt.current?.promise) return;
    attempt.current = null;
    setFeedback(null);
    mutation.reset();
  }
  const visible = lifetime.isCurrent() && feedback?.epoch === epoch ? feedback : null;
  return {
    ...(visible?.state ?? idle),
    refreshError: visible?.refreshError ?? false,
    mutateAsync,
    reset,
    retry: () =>
      !lifetime.isCurrent()
        ? fail('EXPENSE_ACCESS_DENIED')
        : attempt.current
          ? send(attempt.current)
          : fail('INVALID_INPUT'),
    retryReads: async () => {
      if (lifetime.isCurrent() && attempt.current?.saved) await refresh(attempt.current);
    },
  };
}
