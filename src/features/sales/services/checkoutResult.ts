import { z } from 'zod';

import {
  checkoutPaymentMethods,
  usableCheckoutId,
  validCheckoutMoney,
} from '../store/checkoutDraftStore';
import type { CompleteCheckoutData } from '../types/checkout.types';

const usable = z.string().refine(usableCheckoutId);
const id = z.string().regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i);
const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)));
const money = z.number().finite().nonnegative().max(9_999_999_999.99);
export const checkoutInputSchema = z.object({
  operationId: usable,
  appointmentId: usable.nullable(),
  clientId: usable.nullable(),
  discountAmount: z.string().refine(validCheckoutMoney),
  paymentMethod: z.enum(checkoutPaymentMethods),
  items: z
    .array(
      z.object({
        itemType: z.enum(['SERVICE', 'PRODUCT']),
        itemId: usable,
        quantity: z.number().int().min(1).max(2_147_483_647),
        unitPriceOverride: z.string().refine(validCheckoutMoney).optional(),
      }),
    )
    .min(1),
});
export const saleRowSchema = z.strictObject({
  id,
  business_id: id,
  client_id: id.nullable(),
  appointment_id: id.nullable(),
  operation_id: id,
  status: z.enum(['DRAFT', 'COMPLETED', 'VOIDED']),
  subtotal: money,
  discount: money,
  total: money,
  sold_at: instant.nullable(),
  created_by: id,
  created_at: instant,
  updated_at: instant,
});
export const saleItemSchema = z.strictObject({
  id,
  sale_id: id,
  item_type: z.enum(['SERVICE', 'PRODUCT']),
  service_id: id.nullable(),
  product_id: id.nullable(),
  item_name_snapshot: z.string(),
  unit_price_snapshot: money,
  quantity: z.number().int().positive().max(2_147_483_647),
  line_total: money,
  unit_cost_snapshot: money.nullable(),
  created_at: instant,
});
export const salePaymentSchema = z.strictObject({
  id,
  business_id: id,
  sale_id: id,
  payment_method: z.string(),
  amount: money,
  notes: z.string().nullable(),
  paid_at: instant,
  created_by: id,
  created_at: instant,
});
export const checkoutResultSchema = z.strictObject({
  sale: saleRowSchema,
  items: z.array(saleItemSchema).min(1),
  payments: z.array(salePaymentSchema),
});
export const sameSaleId = (a: string, b: string) =>
  a.trim().replace(/[{}-]/g, '').toLowerCase() === b.trim().replace(/[{}-]/g, '').toLowerCase();
export function coherentCheckoutResult(
  value: unknown,
  businessId: string,
  operationId: string,
): value is CompleteCheckoutData {
  const parsed = checkoutResultSchema.safeParse(value);
  if (!parsed.success) return false;
  const { sale, items, payments } = parsed.data;
  return (
    sameSaleId(sale.business_id, businessId) &&
    sameSaleId(sale.operation_id, operationId) &&
    sale.status !== 'DRAFT' &&
    sale.sold_at !== null &&
    new Set(items.map((i) => i.id)).size === items.length &&
    items.every((i) => i.sale_id === sale.id) &&
    new Set(payments.map((p) => p.id)).size === payments.length &&
    payments.every((p) => p.sale_id === sale.id && p.business_id === sale.business_id) &&
    (sale.total === 0
      ? payments.length === 0
      : payments.length === 1 && payments[0].amount === sale.total)
  );
}
