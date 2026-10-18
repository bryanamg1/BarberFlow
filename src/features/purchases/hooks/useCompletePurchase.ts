import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';

import { completePurchaseSchema, type CompletePurchaseInput } from '../schemas/purchase.schema';
import { completePurchaseError } from '../services/completePurchaseErrors';
import { purchasesService } from '../services/purchasesService';
import { purchaseDraftStore } from '../store/purchaseDraftStore';
import type {
  CompletePurchaseData,
  CompletePurchaseError,
  UseCompletePurchaseResult,
} from '../types/completePurchase.types';

export type { UseCompletePurchaseResult } from '../types/completePurchase.types';

type Scope = { businessId: string; userId: string; membershipId: string };
type Attempt = {
  scope: Scope;
  epoch: symbol;
  input: CompletePurchaseInput;
  promise: Promise<CompletePurchaseData> | null;
  saved: CompletePurchaseData | null;
};
type State =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: CompletePurchaseData; error: null }
  | { status: 'error'; data: null; error: CompletePurchaseError };
const idle: State = { status: 'idle', data: null, error: null };

export function useCompletePurchase(): UseCompletePurchaseResult {
  const auth = useAuth();
  const business = useBusiness();
  const scope: Scope | null =
    auth.status === 'authenticated' &&
    business.status === 'success' &&
    business.data.role === 'OWNER'
      ? {
          businessId: business.data.business.id,
          membershipId: business.data.membershipId,
          userId: auth.user.id,
        }
      : null;
  const scopeKey = scope === null ? null : JSON.stringify(scope);
  const lifetime = useMemo(() => ({ key: scopeKey, epoch: Symbol() }), [scopeKey]);
  const { epoch } = lifetime;
  const live = useRef<{ key: string | null; epoch: symbol } | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const [scopedState, setScopedState] = useState<{ epoch: symbol | null; value: State }>({
    epoch: null,
    value: idle,
  });
  const client = useQueryClient();
  const mutation = useMutation<CompletePurchaseData, CompletePurchaseError, Attempt>({
    retry: false,
    // Do not park an offline financial write to launch automatically later.
    networkMode: 'always',
    mutationFn: async (value) => {
      if (!current(value)) throw completePurchaseError('ACCESS_DENIED');
      const result = await purchasesService.completePurchase(value.scope.businessId, value.input);
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

  function setState(value: State) {
    setScopedState({ epoch, value });
  }

  function current(value: Attempt) {
    return live.current?.epoch === value.epoch && live.current.key === JSON.stringify(value.scope);
  }
  function fail(code: CompletePurchaseError['code']) {
    const error = completePurchaseError(code);
    if (live.current?.epoch === epoch) setState({ status: 'error', data: null, error });
    return Promise.reject<CompletePurchaseData>(error);
  }
  function send(value: Attempt): Promise<CompletePurchaseData> {
    if (!current(value)) return Promise.reject(completePurchaseError('ACCESS_DENIED'));
    if (value.promise) return value.promise;
    if (value.saved) {
      setState({ status: 'success', data: value.saved, error: null });
      return Promise.resolve(value.saved);
    }
    setState({ status: 'pending', data: null, error: null });
    value.promise = mutation
      .mutateAsync(value)
      .then(
        (data) => {
          if (!current(value)) throw completePurchaseError('ACCESS_DENIED');
          value.saved = data;
          purchaseDraftStore.getState().clearDraft(value.scope.businessId, value.input.operationId);
          setState({ status: 'success', data, error: null });
          // Refresh is maintenance, not a second financial operation. A rejected
          // refetch cannot erase a confirmed success or induce a purchase retry.
          void Promise.resolve()
            .then(() => {
              if (current(value))
                return client.invalidateQueries({
                  queryKey: inventoryKeys.byBusiness(value.scope.businessId),
                });
            })
            .catch(() => undefined);
          return data;
        },
        (reason: CompletePurchaseError) => {
          if (!current(value)) throw completePurchaseError('ACCESS_DENIED');
          // Service errors are normalized. Never expose an unexpected throw from
          // the mutation runtime (rather than the service) to a future form.
          const codes: CompletePurchaseError['code'][] = [
            'INVALID_INPUT',
            'ACCESS_DENIED',
            'INVALID_STATUS',
            'CONFLICT',
            'NETWORK_ERROR',
            'UNKNOWN_ERROR',
          ];
          const error = completePurchaseError(
            codes.includes(reason?.code) ? reason.code : 'UNKNOWN_ERROR',
          );
          setState({ status: 'error', data: null, error });
          throw error;
        },
      )
      .finally(() => {
        value.promise = null;
      });
    return value.promise;
  }
  function mutateAsync(input: CompletePurchaseInput) {
    if (scope === null || live.current?.epoch !== epoch) return fail('ACCESS_DENIED');
    const previous = attempt.current;
    if (previous) {
      if (previous.promise) return previous.promise;
      if (previous.input.operationId === input?.operationId) return send(previous);
      // A new intention must have been explicitly started by the caller.
      const draft = purchaseDraftStore.getState();
      if (draft.businessId !== scope.businessId || draft.draft?.operationId !== input?.operationId)
        return fail('INVALID_INPUT');
    }
    const parsed = completePurchaseSchema.safeParse(input);
    if (!parsed.success) return fail('INVALID_INPUT');
    const captured: Attempt = {
      scope,
      epoch: live.current.epoch,
      input: Object.freeze({
        ...parsed.data,
        items: parsed.data.items.map((line) => Object.freeze({ ...line })),
      }),
      promise: null,
      saved: null,
    };
    attempt.current = captured;
    return send(captured);
  }
  function retry() {
    if (scope === null || live.current?.epoch !== epoch) return fail('ACCESS_DENIED');
    const previous = attempt.current;
    if (!previous) return fail('INVALID_INPUT');
    return send(previous);
  }
  function reset() {
    if (live.current?.epoch !== epoch) return;
    if (attempt.current?.promise) return;
    setState(idle);
  }
  // An old closure is never allowed to expose the previous scope's state.
  const visible = scopedState.epoch === epoch ? scopedState.value : idle;
  return { ...visible, mutateAsync, retry, reset };
}
