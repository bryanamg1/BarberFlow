import { useStore } from 'zustand';

import { useCheckoutSummary } from './useCheckoutSummary';
import {
  checkoutDraftStore,
  checkoutPaymentMethods,
  validCheckoutPaymentMethod,
} from '../store/checkoutDraftStore';
import { deriveCheckoutPayment } from '../utils/checkoutPayment';

export function useCheckoutPayment() {
  const summary = useCheckoutSummary();
  const locked = useStore(checkoutDraftStore, (state) => state.submission !== null);
  const { scope, draft } = summary;
  return {
    scope,
    draft,
    methods: checkoutPaymentMethods,
    locked,
    summaryEligible: summary.eligible,
    ...deriveCheckoutPayment(summary, draft?.paymentMethod, locked),
    select: (method: unknown) =>
      scope && draft && validCheckoutPaymentMethod(method)
        ? checkoutDraftStore
            .getState()
            .patchDraft(scope, draft.operationId, { paymentMethod: method })
        : false,
  };
}
