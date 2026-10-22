import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { useStore } from 'zustand';

import { servicesKeys } from '@/features/services/constants/servicesKeys';
import { servicesService } from '@/features/services/services/servicesService';

import {
  checkoutDraftStore,
  sameCheckoutScope,
  validCheckoutMoney,
  validCheckoutQuantity,
} from '../store/checkoutDraftStore';
import { useCheckoutScope } from '../store/useCheckoutScope';
import { checkoutServiceEstimate } from '../utils/checkoutServiceItems';

type Edit = { quantity?: string; override?: string };
export function useCheckoutServiceItems() {
  const scope = useCheckoutScope();
  const state = useStore(checkoutDraftStore);
  const draft = sameCheckoutScope(scope, state.scope) && scope !== null ? state.draft : null;
  const identity = JSON.stringify([scope, draft?.operationId]);
  const [edits, setEdits] = useState<{ identity: string; values: Record<string, Edit> }>({
    identity,
    values: {},
  });
  const currentEdits = edits.identity === identity ? edits.values : {};
  const lines = draft?.items.filter((line) => line.itemType === 'SERVICE') ?? [];
  const uniqueIds = [...new Set(lines.map((line) => line.itemId))];
  const queries = useQueries({
    queries: uniqueIds.map((id) => ({
      // Preserve Services invalidation prefix and isolate user/membership reads.
      queryKey: [
        ...servicesKeys.detail(scope!.businessId, id),
        'checkout',
        scope!.userId,
        scope!.membershipId,
      ],
      queryFn: async () => {
        const result = await servicesService.getById(scope!.businessId, id);
        if (result.error) throw result.error;
        return result.data;
      },
      retry: false,
    })),
  });
  const locked = state.submission !== null;
  const rows = lines.map((line) => {
    const query = queries[uniqueIds.indexOf(line.itemId)];
    const data = query?.data;
    const service =
      data && data.business_id === scope?.businessId && data.id === line.itemId ? data : null;
    const status = query.isError
      ? 'error'
      : query.isPending || query.isFetching
        ? 'loading'
        : service?.is_active
          ? 'ready'
          : 'unavailable';
    const edit = currentEdits[line.lineId];
    const quantityText = edit?.quantity ?? String(line.quantity);
    const overrideText = edit?.override ?? line.unitPriceOverride ?? '';
    const quantityValid = /^\d+$/.test(quantityText) && validCheckoutQuantity(Number(quantityText));
    const overrideValid =
      (edit?.override === undefined && line.unitPriceOverride === undefined) ||
      validCheckoutMoney(overrideText);
    const estimate =
      status === 'ready' && service && quantityValid && overrideValid
        ? checkoutServiceEstimate(line, service)
        : null;
    return {
      line,
      service,
      status,
      quantityText,
      overrideText,
      quantityValid,
      overrideValid,
      estimate,
      eligible: status === 'ready' && estimate !== null && quantityValid && overrideValid,
    };
  });
  function editLine(lineId: string, field: 'quantity' | 'override', text: string) {
    if (
      !scope ||
      !draft ||
      locked ||
      checkoutDraftStore.getState().submission !== null ||
      !lines.some((line) => line.lineId === lineId) ||
      !sameCheckoutScope(scope, checkoutDraftStore.getState().scope) ||
      checkoutDraftStore.getState().draft?.operationId !== draft.operationId
    )
      return;
    setEdits((previous) => ({
      identity,
      values: {
        ...(previous.identity === identity ? previous.values : {}),
        [lineId]: {
          ...(previous.identity === identity ? previous.values[lineId] : {}),
          [field]: text,
        },
      },
    }));
    if (field === 'quantity' && /^\d+$/.test(text) && validCheckoutQuantity(Number(text)))
      state.updateLine(scope, draft.operationId, lineId, { quantity: Number(text) });
    if (field === 'override' && validCheckoutMoney(text))
      state.updateLine(scope, draft.operationId, lineId, { unitPriceOverride: text });
  }
  function clearOverride(lineId: string) {
    if (
      !scope ||
      !draft ||
      !state.updateLine(scope, draft.operationId, lineId, { unitPriceOverride: null })
    )
      return;
    setEdits((previous) => {
      const values = previous.identity === identity ? { ...previous.values } : {};
      const { override: _override, ...rest } = values[lineId] ?? {};
      values[lineId] = rest;
      return { identity, values };
    });
  }
  return {
    scope,
    draft,
    rows,
    locked,
    editLine,
    clearOverride,
    // Only SERVICE eligibility. This is not authorization or complete-checkout validation.
    eligible: draft !== null && rows.length > 0 && rows.every((row) => row.eligible) && !locked,
  };
}
