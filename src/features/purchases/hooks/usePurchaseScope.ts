import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';

import type { PurchaseScope } from '../types/purchaseRead.types';

export function usePurchaseScope(): PurchaseScope | null {
  const auth = useAuth();
  const business = useBusiness();
  return auth.status === 'authenticated' &&
    business.status === 'success' &&
    business.data.role === 'OWNER'
    ? {
        businessId: business.data.business.id,
        userId: auth.user.id,
        membershipId: business.data.membershipId,
      }
    : null;
}
