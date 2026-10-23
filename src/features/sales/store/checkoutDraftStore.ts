import { createStore } from 'zustand/vanilla';

export type CheckoutScope = Readonly<{
  userId: string;
  businessId: string;
  membershipId: string;
}>;
export const checkoutPaymentMethods = Object.freeze([
  'CASH',
  'BANK_TRANSFER',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'DIGITAL_WALLET',
] as const);
export type CheckoutPaymentMethod = (typeof checkoutPaymentMethods)[number];
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
export type CheckoutLineEdit = Readonly<{ quantity?: string; override?: string }>;
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
export const validCheckoutPaymentMethod = (value: unknown): value is CheckoutPaymentMethod =>
  typeof value === 'string' && checkoutPaymentMethods.some((method) => method === value);
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

// Incomplete text is UI state, shared by item editors and summary; never part of a request.
export function checkoutLineInput(line: CheckoutLine, edit?: CheckoutLineEdit) {
  const quantityText = edit?.quantity ?? String(line.quantity);
  const overrideText = edit?.override ?? line.unitPriceOverride ?? '';
  return {
    quantityText,
    overrideText,
    quantityValid: /^\d+$/.test(quantityText) && validCheckoutQuantity(Number(quantityText)),
    overrideValid:
      (edit?.override === undefined && line.unitPriceOverride === undefined) ||
      validCheckoutMoney(overrideText),
  };
}

type CheckoutDraftState = {
  scope: CheckoutScope | null;
  draft: CheckoutDraft | null;
  submission: Submission | null;
  lineEdits: Readonly<Record<string, CheckoutLineEdit>>;
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
  editLineText: (
    scope: CheckoutScope,
    operationId: string,
    lineId: string,
    field: 'quantity' | 'override',
    text: string,
  ) => boolean;
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
    lineEdits: Object.freeze({}),
    setScope(scope) {
      const next = validScope(scope) ? Object.freeze({ ...scope }) : null;
      if (!sameCheckoutScope(get().scope, next))
        set({ scope: next, draft: null, submission: null, lineEdits: Object.freeze({}) });
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
        (patch.paymentMethod !== undefined && !validCheckoutPaymentMethod(patch.paymentMethod))
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
      set({ draft: null, submission: null, lineEdits: Object.freeze({}) });
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
      const edit = { ...get().lineEdits[lineId] };
      if (patch.quantity !== undefined) delete edit.quantity;
      if (patch.unitPriceOverride !== undefined) delete edit.override;
      set({
        draft: freezeDraft({
          ...draft,
          items: draft.items.map((item) => (item.lineId === lineId ? next : item)),
        }),
        lineEdits: Object.freeze({ ...get().lineEdits, [lineId]: Object.freeze(edit) }),
      });
      return true;
    },
    removeLine(scope, operationId, lineId) {
      if (
        !editable(scope, operationId) ||
        !get().draft!.items.some((item) => item.lineId === lineId)
      )
        return false;
      const edits = { ...get().lineEdits };
      delete edits[lineId];
      set({
        draft: freezeDraft({
          ...get().draft!,
          items: get().draft!.items.filter((item) => item.lineId !== lineId),
        }),
        lineEdits: Object.freeze(edits),
      });
      return true;
    },
    editLineText(scope, operationId, lineId, field, text) {
      if (
        !editable(scope, operationId) ||
        !['quantity', 'override'].includes(field) ||
        typeof text !== 'string'
      )
        return false;
      const draft = get().draft!;
      const line = draft.items.find((item) => item.lineId === lineId);
      if (!line) return false;
      const next = {
        ...line,
        ...(field === 'quantity' && /^\d+$/.test(text) && validCheckoutQuantity(Number(text))
          ? { quantity: Number(text) }
          : {}),
        ...(field === 'override' && validCheckoutMoney(text) ? { unitPriceOverride: text } : {}),
      };
      set({
        draft: freezeDraft({
          ...draft,
          items: draft.items.map((item) => (item.lineId === lineId ? next : item)),
        }),
        lineEdits: Object.freeze({
          ...get().lineEdits,
          [lineId]: Object.freeze({
            ...get().lineEdits[lineId],
            [field]: text,
          }),
        }),
      });
      return true;
    },
    captureIntent(scope, operationId) {
      if (!editable(scope, operationId)) return null;
      const draft = get().draft!;
      if (
        !draft.items.length ||
        draft.items.some((line) => {
          const input = checkoutLineInput(line, get().lineEdits[line.lineId]);
          return !input.quantityValid || !input.overrideValid;
        }) ||
        !validCheckoutMoney(draft.discountAmount) ||
        !validCheckoutPaymentMethod(draft.paymentMethod)
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
      if (outcome === 'success')
        set({ draft: null, submission: null, lineEdits: Object.freeze({}) });
      else set({ submission: Object.freeze({ status: outcome, capture }) });
      return true;
    },
  };
});
