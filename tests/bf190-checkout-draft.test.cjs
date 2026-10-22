/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, beforeEach } = require('node:test');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/features/sales/store/checkoutDraftStore.ts');
const moduleOutput = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
  (name) => {
    assert.equal(name, 'zustand/vanilla', 'Store must not import persistence, SDK or network');
    return require(name);
  },
  moduleOutput,
  moduleOutput.exports,
);
const { checkoutDraftStore: store, validCheckoutMoney } = moduleOutput.exports;
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' };
const state = () => store.getState();
const start = (operation = 'op', refs) => {
  state().setScope(scope);
  assert.equal(state().startDraft(scope, operation, refs), true);
};
const line = (lineId = 'line-a', extra = {}) => ({
  lineId,
  itemType: 'SERVICE',
  itemId: 's',
  quantity: 1,
  ...extra,
});
const add = (lineId = 'line-a', extra = {}) =>
  state().addLine(scope, 'op', line(lineId, extra), 'b');
const capture = () => {
  add();
  state().patchDraft(scope, 'op', { paymentMethod: 'CASH' });
  const value = state().captureIntent(scope, 'op');
  assert(value);
  return value;
};
beforeEach(() => state().setScope(null));
test('BF190 empty state is memory-only', () => {
  assert.equal(state().scope, null);
  assert.equal(state().draft, null);
  assert.equal(state().submission, null);
  assert.equal(store.persist, undefined);
});
test('BF190 setScope clones the three identities; equivalent scope preserves draft', () => {
  const input = { ...scope };
  state().setScope(input);
  input.userId = 'other';
  assert.deepEqual(state().scope, scope);
  start();
  const original = state().draft;
  state().setScope({ ...scope });
  assert.equal(state().draft, original);
});
test('BF190 start defaults, optional refs and no automatic appointment lines', () => {
  start('op', { appointmentId: 'a', clientId: 'c', services: ['injected'] });
  assert.deepEqual(state().draft, {
    operationId: 'op',
    appointmentId: 'a',
    clientId: 'c',
    items: [],
    discountAmount: '0.00',
  });
  assert.equal(Object.hasOwn(state().draft, 'paymentMethod'), false);
  assert.equal(state().startDraft(scope, 'new'), false);
});
test('BF190 optional references are null when absent', () => {
  start();
  assert.equal(state().draft.appointmentId, null);
  assert.equal(state().draft.clientId, null);
});
test('BF190 new explicit intention uses caller key, stable throughout edits', () => {
  start();
  add();
  assert.equal(state().draft.operationId, 'op');
  assert(state().clearDraft(scope, 'op'));
  assert(state().startDraft(scope, 'new-op'));
  assert.equal(state().draft.operationId, 'new-op');
});
test('BF190 invalid identities and mismatched scope cannot start', () => {
  assert.equal(state().startDraft(scope, 'op'), false);
  state().setScope(scope);
  for (const id of ['', ' \t ', null, 5]) assert.equal(state().startDraft(scope, id), false);
  assert.equal(state().startDraft({ ...scope, userId: 'other' }, 'op'), false);
  assert.equal(state().startDraft(scope, 'op', { clientId: '' }), false);
});
test('BF190 duplicate entity references retain distinct identity and separate values', () => {
  start();
  assert(add());
  assert(add('line-b', { quantity: 3, unitPriceOverride: '0.29' }));
  assert.equal(state().draft.items.length, 2);
  assert.equal(add('line-a'), false);
  assert(state().updateLine(scope, 'op', 'line-a', { quantity: 2 }));
  assert.deepEqual(
    state().draft.items.map((x) => x.quantity),
    [2, 3],
  );
  assert(state().removeLine(scope, 'op', 'line-a'));
  assert.equal(state().draft.items[0].lineId, 'line-b');
});
test('BF190 PRODUCT discriminator is representable without product/inventory dependencies', () => {
  start();
  assert(add('product-a', { itemType: 'PRODUCT', itemId: 'p' }));
  assert(add('product-b', { itemType: 'PRODUCT', itemId: 'p' }));
  assert.equal(state().draft.items.length, 2);
});
for (const quantity of [0, -1, 1.5, 2147483648, NaN, Infinity, '1', null]) {
  test(`BF190 rejects invalid quantity ${String(quantity)} without changing intention`, () => {
    start();
    add();
    const before = state().draft;
    assert.equal(add('bad', { quantity }), false);
    assert.equal(state().updateLine(scope, 'op', 'line-a', { quantity }), false);
    assert.equal(state().draft, before);
  });
}
test('BF190 accepts quantity integer bounds without coercion', () => {
  start();
  assert(add('max', { quantity: 2147483647 }));
});
test('BF190 exact decimal money validation rejects rounding/coercion and overflow', () => {
  for (const value of ['0.00', '0000.29', '9999999999.99']) assert(validCheckoutMoney(value));
  for (const value of ['1', '0.001', '-0.01', 'NaN', '10000000000.00', 1])
    assert(!validCheckoutMoney(value));
});
test('BF190 update clears override explicitly without rewriting a sibling', () => {
  start();
  add('a', { unitPriceOverride: '1.00' });
  add('b', { unitPriceOverride: '2.00' });
  state().updateLine(scope, 'op', 'a', { unitPriceOverride: null });
  assert.equal(state().draft.items[0].unitPriceOverride, undefined);
  assert.equal(state().draft.items[1].unitPriceOverride, '2.00');
});
test('BF190 patch strips scope/key/refs/items/server fields; preserves incomplete discount', () => {
  start();
  state().patchDraft(scope, 'op', {
    discountAmount: '',
    operationId: 'evil',
    scope: null,
    items: [line()],
    appointmentId: 'evil',
    clientId: 'evil',
    total: '0.00',
  });
  assert.deepEqual(state().draft, {
    operationId: 'op',
    appointmentId: null,
    clientId: null,
    items: [],
    discountAmount: '',
  });
  assert.equal(state().captureIntent(scope, 'op'), null);
});
test('BF190 line inputs are copied and allowlisted, state cannot be mutated by reference', () => {
  start();
  const input = { ...line(), snapshot: 'evil' };
  state().addLine(scope, 'op', input, 'b');
  input.quantity = 9;
  assert.equal(state().draft.items[0].quantity, 1);
  assert.equal(state().draft.items[0].snapshot, undefined);
  assert(Object.isFrozen(state().draft));
  assert(Object.isFrozen(state().draft.items[0]));
});
test('BF190 rejects cross-business programmatic Add and stale mutations', () => {
  start();
  assert.equal(state().addLine(scope, 'op', line(), 'other'), false);
  assert.equal(state().patchDraft({ ...scope, membershipId: 'other' }, 'op', {}), false);
  assert.equal(state().clearDraft(scope, 'old-op'), false);
});
test('BF190 capture is deeply immutable and omits local line IDs', () => {
  start();
  const captured = capture();
  assert(Object.isFrozen(captured));
  assert(Object.isFrozen(captured.input));
  assert(Object.isFrozen(captured.input.items));
  assert(Object.isFrozen(captured.input.items[0]));
  assert.deepEqual(captured.input.items, [{ itemType: 'SERVICE', itemId: 's', quantity: 1 }]);
  assert.equal(captured.scope.businessId, 'b');
});
test('BF190 pending blocks Add/update/remove/patch/reset and repeated capture', () => {
  start();
  capture();
  assert.equal(add('new'), false);
  assert.equal(state().updateLine(scope, 'op', 'line-a', { quantity: 2 }), false);
  assert.equal(state().removeLine(scope, 'op', 'line-a'), false);
  assert.equal(
    state().patchDraft(scope, 'op', { discountAmount: '1.00', paymentMethod: 'DEBIT_CARD' }),
    false,
  );
  assert.equal(state().clearDraft(scope, 'op'), false);
  assert.equal(state().captureIntent(scope, 'op'), null);
});
test('BF190 uncertain outcome retries exact original capture/key and remains locked', () => {
  start();
  const captured = capture();
  assert(state().settleCapture(captured, 'uncertain'));
  assert.equal(state().patchDraft(scope, 'op', { discountAmount: '1.00' }), false);
  assert.equal(state().clearDraft(scope, 'op'), false);
  assert(state().retryCapture(captured));
  assert.equal(state().submission.capture, captured);
  assert.equal(state().submission.capture.input.operationId, 'op');
  assert.equal(state().retryCapture(captured), false);
});
test('BF190 confirmed success clears only its capture; late prior success preserves a new draft', () => {
  start();
  const captured = capture();
  assert(state().settleCapture(captured, 'success'));
  assert.equal(state().draft, null);
  state().startDraft(scope, 'new-op');
  assert.equal(state().settleCapture(captured, 'success'), false);
  assert.equal(state().draft.operationId, 'new-op');
});
test('BF190 rejected capture requires explicit clear/start for a changed intention', () => {
  start();
  const captured = capture();
  assert(state().settleCapture(captured, 'rejected'));
  assert.equal(state().patchDraft(scope, 'op', { discountAmount: '1.00' }), false);
  assert(state().clearDraft(scope, 'op'));
  assert(state().startDraft(scope, 'new-op'));
});
for (const field of ['userId', 'businessId', 'membershipId']) {
  test(`BF190 ${field} switch drops old capture; late callback cannot alter a new scope`, () => {
    start();
    const captured = capture();
    const next = { ...scope, [field]: 'new' };
    state().setScope(next);
    state().startDraft(next, 'new-op');
    assert.equal(state().settleCapture(captured, 'success'), false);
    assert.equal(state().retryCapture(captured), false);
    assert.equal(state().draft.operationId, 'new-op');
  });
}
test('BF190 logout clears draft and invalidates pending callback', () => {
  start();
  const captured = capture();
  state().setScope(null);
  assert.equal(state().draft, null);
  assert.equal(state().submission, null);
  assert.equal(state().settleCapture(captured, 'uncertain'), false);
});
