import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import { createServiceSchema } from '@/features/services/schemas/service.schema';

import {
  checkoutDraftStore,
  type CheckoutLine,
  type CheckoutScope,
} from '../store/checkoutDraftStore';
import { catalogMoneyDecimal, checkoutLineTotal } from './checkoutMoney';

export function addCheckoutService(
  scope: CheckoutScope,
  operationId: string,
  lineId: string,
  service: ServiceRow,
): boolean {
  if (
    service.business_id !== scope.businessId ||
    !service.is_active ||
    !createServiceSchema.shape.price.safeParse(service.price).success
  )
    return false;
  return checkoutDraftStore
    .getState()
    .addLine(
      scope,
      operationId,
      { lineId, itemType: 'SERVICE', itemId: service.id, quantity: 1 },
      service.business_id,
    );
}

export function serviceCatalogDecimal(price: number): string | null {
  if (!createServiceSchema.shape.price.safeParse(price).success) return null;
  return catalogMoneyDecimal(price);
}

// Informational exact cents only, never a persisted snapshot or authoritative total.
export function checkoutServiceEstimate(line: CheckoutLine, service: ServiceRow): string | null {
  const unit = line.unitPriceOverride ?? serviceCatalogDecimal(service.price);
  return checkoutLineTotal(unit, line.quantity);
}
