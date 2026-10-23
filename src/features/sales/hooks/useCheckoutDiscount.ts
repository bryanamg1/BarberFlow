import { useStore } from 'zustand';

import { useCheckoutSummary } from './useCheckoutSummary';
import { checkoutDraftStore, validCheckoutMoney } from '../store/checkoutDraftStore';

export function useCheckoutDiscount() {
  const summary = useCheckoutSummary();
  const locked = useStore(checkoutDraftStore, (state) => state.submission !== null);
  const { scope, draft } = summary;
  // The existing draft retains editing text; invalid text is never a last-valid amount.
  const value = draft?.discountAmount ?? '';
  const canonicalAmount = validCheckoutMoney(value) ? value : null;
  const error = !draft
    ? undefined
    : canonicalAmount === null
      ? 'Ingresa un importe no negativo con dos decimales dentro del límite permitido.'
      : summary.discountExceedsSubtotal
        ? 'El descuento supera el subtotal. Corrígelo explícitamente.'
        : undefined;
  return {
    scope,
    draft,
    value,
    canonicalAmount,
    error,
    subtotal: summary.subtotal,
    total: summary.total,
    locked,
    eligible: summary.eligible && !locked,
    change: (text: string) =>
      scope && draft
        ? checkoutDraftStore
            .getState()
            .patchDraft(scope, draft.operationId, { discountAmount: text })
        : false,
  };
}
