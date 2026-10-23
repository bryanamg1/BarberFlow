import { useQueries } from '@tanstack/react-query';
import { useStore } from 'zustand';

import { servicesKeys } from '@/features/services/constants/servicesKeys';
import { servicesService } from '@/features/services/services/servicesService';

import {
  checkoutDraftStore,
  sameCheckoutScope,
  checkoutLineInput,
} from '../store/checkoutDraftStore';
import { useCheckoutScope } from '../store/useCheckoutScope';
import { checkoutServiceEstimate } from '../utils/checkoutServiceItems';

export function useCheckoutServiceItems() {
  const scope = useCheckoutScope();
  const state = useStore(checkoutDraftStore);
  const draft = sameCheckoutScope(scope, state.scope) && scope !== null ? state.draft : null;
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
    const status: 'error' | 'loading' | 'ready' | 'unavailable' = query.isError
      ? 'error'
      : query.isPending || query.isFetching
        ? 'loading'
        : service?.is_active
          ? 'ready'
          : 'unavailable';
    const { quantityText, overrideText, quantityValid, overrideValid } = checkoutLineInput(
      line,
      state.lineEdits[line.lineId],
    );
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
    if (scope && draft && lines.some((line) => line.lineId === lineId))
      state.editLineText(scope, draft.operationId, lineId, field, text);
  }
  function clearOverride(lineId: string) {
    if (scope && draft && lines.some((line) => line.lineId === lineId))
      state.updateLine(scope, draft.operationId, lineId, { unitPriceOverride: null });
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
