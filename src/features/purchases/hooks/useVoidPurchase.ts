import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';

import { purchasesKeys } from '../constants/purchasesKeys';
import { voidPurchaseSchema, type VoidPurchaseInput } from '../schemas/voidPurchase.schema';
import { purchasesService } from '../services/purchasesService';
import { purchaseDetailFromVoid } from '../services/purchaseDetailFromVoid';
import { voidPurchaseError } from '../services/voidPurchaseErrors';
import type { PurchaseDetailData, PurchaseScope } from '../types/purchaseRead.types';
import type { VoidPurchaseData, VoidPurchaseError } from '../types/voidPurchase.types';
import { usePurchaseScope } from './usePurchaseScope';

type Attempt = {
  scope: PurchaseScope;
  epoch: symbol;
  input: VoidPurchaseInput;
  promise: Promise<VoidPurchaseData> | null;
  saved: VoidPurchaseData | null;
  error: VoidPurchaseError | null;
};
type State =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: VoidPurchaseData; error: null }
  | { status: 'error'; data: null; error: VoidPurchaseError };
const idle: State = { status: 'idle', data: null, error: null };
export type UseVoidPurchaseResult = State & {
  mutateAsync: (input: VoidPurchaseInput) => Promise<VoidPurchaseData>;
  retry: () => Promise<VoidPurchaseData>;
  reset: () => void;
  refreshError: boolean;
  retryReads: () => Promise<void>;
};

export function useVoidPurchase(purchaseId: string | null): UseVoidPurchaseResult {
  const scope = usePurchaseScope();
  const key = scope === null ? null : JSON.stringify({ ...scope, purchaseId });
  const lifetime = useMemo(() => ({ key, epoch: Symbol() }), [key]);
  const live = useRef<typeof lifetime | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const [feedback, setFeedback] = useState<{
    epoch: symbol;
    state: State;
    refreshError: boolean;
  } | null>(null);
  const client = useQueryClient();
  const current = (a: Attempt) => live.current?.epoch === a.epoch && attempt.current === a;
  const publish = (a: Attempt, state: State) => {
    if (current(a)) setFeedback({ epoch: a.epoch, state, refreshError: false });
  };
  const mutation = useMutation<VoidPurchaseData, VoidPurchaseError, Attempt>({
    retry: false,
    networkMode: 'always',
    mutationFn: async (a) => {
      if (!current(a)) throw voidPurchaseError('ACCESS_DENIED');
      const result = await purchasesService.voidPurchase(a.scope.businessId, a.input);
      if (result.error) throw result.error;
      return result.data;
    },
  });
  useLayoutEffect(() => {
    live.current = lifetime;
    attempt.current = null;
    return () => {
      live.current = null;
      attempt.current = null;
    };
  }, [lifetime]);
  function fail(code: VoidPurchaseError['code']) {
    return Promise.reject<VoidPurchaseData>(voidPurchaseError(code));
  }
  async function refresh(a: Attempt) {
    if (!current(a)) return;
    try {
      await Promise.all([
        client.invalidateQueries(
          { queryKey: purchasesKeys.byBusiness(a.scope.businessId) },
          { throwOnError: true },
        ),
        client.invalidateQueries(
          { queryKey: inventoryKeys.byBusiness(a.scope.businessId) },
          { throwOnError: true },
        ),
      ]);
      if (current(a))
        setFeedback((value) =>
          value?.epoch === a.epoch ? { ...value, refreshError: false } : value,
        );
    } catch {
      if (current(a))
        setFeedback((value) =>
          value?.epoch === a.epoch ? { ...value, refreshError: true } : value,
        );
    }
  }
  function send(a: Attempt): Promise<VoidPurchaseData> {
    if (!current(a)) return fail('ACCESS_DENIED');
    if (a.promise) return a.promise;
    if (a.saved) {
      publish(a, { status: 'success', data: a.saved, error: null });
      return Promise.resolve(a.saved);
    }
    publish(a, { status: 'pending', data: null, error: null });
    a.promise = mutation
      .mutateAsync(a)
      .then(
        (data) => {
          if (!current(a)) throw voidPurchaseError('ACCESS_DENIED');
          a.saved = data;
          publish(a, { status: 'success', data, error: null });
          // Cancellation protects the cache; success feedback does not wait for reads.
          void client
            .cancelQueries({
              queryKey: purchasesKeys.detail(a.scope, a.input.purchaseId),
              exact: true,
            })
            .then(() => {
              if (!current(a)) return;
              const detailKey = purchasesKeys.detail(a.scope, a.input.purchaseId);
              client.setQueryData(
                detailKey,
                purchaseDetailFromVoid(data, client.getQueryData<PurchaseDetailData>(detailKey)),
              );
              return refresh(a);
            })
            .catch(() => {
              if (current(a))
                setFeedback((value) =>
                  value?.epoch === a.epoch ? { ...value, refreshError: true } : value,
                );
            });
          return data;
        },
        (reason) => {
          if (!current(a)) throw voidPurchaseError('ACCESS_DENIED');
          const codes: VoidPurchaseError['code'][] = [
            'INVALID_INPUT',
            'ACCESS_DENIED',
            'INVALID_STATUS',
            'CONFLICT',
            'INSUFFICIENT_STOCK',
            'INCOMPLETE_HISTORY',
            'NETWORK_ERROR',
            'UNKNOWN_ERROR',
          ];
          const error = voidPurchaseError(
            codes.includes(reason?.code) ? reason.code : 'UNKNOWN_ERROR',
          );
          a.error = error;
          publish(a, { status: 'error', data: null, error });
          throw error;
        },
      )
      .finally(() => {
        a.promise = null;
      });
    return a.promise;
  }
  function mutateAsync(input: VoidPurchaseInput) {
    if (scope === null || live.current?.epoch !== lifetime.epoch) return fail('ACCESS_DENIED');
    const parsed = voidPurchaseSchema.safeParse(input);
    if (!parsed.success || parsed.data.purchaseId !== purchaseId) return fail('INVALID_INPUT');
    const old = attempt.current;
    if (old) {
      if (old.promise) return old.promise;
      const same = JSON.stringify(old.input) === JSON.stringify(parsed.data);
      if (same) return send(old);
      if (
        old.saved ||
        old.error?.code === 'NETWORK_ERROR' ||
        old.error?.code === 'UNKNOWN_ERROR' ||
        old.error?.code === 'CONFLICT'
      )
        return fail('CONFLICT');
      if (old.input.operationId === input.operationId) return fail('CONFLICT');
    }
    const a: Attempt = {
      scope,
      epoch: lifetime.epoch,
      input: Object.freeze({ ...parsed.data }),
      promise: null,
      saved: null,
      error: null,
    };
    attempt.current = a;
    return send(a);
  }
  function retry() {
    if (live.current?.epoch !== lifetime.epoch) return fail('ACCESS_DENIED');
    const a = attempt.current;
    return a ? send(a) : fail('INVALID_INPUT');
  }
  function reset() {
    if (live.current?.epoch !== lifetime.epoch) return;
    const a = attempt.current;
    if (
      a &&
      current(a) &&
      !a.promise &&
      !a.saved &&
      a.error?.code !== 'NETWORK_ERROR' &&
      a.error?.code !== 'UNKNOWN_ERROR' &&
      a.error?.code !== 'CONFLICT'
    ) {
      attempt.current = null;
      setFeedback(null);
    }
  }
  const visible = feedback?.epoch === lifetime.epoch ? feedback : null;
  return {
    ...(visible?.state ?? idle),
    refreshError: visible?.refreshError ?? false,
    mutateAsync,
    retry,
    reset,
    retryReads: async () => {
      if (live.current?.epoch !== lifetime.epoch) return;
      const a = attempt.current;
      if (a?.saved) await refresh(a);
    },
  };
}
