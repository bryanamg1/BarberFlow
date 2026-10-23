import { useQueries } from '@tanstack/react-query';
import { useStore } from 'zustand';

import { productsKeys } from '@/features/products/constants/productsKeys';
import { useProductStock } from '@/features/products/hooks/useProductStock';
import { productsService } from '@/features/products/services/productsService';

import {
  checkoutDraftStore,
  sameCheckoutScope,
  checkoutLineInput,
} from '../store/checkoutDraftStore';
import { useCheckoutScope } from '../store/useCheckoutScope';
import {
  aggregateProductDemand,
  checkoutProductEstimate,
  checkoutProductStock,
} from '../utils/checkoutProductItems';

export function useCheckoutProductItems() {
  const scope = useCheckoutScope();
  const state = useStore(checkoutDraftStore);
  const draft = scope && sameCheckoutScope(scope, state.scope) ? state.draft : null;
  const lines = draft?.items.filter((line) => line.itemType === 'PRODUCT') ?? [];
  const ids = [...new Set(lines.map((line) => line.itemId))];
  const stock = useProductStock(ids);
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: productsKeys.detail(scope, id),
      queryFn: async () => {
        const result = await productsService.getById(scope!.businessId, id);
        if (result.error) throw result.error;
        return result.data;
      },
      retry: false,
    })),
  });
  const demands = aggregateProductDemand(lines, state.lineEdits);
  const rows = lines.map((line) => {
    const query = queries[ids.indexOf(line.itemId)];
    const data = query.data;
    const product =
      data && data.business_id === scope?.businessId && data.id === line.itemId ? data : null;
    const status: 'error' | 'loading' | 'ready' | 'unavailable' = query.isError
      ? 'error'
      : query.isPending || query.isFetching
        ? 'loading'
        : product?.is_active
          ? 'ready'
          : 'unavailable';
    const input = checkoutLineInput(line, state.lineEdits[line.lineId]);
    const estimate =
      status === 'ready' && product && input.quantityValid && input.overrideValid
        ? checkoutProductEstimate(line, product)
        : null;
    const availability = checkoutProductStock(stock, line.itemId, demands.get(line.itemId) ?? null);
    return {
      line,
      product,
      status,
      ...input,
      estimate,
      stock: availability,
      eligible:
        status === 'ready' &&
        estimate !== null &&
        availability.status === 'sufficient' &&
        input.quantityValid &&
        input.overrideValid,
      retry: () => query.refetch(),
    };
  });
  return {
    scope,
    draft,
    rows,
    locked: state.submission !== null,
    stock,
    eligible:
      draft !== null &&
      rows.length > 0 &&
      rows.every((row) => row.eligible) &&
      state.submission === null,
    editLine: (lineId: string, field: 'quantity' | 'override', text: string) => {
      if (scope && draft && lines.some((line) => line.lineId === lineId))
        state.editLineText(scope, draft.operationId, lineId, field, text);
    },
    clearOverride: (lineId: string) => {
      if (scope && draft && lines.some((line) => line.lineId === lineId))
        state.updateLine(scope, draft.operationId, lineId, { unitPriceOverride: null });
    },
  };
}
