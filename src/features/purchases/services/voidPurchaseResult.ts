import { z } from 'zod';

import { voidPurchaseIdSchema as id, type VoidPurchaseInput } from '../schemas/voidPurchase.schema';
import type { VoidPurchaseData } from '../types/voidPurchase.types';
import { purchaseResultSchema } from './completePurchaseResult';

const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)));
const correction = z.strictObject({
  id,
  business_id: id,
  purchase_id: id,
  operation_id: id,
  reason: z.string().refine((value) => /[^ ]/.test(value)),
  created_by: id,
  created_at: instant,
});
const movement = z.strictObject({
  id,
  business_id: id,
  product_id: id,
  type: z.literal('ADJUSTMENT'),
  quantity_delta: z.number().int().min(-2_147_483_647).max(-1),
  unit_cost: z.number().finite().nonnegative().max(9_999_999_999.99),
  reference_type: z.literal('PURCHASE_VOID'),
  reference_id: id,
  notes: z.null(),
  occurred_at: instant,
  created_by: id,
  created_at: instant,
});
const result = purchaseResultSchema.extend({
  purchase: purchaseResultSchema.shape.purchase.extend({
    status: z.literal('VOIDED'),
    purchased_at: instant.nullable(),
  }),
  correction,
  stockMovements: z.array(movement).min(1),
});
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const orderedUnique = (rows: { id: string }[]) =>
  rows.every(
    (row, index) => index === 0 || rows[index - 1].id.toLowerCase() < row.id.toLowerCase(),
  );

export function coherentVoidPurchaseResult(
  value: unknown,
  businessId: string,
  input: VoidPurchaseInput,
): value is VoidPurchaseData {
  const parsed = result.safeParse(value);
  if (!parsed.success) return false;
  const { purchase, items, expense, correction: audit, stockMovements } = parsed.data;
  if (
    !sameId(purchase.business_id, businessId) ||
    !items.every((item) => sameId(item.purchase_id, purchase.id)) ||
    !sameId(expense.purchase_id, purchase.id) ||
    !sameId(expense.business_id, businessId) ||
    !sameId(expense.created_by, purchase.created_by) ||
    expense.amount !== purchase.total ||
    expense.notes !== purchase.notes ||
    !sameId(purchase.id, input.purchaseId) ||
    !sameId(audit.business_id, businessId) ||
    !sameId(audit.purchase_id, purchase.id) ||
    !sameId(audit.operation_id, input.operationId) ||
    audit.reason !== input.reason ||
    !orderedUnique(items) ||
    !orderedUnique(stockMovements) ||
    items.length !== stockMovements.length
  )
    return false;

  // Compare historical row multiplicities; no balance or financial arithmetic.
  const expected = new Map<string, number>();
  for (const item of items) {
    const key = JSON.stringify([
      item.product_id.toLowerCase(),
      -item.quantity,
      item.unit_cost_snapshot,
    ]);
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  for (const row of stockMovements) {
    if (
      !sameId(row.business_id, businessId) ||
      !sameId(row.reference_id, audit.id) ||
      !sameId(row.created_by, audit.created_by) ||
      Date.parse(row.created_at) !== Date.parse(audit.created_at) ||
      Date.parse(row.occurred_at) !== Date.parse(audit.created_at)
    )
      return false;
    const key = JSON.stringify([row.product_id.toLowerCase(), row.quantity_delta, row.unit_cost]);
    const count = expected.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) expected.delete(key);
    else expected.set(key, count - 1);
  }
  return expected.size === 0;
}
