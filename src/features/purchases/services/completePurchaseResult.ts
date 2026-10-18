import { z } from 'zod';

import type { CompletePurchaseData } from '../types/completePurchase.types';

const id = z.string().regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i);
const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)));
const money = z.number().finite().nonnegative().max(9_999_999_999.99);
const nullableText = z.string().nullable();
const purchase = z.strictObject({
  id,
  business_id: id,
  operation_id: id,
  supplier: z.string(),
  status: z.enum(['COMPLETED', 'VOIDED']),
  total: money,
  purchased_at: instant,
  notes: nullableText,
  created_by: id,
  created_at: instant,
  updated_at: instant,
});
const item = z.strictObject({
  id,
  purchase_id: id,
  product_id: id,
  product_name_snapshot: z.string(),
  quantity: z.number().int().positive().max(2_147_483_647),
  unit_cost_snapshot: money,
  line_total: money,
  created_at: instant,
});
const expense = z.strictObject({
  id,
  business_id: id,
  category_id: id,
  source_type: z.literal('PURCHASE'),
  purchase_id: id,
  description: z.string(),
  amount: money,
  payment_method: z.string(),
  expense_date: z.iso.date().refine((value) => !value.startsWith('0000')),
  receipt_path: z.null(),
  notes: nullableText,
  created_by: id,
  created_at: instant,
  updated_at: instant,
});
const result = z.strictObject({ purchase, items: z.array(item).min(1), expense });
// UUID spelling accepted by PostgreSQL can differ from its canonical output.
// Compare identities only; never rewrite a persisted string or retry payload.
const identity = (value: string) => value.trim().replace(/[{}-]/g, '').toLowerCase();
export function coherentPurchaseResult(
  value: unknown,
  businessId: string,
  operationId: string,
): value is CompletePurchaseData {
  const parsed = result.safeParse(value);
  if (!parsed.success) return false;
  const { purchase, items, expense } = parsed.data;
  return (
    identity(purchase.business_id) === identity(businessId) &&
    identity(purchase.operation_id) === identity(operationId) &&
    items.every((line) => line.purchase_id === purchase.id) &&
    new Set(items.map((line) => line.id)).size === items.length &&
    expense.business_id === purchase.business_id &&
    expense.purchase_id === purchase.id &&
    expense.created_by === purchase.created_by &&
    expense.amount === purchase.total &&
    expense.notes === purchase.notes
  );
}
