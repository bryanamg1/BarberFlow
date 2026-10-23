/* global __dirname */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { test } = require('node:test'),
  ts = require('typescript');
const root = path.resolve(__dirname, '..'),
  modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    (name) => {
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
      if (name.startsWith('@/')) return load(path.join(root, 'src', name.slice(2) + '.ts'));
      assert(
        ['zod', 'zustand/vanilla'].includes(name),
        'No SDK/persistence/provider/network in payment intent',
      );
      return require(name);
    },
    mod,
    mod.exports,
  );
  modules.set(file, mod.exports);
  return mod.exports;
}
const {
  checkoutDraftStore: store,
  checkoutPaymentMethods: methods,
  validCheckoutPaymentMethod: valid,
} = load(path.join(root, 'src/features/sales/store/checkoutDraftStore.ts'));
const { deriveCheckoutPayment: payment } = load(
  path.join(root, 'src/features/sales/utils/checkoutPayment.ts'),
);
const { deriveCheckoutSummary: deriveSummary } = load(
  path.join(root, 'src/features/sales/utils/checkoutSummary.ts'),
);
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' },
  state = () => store.getState();
function setup() {
  state().setScope(null);
  state().setScope(scope);
  state().startDraft(scope, 'op');
  state().addLine(scope, 'op', { lineId: 'a', itemType: 'SERVICE', itemId: 's', quantity: 1 }, 'b');
}
const select = (method) => state().patchDraft(scope, 'op', { paymentMethod: method });
const summary = () =>
  deriveSummary(state().draft, [
    {
      lineId: 'a',
      itemId: 's',
      itemType: 'SERVICE',
      name: 'Corte',
      status: 'ready',
      catalogPrice: '100.00',
      inputValid: true,
    },
  ]);
test('BF195 exact immutable methods agree with existing checkout SQL wire enum', () => {
  assert.deepEqual(
    [...methods],
    ['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'DIGITAL_WALLET'],
  );
  assert(Object.isFrozen(methods));
  const sql = fs.readFileSync(
    path.join(root, 'supabase/migrations/20261022181656_complete_checkout.sql'),
    'utf8',
  );
  const values = sql
    .match(/p_payment_method NOT IN\s*\(([^)]+)\)/)[1]
    .match(/'[^']+'/g)
    .map((x) => x.slice(1, -1));
  assert.deepEqual(values, [...methods]);
});
for (const total of ['100.00', '0.00'])
  test(`BF195 total${total} requires explicit selection; no CASH default`, () => {
    setup();
    assert(!('paymentMethod' in state().draft));
    const result = payment({ total, eligible: true }, state().draft.paymentMethod);
    assert(!result.methodValid);
    assert(!result.eligible);
    assert.equal(result.method, undefined);
    assert.equal(result.zeroTotal, total === '0.00');
    assert.equal(state().submission, null);
  });
for (const method of ['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'DIGITAL_WALLET'])
  test(`BF195 explicit${method} contributes eligibility for positive and zero totals`, () => {
    setup();
    assert(valid(method));
    assert(select(method));
    for (const total of ['100.00', '0.00']) {
      const result = payment({ total, eligible: true }, state().draft.paymentMethod);
      assert(result.methodValid);
      assert(result.eligible);
      assert.equal(result.method, method);
    }
    assert.equal(state().submission, null);
  });
test('BF195 changing method replaces previous selection', () => {
  setup();
  select('CASH');
  select('BANK_TRANSFER');
  assert.equal(state().draft.paymentMethod, 'BANK_TRANSFER');
});
for (const value of ['OTHER', 'TRANSFER', 'DEBIT', 'CREDIT', 'cash', '', null, 0, {}])
  test(`BF195 arbitrary ${JSON.stringify(value)} rejected by programmatic store and derivation`, () => {
    setup();
    select('CASH');
    assert(!valid(value));
    assert(!select(value));
    assert.equal(state().draft.paymentMethod, 'CASH');
    assert(!payment({ total: '100.00', eligible: true }, value).eligible);
  });
test('BF195 discount equals subtotal gives zero, still requires explicit method', () => {
  setup();
  state().patchDraft(scope, 'op', { discountAmount: '100.00' });
  const s = summary();
  assert(s.eligible);
  assert.equal(s.total, '0.00');
  assert(!payment(s, undefined).eligible);
  select('CREDIT_CARD');
  assert(payment(summary(), state().draft.paymentMethod).eligible);
  assert.equal(state().submission, null);
});
test('BF195 invalid discount remains ineligible despite selection; selection is retained', () => {
  setup();
  select('DEBIT_CARD');
  state().patchDraft(scope, 'op', { discountAmount: '100.01' });
  assert(!payment(summary(), state().draft.paymentMethod).eligible);
  assert.equal(state().draft.paymentMethod, 'DEBIT_CARD');
  assert.equal(summary().total, null);
});
test('BF195 positive/zero/unknown totals never invent or clear the method', () => {
  setup();
  select('DIGITAL_WALLET');
  for (const total of ['100.00', '0.00', null]) {
    const result = payment({ total, eligible: total !== null }, state().draft.paymentMethod);
    assert.equal(result.method, 'DIGITAL_WALLET');
    assert.equal(result.eligible, total !== null);
  }
  assert.equal(state().draft.paymentMethod, 'DIGITAL_WALLET');
});
test('BF195 pending/uncertain/retry preserve same immutable method/capture', () => {
  setup();
  select('BANK_TRANSFER');
  const capture = state().captureIntent(scope, 'op');
  assert(capture);
  assert(!select('CASH'));
  assert(!payment(summary(), state().draft.paymentMethod, true).eligible);
  state().settleCapture(capture, 'uncertain');
  assert(!select('CASH'));
  assert(state().retryCapture(capture));
  assert.equal(state().submission.capture, capture);
  assert.equal(capture.input.paymentMethod, 'BANK_TRANSFER');
  assert(Object.isFrozen(capture.input));
});
for (const field of ['userId', 'businessId', 'membershipId'])
  test(`BF195 ${field} switch clears selection and rejects late captured callback`, () => {
    setup();
    select('CASH');
    const capture = state().captureIntent(scope, 'op'),
      next = { ...scope, [field]: 'next' };
    state().setScope(next);
    state().startDraft(next, 'new-op');
    assert(!select('BANK_TRANSFER'));
    assert(!state().settleCapture(capture, 'success'));
    assert.equal(state().draft.paymentMethod, undefined);
    assert.equal(state().draft.operationId, 'new-op');
  });
test('BF195 new same-scope draft/logout never inherit method or accept old callback', () => {
  setup();
  select('CASH');
  state().clearDraft(scope, 'op');
  state().startDraft(scope, 'next');
  assert(!select('BANK_TRANSFER'));
  assert.equal(state().draft.paymentMethod, undefined);
  state().setScope(null);
  assert.equal(state().draft, null);
  assert(!select('CASH'));
});
