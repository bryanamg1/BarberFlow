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
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(
    (name) => {
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
      if (name.startsWith('@/')) return load(path.join(root, 'src', name.slice(2) + '.ts'));
      assert(['zod', 'zustand/vanilla'].includes(name), 'Unexpected persistence or SDK dependency');
      return require(name);
    },
    mod,
    mod.exports,
  );
  modules.set(file, mod.exports);
  return mod.exports;
}
const { checkoutDraftStore: store } = load(
  path.join(root, 'src/features/sales/store/checkoutDraftStore.ts'),
);
const { addCheckoutService, checkoutServiceEstimate, serviceCatalogDecimal } = load(
  path.join(root, 'src/features/sales/utils/checkoutServiceItems.ts'),
);
const scope = { userId: 'u', businessId: 'b', membershipId: 'm' };
const service = { id: 's', business_id: 'b', is_active: true, price: 0.29 };
const state = () => store.getState();
beforeEach(() => {
  state().setScope(null);
  state().setScope(scope);
  state().startDraft(scope, 'op');
});
test('BF191 same SERVICE adds independent rows, never merges/increments/replaces', () => {
  assert(addCheckoutService(scope, 'op', 'a', service));
  assert(addCheckoutService(scope, 'op', 'b', service));
  assert.deepEqual(
    state().draft.items.map((line) => [line.lineId, line.itemId, line.quantity]),
    [
      ['a', 's', 1],
      ['b', 's', 1],
    ],
  );
  assert.equal(state().draft.items[0].name, undefined);
});
test('BF191 sibling quantities/overrides and remove are independent', () => {
  addCheckoutService(scope, 'op', 'a', service);
  addCheckoutService(scope, 'op', 'b', service);
  state().updateLine(scope, 'op', 'a', { quantity: 2, unitPriceOverride: '0.10' });
  state().updateLine(scope, 'op', 'b', { quantity: 3, unitPriceOverride: '0.20' });
  assert.equal(checkoutServiceEstimate(state().draft.items[0], service), '0.20');
  assert.equal(checkoutServiceEstimate(state().draft.items[1], service), '0.60');
  state().removeLine(scope, 'op', 'a');
  assert.equal(state().draft.items[0].lineId, 'b');
});
test('BF191 several different Services remain ordered references only', () => {
  addCheckoutService(scope, 'op', 'a', service);
  addCheckoutService(scope, 'op', 'b', { ...service, id: 's2' });
  assert.deepEqual(
    state().draft.items.map((line) => line.itemId),
    ['s', 's2'],
  );
});
test('BF191 programmatic Add rejects foreign or archived Services', () => {
  for (const row of [
    { ...service, business_id: 'foreign' },
    { ...service, is_active: false },
  ])
    assert.equal(addCheckoutService(scope, 'op', 'a', row), false);
  assert.equal(state().draft.items.length, 0);
});
for (const price of [NaN, Infinity, -1, 0.291, 10000000000])
  test(`BF191 rejects unusable catalog price ${price}`, () => {
    assert.equal(addCheckoutService(scope, 'op', 'a', { ...service, price }), false);
    assert.equal(serviceCatalogDecimal(price), null);
  });
test('BF191 estimates use exact cents, reflect catalog changes and preserve overrides', () => {
  addCheckoutService(scope, 'op', 'a', service);
  state().updateLine(scope, 'op', 'a', { quantity: 3 });
  const line = state().draft.items[0];
  assert.equal(checkoutServiceEstimate(line, service), '0.87');
  assert.equal(checkoutServiceEstimate(line, { ...service, price: 0.31 }), '0.93');
  state().updateLine(scope, 'op', 'a', { unitPriceOverride: '0.10' });
  assert.equal(checkoutServiceEstimate(state().draft.items[0], { ...service, price: 99 }), '0.30');
  assert.equal(state().draft.items[0].unitPriceOverride, '0.10');
});
test('BF191 overflow yields unavailable estimate, never rounded/clamped totals', () => {
  assert.equal(
    checkoutServiceEstimate({ quantity: 2, unitPriceOverride: '9999999999.99' }, service),
    null,
  );
});
test('BF191 pending/context switch prevents stale Add and reset clears lines', () => {
  addCheckoutService(scope, 'op', 'a', service);
  state().patchDraft(scope, 'op', { paymentMethod: 'CASH' });
  const captured = state().captureIntent(scope, 'op');
  assert.equal(addCheckoutService(scope, 'op', 'b', service), false);
  state().setScope({ ...scope, membershipId: 'new' });
  assert.equal(addCheckoutService(scope, 'op', 'b', service), false);
  assert.equal(state().settleCapture(captured, 'success'), false);
  assert.equal(state().draft, null);
});
