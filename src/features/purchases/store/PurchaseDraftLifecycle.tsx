import { useLayoutEffect } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';

import { purchaseDraftStore } from './purchaseDraftStore';

// Mounted once under Auth/Business providers; this adapter renders no UI.
export function PurchaseDraftLifecycle() {
  const auth = useAuth();
  const business = useBusiness();
  const userId =
    auth.status === 'authenticated' &&
    typeof auth.user.id === 'string' &&
    auth.user.id.trim().length > 0
      ? auth.user.id
      : null;
  const businessId =
    userId !== null &&
    business.status === 'success' &&
    business.data.role === 'OWNER' &&
    typeof business.data.business.id === 'string' &&
    business.data.business.id.trim().length > 0
      ? business.data.business.id
      : null;

  const membershipId = business.status === 'success' ? business.data.membershipId : null;
  const role = business.status === 'success' ? business.data.role : null;
  useLayoutEffect(() => {
    purchaseDraftStore.getState().setBusiness(businessId);
    // Cleanup runs before establishing a different user/business context and
    // on unmount. Token refresh with unchanged identity does not clear the draft.
    return () => purchaseDraftStore.getState().setBusiness(null);
  }, [userId, businessId, membershipId, role]);

  return null;
}
