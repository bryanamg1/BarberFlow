import type { PurchaseDetailData } from '../types/purchaseRead.types';
import type { VoidPurchaseData } from '../types/voidPurchase.types';

// Only a successful, coherently validated mutation may supply this projection.
// Never place its orchestration/audit IDs or raw stock ledger into a read cache.
export function purchaseDetailFromVoid(
  value: VoidPurchaseData,
  previous?: PurchaseDetailData,
): PurchaseDetailData {
  const { id, supplier, total, purchased_at, status, notes } = value.purchase;
  const { amount, expense_date, payment_method } = value.expense;
  return {
    purchase: { id, supplier, total, purchased_at, status, notes },
    items: value.items.map(
      ({ id, product_name_snapshot, quantity, unit_cost_snapshot, line_total }) => ({
        id,
        product_name_snapshot,
        quantity,
        unit_cost_snapshot,
        line_total,
      }),
    ),
    expense: {
      amount,
      expense_date,
      payment_method,
      category_name:
        previous?.purchase.id === id ? (previous.expense?.category_name ?? null) : null,
    },
    voidInfo: {
      status: 'available',
      reason: value.correction.reason,
      created_at: value.correction.created_at,
      stockCompensation: value.items.map((item) => ({
        purchase_item_id: item.id,
        quantity_delta: -item.quantity,
      })),
    },
  };
}
