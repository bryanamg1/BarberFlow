import { uuid } from 'expo-modules-core';
import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { productsKeys } from '@/features/products/constants/productsKeys';
import { expensesKeys } from '@/features/expenses/constants/expensesKeys';
import { purchasesKeys } from '../constants/purchasesKeys';
import { useCompletePurchase } from './useCompletePurchase';
import { purchaseDraftStore, type PurchaseDraft } from '../store/purchaseDraftStore';
import type { PurchaseScope } from '../types/purchaseRead.types';
import type { CompletePurchaseInput } from '../schemas/purchase.schema';
import type {
  CompletePurchaseData,
  CompletePurchaseErrorCode,
} from '../types/completePurchase.types';
import { completePurchaseError } from '../services/completePurchaseErrors';
import { frozenPurchaseInput } from '../utils/purchaseFormValues';

type Attempt = {
  scope: string;
  input: CompletePurchaseInput;
  phase: 'pending' | 'uncertain' | 'error' | 'success';
  code: CompletePurchaseErrorCode | null;
};
// Only submitted-intention metadata, not a second draft/catalog store. Existing
// draft objects own lifetime/identity; weak keys disappear on cancel/context reset.
const submitted = new WeakMap<PurchaseDraft, Attempt>();
export function usePurchaseFormSubmission(
  scope: PurchaseScope,
  onSaved: (data: CompletePurchaseData) => void,
) {
  const key = JSON.stringify(scope),
    mutation = useCompletePurchase(),
    client = useQueryClient();
  const initialDraft = purchaseDraftStore.getState().draft;
  const initial = initialDraft ? submitted.get(initialDraft) : undefined;
  const record = useRef<Attempt | null>(initial?.scope === key ? initial : null);
  const [visible, setVisible] = useState<Attempt | null>(() =>
    initial?.scope === key ? { ...initial } : null,
  );
  const live = useRef(false),
    flight = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (record.current?.phase === 'pending') record.current.phase = 'uncertain';
    };
  }, []);
  const phase = visible?.phase ?? 'idle';
  async function perform(a: Attempt) {
    if (!live.current || flight.current) return;
    flight.current = true;
    a.phase = 'pending';
    setVisible({ ...a });
    try {
      const data = await mutation.mutateAsync(a.input);
      if (!live.current) return;
      a.phase = 'success';
      setVisible({ ...a });
      // BF216 already refreshes inventory. Only the additional existing affected
      // prefixes are refreshed here; maintenance never becomes a financial retry.
      void Promise.allSettled(
        [
          purchasesKeys.byBusiness(scope.businessId),
          productsKeys.byBusiness(scope.businessId),
          expensesKeys.byBusiness(scope.businessId),
        ].map((queryKey) =>
          Promise.resolve().then(() => {
            if (live.current) return client.invalidateQueries({ queryKey });
          }),
        ),
      );
      onSaved(data);
    } catch (reason) {
      if (!live.current) return;
      const code = (reason as { code?: CompletePurchaseErrorCode })?.code;
      const safe = completePurchaseError(
        code &&
          [
            'INVALID_INPUT',
            'ACCESS_DENIED',
            'INVALID_STATUS',
            'CONFLICT',
            'NETWORK_ERROR',
            'UNKNOWN_ERROR',
          ].includes(code)
          ? code
          : 'UNKNOWN_ERROR',
      );
      a.code = safe.code;
      a.phase = ['NETWORK_ERROR', 'UNKNOWN_ERROR', 'CONFLICT'].includes(safe.code)
        ? 'uncertain'
        : 'error';
      setVisible({ ...a });
    } finally {
      flight.current = false;
    }
  }
  return {
    phase,
    error: visible?.code ? completePurchaseError(visible.code) : null,
    submit: async (input: CompletePurchaseInput) => {
      if (!live.current || flight.current || phase !== 'idle') return;
      const state = purchaseDraftStore.getState();
      if (state.businessId !== scope.businessId || state.draft?.operationId !== input.operationId)
        return;
      const a: Attempt = {
        scope: key,
        input: frozenPurchaseInput(input),
        phase: 'pending',
        code: null,
      };
      record.current = a;
      submitted.set(state.draft, a);
      await perform(a);
    },
    retry: async () => {
      if (live.current && !flight.current && phase === 'uncertain' && record.current)
        await perform(record.current);
    },
    editRejected: () => {
      if (!live.current || flight.current || phase !== 'error' || !record.current) return;
      const { operationId, ...input } = record.current.input,
        state = purchaseDraftStore.getState();
      if (!state.clearDraft(scope.businessId, operationId)) return;
      const next = uuid.v4();
      state.startDraft(scope.businessId, next);
      state.patchDraft(scope.businessId, next, input);
      record.current = null;
      setVisible(null);
      mutation.reset();
    },
  };
}
