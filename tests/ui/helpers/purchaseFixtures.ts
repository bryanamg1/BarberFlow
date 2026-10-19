import type { CompletePurchaseData } from '@/features/purchases/types/completePurchase.types';
import type { CompletePurchaseInput } from '@/features/purchases/schemas/purchase.schema';
import type { VoidPurchaseData } from '@/features/purchases/types/voidPurchase.types';
import type { PurchaseDetailData } from '@/features/purchases/types/purchaseRead.types';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const businessId = id(216);
const payload = (): CompletePurchaseInput => ({
  operationId: id(1),
  supplierName: 'Supplier',
  expenseCategoryId: id(2),
  paymentMethod: 'CASH',
  purchasedAt: '2026-01-01T00:00:00Z',
  items: [{ productId: id(3), quantity: 1, unitCost: '1.00' }],
});
const at = '2026-01-01T00:00:00Z';
const saved = (): CompletePurchaseData => ({
  purchase: {
    id: id(4),
    business_id: businessId,
    operation_id: id(1),
    supplier: 'Original',
    status: 'COMPLETED',
    total: 1,
    purchased_at: at,
    notes: null,
    created_by: id(5),
    created_at: at,
    updated_at: at,
  },
  items: [
    {
      id: id(6),
      purchase_id: id(4),
      product_id: id(3),
      product_name_snapshot: 'Original',
      quantity: 1,
      unit_cost_snapshot: 1,
      line_total: 1,
      created_at: at,
    },
  ],
  expense: {
    id: id(7),
    business_id: businessId,
    category_id: id(2),
    source_type: 'PURCHASE',
    purchase_id: id(4),
    description: 'Compra de productos',
    amount: 1,
    payment_method: 'CASH',
    expense_date: '2026-01-01',
    notes: null,
    receipt_path: null,
    created_by: id(5),
    created_at: at,
    updated_at: at,
  },
});

export { id, businessId, at, saved, payload };
export function voidSaved(): VoidPurchaseData {
  const d = saved();
  return {
    ...d,
    purchase: { ...d.purchase, status: 'VOIDED' },
    correction: {
      id: id(90),
      business_id: businessId,
      purchase_id: d.purchase.id,
      operation_id: id(99),
      reason: '  Exact reason  ',
      created_by: id(5),
      created_at: at,
    },
    stockMovements: [
      {
        id: id(91),
        business_id: businessId,
        product_id: id(3),
        type: 'ADJUSTMENT',
        quantity_delta: -1,
        unit_cost: 1,
        reference_type: 'PURCHASE_VOID',
        reference_id: id(90),
        notes: null,
        occurred_at: at,
        created_by: id(5),
        created_at: at,
      },
    ],
  };
}
export function detail(): PurchaseDetailData {
  const d = saved();
  return {
    purchase: {
      id: d.purchase.id,
      supplier: d.purchase.supplier,
      total: 1,
      purchased_at: at,
      status: 'COMPLETED',
      notes: 'Original notes',
    },
    items: [
      {
        id: id(6),
        product_name_snapshot: 'Historical product',
        quantity: 1,
        unit_cost_snapshot: 1,
        line_total: 1,
      },
    ],
    expense: {
      amount: 1,
      expense_date: '2026-01-01',
      payment_method: 'CASH',
      category_name: 'Archived category',
    },
    voidInfo: { status: 'not_applicable' },
  };
}
