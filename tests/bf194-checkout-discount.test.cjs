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
        'No SDK, persistence or network in discount state',
      );
      return require(name);
    },
    mod,
    mod.exports,
  );
  modules.set(file, mod.exports);
  return mod.exports;
}
const { checkoutDraftStore: store, validCheckoutMoney } = load(
  path.join(root, 'src/features/sales/store/checkoutDraftStore.ts'),
);
const { deriveCheckoutSummary } = load(
  path.join(root, 'src/features/sales/utils/checkoutSummary.ts'),
);
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' };
const state = () => store.getState();
function setup() {
  state().setScope(null);
  state().setScope(scope);
  state().startDraft(scope, 'op');
  state().addLine(scope, 'op', { lineId: 'a', itemType: 'SERVICE', itemId: 's', quantity: 1 }, 'b');
}
const edit = (text) => state().patchDraft(scope, 'op', { discountAmount: text });
const summary = (price = '100.00', status = 'ready', inputValid = true) =>
  deriveCheckoutSummary(
    state().draft,
    state().draft.items.map((line) => ({
      lineId: line.lineId,
      itemId: line.itemId,
      itemType: line.itemType,
      name: 'Corte',
      status,
      catalogPrice: price,
      inputValid,
    })),
    undefined,
    state().submission !== null,
  );
test('BF194 default is explicit0.00; editing replaces, never accumulates', () => {
  setup();
  assert.equal(state().draft.discountAmount, '0.00');
  edit('5.00');
  edit('3.00');
  assert.equal(state().draft.discountAmount, '3.00');
  assert.equal(summary().total, '97.00');
});
for (const [amount, total] of [
  ['0.00', '100.00'],
  ['0.01', '99.99'],
  ['50.00', '50.00'],
  ['100.00', '0.00'],
])
  test(`BF194 ${amount} is valid and produces exact${total}`, () => {
    setup();
    edit(amount);
    const result = summary();
    assert(result.eligible);
    assert(result.discountValid);
    assert.equal(result.total, total);
  });
test('BF194 excessive discount is retained invalid without negative total/clamp/reset', () => {
  setup();
  edit('100.01');
  const result = summary();
  assert.equal(result.discountAmount, '100.01');
  assert(result.discountExceedsSubtotal);
  assert(!result.eligible);
  assert.equal(result.total, null);
  assert.equal(state().draft.discountAmount, '100.01');
});
test('BF194 subtotal decrease invalidates existing discount until explicit correction', () => {
  setup();
  edit('50.00');
  assert(summary().eligible);
  assert.equal(summary('40.00').total, null);
  assert.equal(state().draft.discountAmount, '50.00');
  edit('30.00');
  assert.equal(summary('40.00').total, '10.00');
  assert(summary('40.00').eligible);
});
for (const text of [
  '',
  '-1.00',
  'NaN',
  'Infinity',
  'text',
  '1',
  '1.0',
  '1.001',
  '1,00',
  ' 1.00',
  '10000000000.00',
])
  test(`BF194 invalid raw ${JSON.stringify(text)} never reuses last valid amount`, () => {
    setup();
    edit('5.00');
    edit(text);
    const result = summary();
    assert(!validCheckoutMoney(text));
    assert.equal(state().draft.discountAmount, text);
    assert.equal(result.total, null);
    assert(!result.discountValid);
    assert(!result.eligible);
  });
for (const status of ['loading', 'error', 'unavailable'])
  test(`BF194 ${status} subtotal preserves discount without false zero`, () => {
    setup();
    edit('50.00');
    const result = summary('100.00', status);
    assert.equal(result.subtotal, null);
    assert.equal(result.total, null);
    assert.equal(result.discountAmount, '50.00');
    assert(!result.eligible);
  });
test('BF194 invalid line input does not reinterpret discount', () => {
  setup();
  edit('50.00');
  const result = summary('100.00', 'ready', false);
  assert.equal(result.subtotal, null);
  assert.equal(result.total, null);
  assert.equal(state().draft.discountAmount, '50.00');
});
test('BF194 empty draft stays ineligible, preserves excessive discount', () => {
  setup();
  edit('50.00');
  state().removeLine(scope, 'op', 'a');
  const result = summary();
  assert.equal(result.subtotal, '0.00');
  assert.equal(result.total, null);
  assert.equal(result.discountAmount, '50.00');
  assert(!result.eligible);
});
test('BF194 capture/uncertain/retry keeps exact immutable discount and forbids edits', () => {
  setup();
  edit('5.00');
  state().patchDraft(scope, 'op', { paymentMethod: 'CASH' });
  const capture = state().captureIntent(scope, 'op');
  assert(capture);
  assert(Object.isFrozen(capture.input));
  assert(!edit('3.00'));
  state().settleCapture(capture, 'uncertain');
  assert(!edit('7.00'));
  assert(state().retryCapture(capture));
  assert.equal(state().submission.capture, capture);
  assert.equal(capture.input.discountAmount, '5.00');
  assert.equal(state().draft.discountAmount, '5.00');
});
for (const field of ['userId', 'businessId', 'membershipId'])
  test(`BF194 late edit from old ${field} cannot affect new scoped draft`, () => {
    setup();
    edit('5.00');
    const next = { ...scope, [field]: 'new' };
    state().setScope(next);
    state().startDraft(next, 'new-op');
    assert(!edit('7.00'));
    assert.equal(state().draft.discountAmount, '0.00');
    assert.equal(state().submission, null);
  });
test('BF194 new intent and late completion cannot restore old discount', () => {
  setup();
  edit('5.00');
  state().patchDraft(scope, 'op', { paymentMethod: 'CASH' });
  const capture = state().captureIntent(scope, 'op');
  state().settleCapture(capture, 'rejected');
  assert(state().clearDraft(scope, 'op'));
  state().startDraft(scope, 'next');
  assert(!state().settleCapture(capture, 'success'));
  assert(!edit('10.00'));
  assert.equal(state().draft.operationId, 'next');
  assert.equal(state().draft.discountAmount, '0.00');
});
