import type { ProductStockResult } from '@/features/products/types/productStock.types';

import {
  validCheckoutMoney,
  validCheckoutQuantity,
  type CheckoutDraft,
  type CheckoutLineEdit,
} from '../store/checkoutDraftStore';
import { checkoutCents, checkoutDecimal, checkoutLineTotal } from './checkoutMoney';
import {
  aggregateProductDemand,
  checkoutProductStock,
  type CheckoutStock,
} from './checkoutProductItems';

export type CheckoutCatalogStatus = 'ready' | 'loading' | 'error' | 'unavailable';
export type CheckoutSummaryRead = {
  lineId: string;
  itemId: string;
  itemType: 'SERVICE' | 'PRODUCT';
  name: string | null;
  status: CheckoutCatalogStatus;
  catalogPrice: string | null;
  inputValid: boolean;
};
export type CheckoutSummaryStatus =
  'idle' | 'empty' | 'loading' | 'error' | 'unavailable' | 'invalid' | 'blocked' | 'ready';

// Derived estimates only. Reads must match the exact local line/reference; no missing-as-zero.
export function deriveCheckoutSummary(
  draft: CheckoutDraft | null,
  reads: readonly CheckoutSummaryRead[],
  stock?: ProductStockResult,
  locked = false,
  edits?: Readonly<Record<string, CheckoutLineEdit>>,
) {
  const demands = aggregateProductDemand(draft?.items ?? [], edits);
  const lines = (draft?.items ?? []).map((line) => {
    const matches = reads.filter(
      (read) =>
        read.lineId === line.lineId &&
        read.itemId === line.itemId &&
        read.itemType === line.itemType,
    );
    const read = matches.length === 1 ? matches[0] : null;
    const catalogStatus = read?.status ?? 'unavailable';
    const inputValid = read?.inputValid === true && validCheckoutQuantity(line.quantity);
    const unitPrice =
      catalogStatus === 'ready' && inputValid
        ? (line.unitPriceOverride ?? read?.catalogPrice ?? null)
        : null;
    const lineTotal = checkoutLineTotal(unitPrice, line.quantity);
    const availability: CheckoutStock | null =
      line.itemType === 'PRODUCT'
        ? stock
          ? checkoutProductStock(stock, line.itemId, demands.get(line.itemId) ?? null)
          : {
              status: 'unavailable',
              available: null,
              demand: demands.get(line.itemId)?.toString() ?? null,
            }
        : null;
    return {
      ...line,
      name: read?.name ?? null,
      catalogStatus,
      inputValid,
      unitPrice,
      lineTotal,
      stock: availability,
      eligible:
        catalogStatus === 'ready' &&
        inputValid &&
        lineTotal !== null &&
        (availability === null || availability.status === 'sufficient'),
    };
  });
  let subtotal: string | null = null;
  if (draft && lines.every((line) => line.lineTotal !== null)) {
    const cents = lines.reduce((sum, line) => sum + checkoutCents(line.lineTotal!), 0n);
    if (cents <= 999_999_999_999n) subtotal = checkoutDecimal(cents);
  }
  const discountAmount = draft?.discountAmount ?? null;
  const discountFormatValid = validCheckoutMoney(discountAmount);
  const discountExceedsSubtotal =
    discountFormatValid &&
    subtotal !== null &&
    checkoutCents(discountAmount) > checkoutCents(subtotal);
  const discountValid = discountFormatValid && !discountExceedsSubtotal;
  const total =
    subtotal !== null && discountValid
      ? checkoutDecimal(checkoutCents(subtotal) - checkoutCents(discountAmount))
      : null;
  let status: CheckoutSummaryStatus;
  if (!draft) status = 'idle';
  else if (!lines.length) status = 'empty';
  else if (lines.some((line) => line.catalogStatus === 'error' || line.stock?.status === 'error'))
    status = 'error';
  else if (
    lines.some((line) => line.catalogStatus === 'loading' || line.stock?.status === 'loading')
  )
    status = 'loading';
  else if (
    lines.some(
      (line) => line.catalogStatus === 'unavailable' || line.stock?.status === 'unavailable',
    )
  )
    status = 'unavailable';
  else if (lines.some((line) => !line.eligible) || total === null) status = 'invalid';
  else status = locked ? 'blocked' : 'ready';
  return {
    status,
    lines,
    subtotal,
    discountAmount,
    discountValid,
    discountExceedsSubtotal,
    total,
    eligible: status === 'ready',
  };
}
