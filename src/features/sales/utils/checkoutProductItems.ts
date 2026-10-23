import type { ProductRow } from '@/features/products/types/product.types';
import type { ProductStockResult } from '@/features/products/types/productStock.types';
import { createProductSchema } from '@/features/products/schemas/product.schema';
import { selectProductStock } from '@/features/products/utils/productStock';

import {
  checkoutDraftStore,
  checkoutLineInput,
  type CheckoutLine,
  type CheckoutLineEdit,
  type CheckoutScope,
} from '../store/checkoutDraftStore';
import { catalogMoneyDecimal, checkoutLineTotal } from './checkoutMoney';

export function addCheckoutProduct(
  scope: CheckoutScope,
  operationId: string,
  lineId: string,
  product: ProductRow,
): boolean {
  if (
    product.business_id !== scope.businessId ||
    !product.is_active ||
    !createProductSchema.shape.sale_price.safeParse(product.sale_price).success
  )
    return false;
  return checkoutDraftStore
    .getState()
    .addLine(
      scope,
      operationId,
      { lineId, itemType: 'PRODUCT', itemId: product.id, quantity: 1 },
      product.business_id,
    );
}

export const productCatalogDecimal = (price: number) => catalogMoneyDecimal(price);
export const checkoutProductEstimate = (line: CheckoutLine, product: ProductRow) =>
  checkoutLineTotal(
    line.unitPriceOverride ?? productCatalogDecimal(product.sale_price),
    line.quantity,
  );

export function aggregateProductDemand(
  lines: readonly CheckoutLine[],
  edits?: Readonly<Record<string, CheckoutLineEdit>>,
) {
  const demand = new Map<string, bigint | null>();
  for (const line of lines) {
    if (line.itemType !== 'PRODUCT') continue;
    const previous = demand.get(line.itemId);
    demand.set(
      line.itemId,
      previous === null || !checkoutLineInput(line, edits?.[line.lineId]).quantityValid
        ? null
        : (previous ?? 0n) + BigInt(line.quantity),
    );
  }
  return demand;
}
export type CheckoutStock = {
  status: 'loading' | 'error' | 'unavailable' | 'sufficient' | 'insufficient';
  available: string | null;
  demand: string | null;
};
export function checkoutProductStock(
  result: ProductStockResult,
  productId: string,
  demand: bigint | null,
): CheckoutStock {
  const requested = demand?.toString() ?? null;
  const stock = selectProductStock(result, productId);
  if (result.isFetching || stock.status === 'pending')
    return { status: 'loading', available: null, demand: requested };
  if (stock.status === 'error') return { status: 'error', available: null, demand: requested };
  if (stock.status !== 'success' || demand === null)
    return { status: 'unavailable', available: null, demand: requested };
  return {
    status: BigInt(stock.value) >= demand ? 'sufficient' : 'insufficient',
    available: stock.value,
    demand: requested,
  };
}
