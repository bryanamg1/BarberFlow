/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, beforeEach } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = new Map();
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
      assert(['zod', 'zustand/vanilla'].includes(name), 'No SDK/persistence/network in helpers');
      return require(name);
    },
    mod,
    mod.exports,
  );
  modules.set(file, mod.exports);
  return mod.exports;
}
const { checkoutDraftStore: store, checkoutLineInput } = load(
  path.join(root, 'src/features/sales/store/checkoutDraftStore.ts'),
);
const {
  addCheckoutProduct,
  aggregateProductDemand,
  checkoutProductStock,
  checkoutProductEstimate,
} = load(path.join(root, 'src/features/sales/utils/checkoutProductItems.ts'));
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' };
const product = { id: 'p', business_id: 'b', sale_price: 0.29, is_active: true };
const state = () => store.getState();
const add = (id) => addCheckoutProduct(scope, 'op', id, product);
const stock = (rows = [{ product_id: 'p', current_stock: '5' }]) => ({
  status: 'success',
  data: rows,
  error: null,
  isFetching: false,
  refetch: async () => {},
});
beforeEach(() => {
  state().setScope(null);
  state().setScope(scope);
  state().startDraft(scope, 'op');
});
test('BF192 every Add creates independent PRODUCT lines even when attributes match', () => {
  assert(add('a'));
  assert(add('b'));
  assert.equal(add('a'), false);
  assert.deepEqual(
    state().draft.items.map((x) => [x.lineId, x.itemId, x.quantity]),
    [
      ['a', 'p', 1],
      ['b', 'p', 1],
    ],
  );
});
test('BF192 line-specific quantity, override and remove never change sibling', () => {
  add('a');
  add('b');
  state().updateLine(scope, 'op', 'a', { quantity: 2, unitPriceOverride: '0.10' });
  state().updateLine(scope, 'op', 'b', { quantity: 3, unitPriceOverride: '0.20' });
  assert.equal(checkoutProductEstimate(state().draft.items[0], product), '0.20');
  assert.equal(checkoutProductEstimate(state().draft.items[1], product), '0.60');
  state().removeLine(scope, 'op', 'a');
  assert.equal(state().draft.items[0].lineId, 'b');
});
test('BF192 multiple product IDs remain independent without copying catalog', () => {
  add('a');
  addCheckoutProduct(scope, 'op', 'b', { ...product, id: 'p2' });
  assert.deepEqual(
    state().draft.items.map((x) => x.itemId),
    ['p', 'p2'],
  );
  assert.deepEqual(Object.keys(state().draft.items[0]).sort(), [
    'itemId',
    'itemType',
    'lineId',
    'quantity',
  ]);
});
test('BF192 programmatic cross-business or archived Add is rejected', () => {
  for (const row of [
    { ...product, business_id: 'other' },
    { ...product, is_active: false },
  ])
    assert.equal(addCheckoutProduct(scope, 'op', 'a', row), false);
});
test('BF192 aggregate duplicate demand using exact integers without merging rows', () => {
  add('a');
  add('b');
  state().updateLine(scope, 'op', 'a', { quantity: 2 });
  state().updateLine(scope, 'op', 'b', { quantity: 3 });
  const demand = aggregateProductDemand(state().draft.items);
  assert.equal(demand.get('p'), 5n);
  assert.equal(state().draft.items.length, 2);
  assert.equal(checkoutProductStock(stock(), 'p', 5n).status, 'sufficient');
  assert.equal(checkoutProductStock(stock(), 'p', 6n).status, 'insufficient');
});
test('BF192 large demand does not overflow JS safe integer', () => {
  const lines = Array.from({ length: 5 }, (_, i) => ({
    lineId: String(i),
    itemType: 'PRODUCT',
    itemId: 'p',
    quantity: 2147483647,
  }));
  assert.equal(aggregateProductDemand(lines).get('p'), 10737418235n);
});
test('BF192 real stock zero remains distinct from missing/negative/duplicate stock', () => {
  assert.deepEqual(
    checkoutProductStock(stock([{ product_id: 'p', current_stock: '0' }]), 'p', 1n),
    { status: 'insufficient', available: '0', demand: '1' },
  );
  for (const rows of [
    [],
    [{ product_id: 'p', current_stock: '-1' }],
    [
      { product_id: 'p', current_stock: '1' },
      { product_id: 'p', current_stock: '2' },
    ],
  ])
    assert.equal(checkoutProductStock(stock(rows), 'p', 1n).status, 'unavailable');
});
for (const status of ['idle', 'pending', 'error'])
  test(`BF192 stock ${status} never means zero`, () => {
    const result = {
      ...stock(),
      status,
      data: null,
      error: status === 'error' ? { code: 'NETWORK_ERROR', message: 'safe' } : null,
    };
    const value = checkoutProductStock(result, 'p', 1n);
    assert.equal(value.available, null);
    assert.equal(
      value.status,
      status === 'idle' ? 'unavailable' : status === 'pending' ? 'loading' : 'error',
    );
  });
test('BF192 refreshing stock is non-ready even with an earlier value', () => {
  assert.equal(checkoutProductStock({ ...stock(), isFetching: true }, 'p', 1n).status, 'loading');
});
test('BF192 catalog estimates change without replacing explicit overrides', () => {
  add('a');
  const line = state().draft.items[0];
  assert.equal(checkoutProductEstimate(line, product), '0.29');
  assert.equal(checkoutProductEstimate(line, { ...product, sale_price: 0.31 }), '0.31');
  state().updateLine(scope, 'op', 'a', { unitPriceOverride: '0.00' });
  assert.equal(
    checkoutProductEstimate(state().draft.items[0], { ...product, sale_price: 99 }),
    '0.00',
  );
});
for (const value of ['0', '-1', '1.5', '2147483648', '', 'abc'])
  test(`BF192 incomplete quantity ${value} is shared, invalid, not silently coerced`, () => {
    add('a');
    state().editLineText(scope, 'op', 'a', 'quantity', value);
    assert.equal(state().draft.items[0].quantity, 1);
    const input = checkoutLineInput(state().draft.items[0], state().lineEdits.a);
    assert.equal(input.quantityText, value);
    assert.equal(input.quantityValid, false);
  });
test('BF192 incomplete input cannot be captured or leaked into the request', () => {
  add('a');
  state().patchDraft(scope, 'op', { paymentMethod: 'CASH' });
  state().editLineText(scope, 'op', 'a', 'override', 'invalid');
  assert.equal(state().captureIntent(scope, 'op'), null);
  state().updateLine(scope, 'op', 'a', { unitPriceOverride: null });
  const capture = state().captureIntent(scope, 'op');
  assert(capture);
  assert.equal(capture.input.lineEdits, undefined);
  assert.equal(capture.input.items[0].lineId, undefined);
  assert.equal(state().editLineText(scope, 'op', 'a', 'quantity', '2'), false);
});
test('BF192 context change clears raw edits and rejects stale callbacks', () => {
  add('a');
  state().editLineText(scope, 'op', 'a', 'quantity', 'invalid');
  state().setScope({ ...scope, membershipId: 'new' });
  assert.deepEqual(state().lineEdits, {});
  assert.equal(state().draft, null);
  assert.equal(add('late'), false);
  assert.equal(state().editLineText(scope, 'op', 'a', 'quantity', '2'), false);
});
