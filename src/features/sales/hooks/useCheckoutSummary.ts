import { useStore } from 'zustand';

import { useCheckoutProductItems } from './useCheckoutProductItems';
import { useCheckoutServiceItems } from './useCheckoutServiceItems';
import { deriveCheckoutSummary, type CheckoutSummaryRead } from '../utils/checkoutSummary';
import { productCatalogDecimal } from '../utils/checkoutProductItems';
import { serviceCatalogDecimal } from '../utils/checkoutServiceItems';
import { checkoutDraftStore } from '../store/checkoutDraftStore';

export function useCheckoutSummary() {
  const services = useCheckoutServiceItems();
  const products = useCheckoutProductItems();
  const edits = useStore(checkoutDraftStore, (state) => state.lineEdits);
  const reads: CheckoutSummaryRead[] = [
    ...services.rows.map((row) => ({
      lineId: row.line.lineId,
      itemId: row.line.itemId,
      itemType: row.line.itemType,
      name: row.service?.name ?? null,
      status: row.status,
      catalogPrice: row.service ? serviceCatalogDecimal(row.service.price) : null,
      inputValid: row.quantityValid && row.overrideValid,
    })),
    ...products.rows.map((row) => ({
      lineId: row.line.lineId,
      itemId: row.line.itemId,
      itemType: row.line.itemType,
      name: row.product?.name ?? null,
      status: row.status,
      catalogPrice: row.product ? productCatalogDecimal(row.product.sale_price) : null,
      inputValid: row.quantityValid && row.overrideValid,
    })),
  ];
  return {
    scope: services.scope,
    draft: services.draft,
    ...deriveCheckoutSummary(
      services.draft,
      reads,
      products.stock,
      services.locked || products.locked,
      edits,
    ),
  };
}
