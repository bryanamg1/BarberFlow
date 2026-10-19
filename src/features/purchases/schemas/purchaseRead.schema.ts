import { z } from 'zod';

import { voidPurchaseIdSchema as id } from './voidPurchase.schema';

const money = z.number().finite().nonnegative().max(9_999_999_999.99);
const instant = z.iso.datetime({ offset: true }).refine((v) => Number.isFinite(Date.parse(v)));
export const purchaseHistorySchema = z.strictObject({
  id,
  supplier: z.string(),
  total: money,
  purchased_at: instant.nullable(),
  status: z.enum(['DRAFT', 'COMPLETED', 'VOIDED']),
});
export const purchaseDetailSchema = z
  .strictObject({
    purchase: purchaseHistorySchema.extend({ notes: z.string().nullable() }),
    items: z.array(
      z.strictObject({
        id,
        product_name_snapshot: z.string(),
        quantity: z.number().int().positive(),
        unit_cost_snapshot: money,
        line_total: money,
      }),
    ),
    expense: z
      .strictObject({
        amount: money,
        expense_date: z.iso.date(),
        payment_method: z.string(),
        category_name: z.string().nullable(),
      })
      .nullable(),
    voidInfo: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('not_applicable') }),
      z.strictObject({ status: z.literal('unavailable') }),
      z.strictObject({
        status: z.literal('available'),
        reason: z.string(),
        created_at: instant,
        stockCompensation: z
          .array(
            z.strictObject({ purchase_item_id: id, quantity_delta: z.number().int().negative() }),
          )
          .min(1),
      }),
    ]),
  })
  .superRefine((value, context) => {
    const unique = new Set(value.items.map((i) => i.id.toLowerCase()));
    const info = value.voidInfo;
    if (
      unique.size !== value.items.length ||
      (value.purchase.status === 'VOIDED') === (info.status === 'not_applicable') ||
      (info.status === 'available' &&
        (info.stockCompensation.length !== value.items.length ||
          !info.stockCompensation.every(
            (line, n) =>
              line.purchase_item_id.toLowerCase() === value.items[n].id.toLowerCase() &&
              line.quantity_delta === -value.items[n].quantity,
          )))
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid historical projection' });
    }
  });
