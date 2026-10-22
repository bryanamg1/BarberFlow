import { useLayoutEffect } from 'react';

import { checkoutDraftStore } from './checkoutDraftStore';
import { useCheckoutScope } from './useCheckoutScope';

// No UI. Context loss/recovery and any identity change invalidate old captures.
export function CheckoutDraftLifecycle() {
  const scope = useCheckoutScope();
  const userId = scope?.userId;
  const businessId = scope?.businessId;
  const membershipId = scope?.membershipId;
  useLayoutEffect(() => {
    checkoutDraftStore
      .getState()
      .setScope(userId && businessId && membershipId ? { userId, businessId, membershipId } : null);
    return () => checkoutDraftStore.getState().setScope(null);
  }, [userId, businessId, membershipId]);
  return null;
}
