import type { ServiceRow } from '@/features/services/repositories/servicesRepository';
import { createServiceSchema } from '@/features/services/schemas/service.schema';

import {
  checkoutDraftStore,
  validCheckoutMoney,
  validCheckoutQuantity,
  type CheckoutLine,
  type CheckoutScope,
} from '../store/checkoutDraftStore';

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
  const [integer, fraction = ''] = price.toString().split('.');
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

// Informational exact cents only, never a persisted snapshot or authoritative total.
export function checkoutServiceEstimate(line: CheckoutLine, service: ServiceRow): string | null {
  const unit = line.unitPriceOverride ?? serviceCatalogDecimal(service.price);
  if (unit === null || !validCheckoutMoney(unit) || !validCheckoutQuantity(line.quantity))
    return null;
  const cents = BigInt(unit.replace('.', '')) * BigInt(line.quantity);
  if (cents > 999_999_999_999n) return null;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}
