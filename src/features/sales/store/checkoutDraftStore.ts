import { createStore } from 'zustand/vanilla';

export type CheckoutScope = Readonly<{
  userId: string;
  businessId: string;
  membershipId: string;
}>;
export type CheckoutPaymentMethod =
  'CASH' | 'BANK_TRANSFER' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'DIGITAL_WALLET';
export type CheckoutLine = Readonly<{
  lineId: string;
  itemType: 'SERVICE' | 'PRODUCT';
  itemId: string;
  quantity: number;
  unitPriceOverride?: string;
}>;
export type CheckoutDraft = Readonly<{
  operationId: string;
  appointmentId: string | null;
  clientId: string | null;
  items: readonly CheckoutLine[];
  discountAmount: string;
  paymentMethod?: CheckoutPaymentMethod;
}>;
export type CheckoutDraftPatch = Partial<Pick<CheckoutDraft, 'discountAmount' | 'paymentMethod'>>;
export type CheckoutCapture = Readonly<{
  scope: CheckoutScope;
  input: Readonly<
    Omit<CheckoutDraft, 'items'> & {
      items: readonly Readonly<Omit<CheckoutLine, 'lineId'>>[];
    }
  >;
}>;
type Submission = Readonly<{
  status: 'pending' | 'uncertain' | 'rejected';
  capture: CheckoutCapture;
}>;

export const usableCheckoutId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
export const validCheckoutQuantity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647;
export const validCheckoutMoney = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d+\.\d{2}$/.test(value) &&
  BigInt(value.replace('.', '')) <= 999_999_999_999n;
const validMethod = (value: unknown): value is CheckoutPaymentMethod =>
  typeof value === 'string' &&
  ['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'DIGITAL_WALLET'].includes(value);
export const sameCheckoutScope = (a: CheckoutScope | null, b: CheckoutScope | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.userId === b.userId &&
    a.businessId === b.businessId &&
    a.membershipId === b.membershipId);
const validScope = (scope: CheckoutScope | null): scope is CheckoutScope =>
  scope !== null &&
  usableCheckoutId(scope.userId) &&
  usableCheckoutId(scope.businessId) &&
  usableCheckoutId(scope.membershipId);
const freezeDraft = (draft: CheckoutDraft): CheckoutDraft =>
  Object.freeze({
    ...draft,
    items: Object.freeze(draft.items.map((line) => Object.freeze({ ...line }))),
  });
const copyLine = ({
  lineId,
  itemType,
  itemId,
  quantity,
  unitPriceOverride,
}: CheckoutLine): CheckoutLine => ({
  lineId,
  itemType,
  itemId,
  quantity,
  ...(unitPriceOverride !== undefined ? { unitPriceOverride } : {}),
});
const validLine = (line: CheckoutLine) =>
  usableCheckoutId(line.lineId) &&
  usableCheckoutId(line.itemId) &&
  ['SERVICE', 'PRODUCT'].includes(line.itemType) &&
  validCheckoutQuantity(line.quantity) &&
  (line.unitPriceOverride === undefined || validCheckoutMoney(line.unitPriceOverride));

type CheckoutDraftState = {
  scope: CheckoutScope | null;
  draft: CheckoutDraft | null;
  submission: Submission | null;
  setScope: (scope: CheckoutScope | null) => void;
  startDraft: (
    scope: CheckoutScope,
    operationId: string,
    refs?: { appointmentId?: string | null; clientId?: string | null },
  ) => boolean;
  patchDraft: (scope: CheckoutScope, operationId: string, patch: CheckoutDraftPatch) => boolean;
  clearDraft: (scope: CheckoutScope, operationId: string) => boolean;
  addLine: (
    scope: CheckoutScope,
    operationId: string,
    line: CheckoutLine,
    catalogBusinessId: string,
  ) => boolean;
  updateLine: (
    scope: CheckoutScope,
    operationId: string,
    lineId: string,
    patch: { quantity?: number; unitPriceOverride?: string | null },
  ) => boolean;
  removeLine: (scope: CheckoutScope, operationId: string, lineId: string) => boolean;
  captureIntent: (scope: CheckoutScope, operationId: string) => CheckoutCapture | null;
  retryCapture: (capture: CheckoutCapture) => boolean;
  settleCapture: (
    capture: CheckoutCapture,
    outcome: 'success' | 'uncertain' | 'rejected',
  ) => boolean;
};

// References and intent only. No SDK, persistence, UUID generator or financial totals.
export const checkoutDraftStore = createStore<CheckoutDraftState>()((set, get) => {
  const matches = (scope: CheckoutScope, operationId: string) =>
    sameCheckoutScope(get().scope, scope) && get().draft?.operationId === operationId;
  const editable = (scope: CheckoutScope, operationId: string) =>
    matches(scope, operationId) && get().submission === null;
  const replace = (draft: CheckoutDraft) => set({ draft: freezeDraft(draft) });
  return {
    scope: null,
    draft: null,
    submission: null,
    setScope(scope) {
      const next = validScope(scope) ? Object.freeze({ ...scope }) : null;
      if (!sameCheckoutScope(get().scope, next))
        set({ scope: next, draft: null, submission: null });
    },
    startDraft(scope, operationId, refs = {}) {
      if (
        !validScope(scope) ||
        !sameCheckoutScope(get().scope, scope) ||
        get().draft !== null ||
        !usableCheckoutId(operationId) ||
        (refs.appointmentId != null && !usableCheckoutId(refs.appointmentId)) ||
        (refs.clientId != null && !usableCheckoutId(refs.clientId))
      )
        return false;
      replace({
        operationId,
        appointmentId: refs.appointmentId ?? null,
        clientId: refs.clientId ?? null,
        items: [],
        discountAmount: '0.00',
      });
      return true;
    },
    patchDraft(scope, operationId, patch) {
      if (!editable(scope, operationId) || !get().draft) return false;
      if (
        (patch.discountAmount !== undefined && typeof patch.discountAmount !== 'string') ||
        (patch.paymentMethod !== undefined && !validMethod(patch.paymentMethod))
      )
        return false;
      replace({
        ...get().draft!,
        ...(patch.discountAmount !== undefined ? { discountAmount: patch.discountAmount } : {}),
        ...(patch.paymentMethod !== undefined ? { paymentMethod: patch.paymentMethod } : {}),
      });
      return true;
    },
    clearDraft(scope, operationId) {
      if (
        !matches(scope, operationId) ||
        (get().submission !== null && get().submission?.status !== 'rejected')
      )
        return false;
      set({ draft: null, submission: null });
      return true;
    },
    addLine(scope, operationId, line, catalogBusinessId) {
      if (
        !editable(scope, operationId) ||
        catalogBusinessId !== scope.businessId ||
        !validLine(line) ||
        get().draft!.items.some((item) => item.lineId === line.lineId)
      )
        return false;
      replace({ ...get().draft!, items: [...get().draft!.items, copyLine(line)] });
      return true;
    },
    updateLine(scope, operationId, lineId, patch) {
      if (!editable(scope, operationId)) return false;
      const draft = get().draft!;
      const line = draft.items.find((item) => item.lineId === lineId);
      if (
        !line ||
        (patch.quantity !== undefined && !validCheckoutQuantity(patch.quantity)) ||
        (patch.unitPriceOverride !== undefined &&
          patch.unitPriceOverride !== null &&
          !validCheckoutMoney(patch.unitPriceOverride))
      )
        return false;
      const { unitPriceOverride: oldOverride, ...base } = line;
      const override =
        patch.unitPriceOverride === null ? undefined : (patch.unitPriceOverride ?? oldOverride);
      const next = {
        ...base,
        quantity: patch.quantity ?? line.quantity,
        ...(override !== undefined ? { unitPriceOverride: override } : {}),
      };
      replace({
        ...draft,
        items: draft.items.map((item) => (item.lineId === lineId ? next : item)),
      });
      return true;
    },
    removeLine(scope, operationId, lineId) {
      if (
        !editable(scope, operationId) ||
        !get().draft!.items.some((item) => item.lineId === lineId)
      )
        return false;
      replace({
        ...get().draft!,
        items: get().draft!.items.filter((item) => item.lineId !== lineId),
      });
      return true;
    },
    captureIntent(scope, operationId) {
      if (!editable(scope, operationId)) return null;
      const draft = get().draft!;
      if (
        !draft.items.length ||
        !validCheckoutMoney(draft.discountAmount) ||
        !validMethod(draft.paymentMethod)
      )
        return null;
      // Representation for BF196; this does not validate catalog, total, permissions or submit.
      const capture: CheckoutCapture = Object.freeze({
        scope: Object.freeze({ ...scope }),
        input: Object.freeze({
          ...draft,
          items: Object.freeze(
            draft.items.map(({ itemType, itemId, quantity, unitPriceOverride }) =>
              Object.freeze({
                itemType,
                itemId,
                quantity,
                ...(unitPriceOverride !== undefined ? { unitPriceOverride } : {}),
              }),
            ),
          ),
        }),
      });
      set({ submission: Object.freeze({ status: 'pending', capture }) });
      return capture;
    },
    retryCapture(capture) {
      if (get().submission?.capture !== capture || get().submission?.status !== 'uncertain')
        return false;
      set({ submission: Object.freeze({ status: 'pending', capture }) });
      return true;
    },
    settleCapture(capture, outcome) {
      if (
        get().submission?.capture !== capture ||
        get().submission?.status !== 'pending' ||
        !matches(capture.scope, capture.input.operationId)
      )
        return false;
      if (outcome === 'success') set({ draft: null, submission: null });
      else set({ submission: Object.freeze({ status: outcome, capture }) });
      return true;
    },
  };
});
