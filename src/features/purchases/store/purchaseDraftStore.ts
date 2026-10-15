import { createStore } from 'zustand/vanilla';

import { completePurchaseSchema, type CompletePurchaseInput } from '../schemas/purchase.schema';

export type PurchaseDraft = Pick<CompletePurchaseInput, 'operationId' | 'items'> &
  Partial<Omit<CompletePurchaseInput, 'operationId' | 'items'>>;
export type PurchaseDraftPatch = Partial<Omit<PurchaseDraft, 'operationId'>>;

type PurchaseDraftState = {
  businessId: string | null;
  draft: PurchaseDraft | null;
  setBusiness: (businessId: string | null) => void;
  startDraft: (businessId: string, operationId: string) => boolean;
  patchDraft: (businessId: string, operationId: string, patch: PurchaseDraftPatch) => boolean;
  clearDraft: (businessId: string, operationId: string) => boolean;
};

// In-memory form state only; no persistence middleware, SDK, clock or UUID source.
export const purchaseDraftStore = createStore<PurchaseDraftState>()((set, get) => ({
  businessId: null,
  draft: null,
  setBusiness(businessId) {
    const next = typeof businessId === 'string' && businessId.trim().length > 0 ? businessId : null;
    if (get().businessId !== next) set({ businessId: next, draft: null });
  },
  startDraft(businessId, operationId) {
    const state = get();
    if (
      state.businessId === null ||
      state.businessId !== businessId ||
      state.draft !== null ||
      !completePurchaseSchema.shape.operationId.safeParse(operationId).success
    ) {
      return false;
    }
    set({ draft: { operationId, items: [] } });
    return true;
  },
  patchDraft(businessId, operationId, patch) {
    const { draft, businessId: currentBusiness } = get();
    if (currentBusiness !== businessId || draft === null || draft.operationId !== operationId) {
      return false;
    }
    // Undefined means no patch. Explicit empty text/null retain their meanings.
    // Copy only the approved keys, including only input keys on every line.
    const allowed: PurchaseDraftPatch = {
      ...(patch.supplierName !== undefined ? { supplierName: patch.supplierName } : {}),
      ...(patch.expenseCategoryId !== undefined
        ? { expenseCategoryId: patch.expenseCategoryId }
        : {}),
      ...(patch.paymentMethod !== undefined ? { paymentMethod: patch.paymentMethod } : {}),
      ...(patch.purchasedAt !== undefined ? { purchasedAt: patch.purchasedAt } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.items !== undefined
        ? {
            items: patch.items.map(({ productId, quantity, unitCost }) => ({
              productId,
              quantity,
              unitCost,
            })),
          }
        : {}),
    };
    if (Object.keys(allowed).length > 0) set({ draft: { ...draft, ...allowed } });
    return true;
  },
  clearDraft(businessId, operationId) {
    const { draft, businessId: currentBusiness } = get();
    if (currentBusiness !== businessId || draft === null || draft.operationId !== operationId) {
      return false;
    }
    set({ draft: null });
    return true;
  },
}));
