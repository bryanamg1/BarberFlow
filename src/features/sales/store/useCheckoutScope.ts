import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';

import { usableCheckoutId, type CheckoutScope } from './checkoutDraftStore';

export function useCheckoutScope(): CheckoutScope | null {
  const auth = useAuth();
  const business = useBusiness();
  if (auth.status !== 'authenticated' || business.status !== 'success') return null;
  const scope = {
    userId: auth.user.id,
    businessId: business.data.business.id,
    membershipId: business.data.membershipId,
  };
  return Object.values(scope).every(usableCheckoutId) ? scope : null;
}
