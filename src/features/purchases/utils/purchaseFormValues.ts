import { completePurchaseSchema, type CompletePurchaseInput } from '../schemas/purchase.schema';
import type { PurchaseDraft } from '../store/purchaseDraftStore';

export function purchaseQuantityText(text: string): number {
  // Invalid/empty editing remains invalid in the in-memory draft, never zero/default1.
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}
export function purchaseEstimate(items: PurchaseDraft['items']): string | null {
  if (!items.length) return null;
  let total = 0n;
  for (const item of items) {
    if (!completePurchaseSchema.shape.items.element.safeParse(item).success) return null;
    total += BigInt(item.unitCost.replace('.', '')) * BigInt(item.quantity);
    if (total > 999_999_999_999n) return null;
  }
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}
export function frozenPurchaseInput(input: CompletePurchaseInput): CompletePurchaseInput {
  const captured = { ...input, items: input.items.map((line) => Object.freeze({ ...line })) };
  Object.freeze(captured.items);
  return Object.freeze(captured);
}
