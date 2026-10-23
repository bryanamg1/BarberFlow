/* global __dirname */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
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
        'No persistence, SDK, query, React or network in derivation',
      );
      return require(name);
    },
    mod,
    mod.exports,
  );
  modules.set(file, mod.exports);
  return mod.exports;
}
const { deriveCheckoutSummary: summary } = load(
  path.join(root, 'src/features/sales/utils/checkoutSummary.ts'),
);
const { checkoutDraftStore: store } = load(
  path.join(root, 'src/features/sales/store/checkoutDraftStore.ts'),
);
const line = (lineId = 'a', itemType = 'SERVICE', patch = {}) => ({
  lineId,
  itemId: itemType === 'SERVICE' ? 's' : 'p',
  itemType,
  quantity: 1,
  ...patch,
});
const draft = (items = [line()], patch = {}) => ({
  operationId: 'op',
  appointmentId: null,
  clientId: null,
  items,
  discountAmount: '0.00',
  ...patch,
});
const reads = (items, patch = {}) =>
  items.map((item) => ({
    lineId: item.lineId,
    itemId: item.itemId,
    itemType: item.itemType,
    name: 'Catálogo',
    status: 'ready',
    catalogPrice: '0.29',
    inputValid: true,
    ...patch,
  }));
const stock = (value = '10') => ({
  status: 'success',
  data: [{ product_id: 'p', current_stock: value }],
  error: null,
  isFetching: false,
  refetch: async () => {},
});
test('BF193 no draft is idle with no manufactured amounts', () => {
  const result = summary(null, []);
  assert.equal(result.status, 'idle');
  assert.equal(result.subtotal, null);
  assert.equal(result.total, null);
  assert(!result.eligible);
});
test('BF193 empty checkout has genuine empty sum but never eligible', () => {
  const result = summary(draft([]), []);
  assert.equal(result.status, 'empty');
  assert.equal(result.subtotal, '0.00');
  assert(!result.eligible);
});
for (const type of ['SERVICE', 'PRODUCT'])
  test(`BF193 one ${type} includes quantity without requiring payment`, () => {
    const items = [line('a', type, { quantity: 3 })];
    const result = summary(draft(items), reads(items), stock());
    assert.equal(result.subtotal, '0.87');
    assert.equal(result.total, '0.87');
    assert(result.eligible);
    assert.equal(result.lines[0].quantity, 3);
  });
test('BF193 mixed exact cents sum and absolute discount', () => {
  const items = [line('a', 'SERVICE', { quantity: 3 }), line('b', 'PRODUCT', { quantity: 2 })];
  const prices = reads(items);
  prices[1].catalogPrice = '0.31';
  const result = summary(draft(items, { discountAmount: '0.10' }), prices, stock());
  assert.equal(result.subtotal, '1.49');
  assert.equal(result.total, '1.39');
  assert(result.eligible);
});
test('BF193 duplicate SERVICE and PRODUCT lines remain independent and in original order', () => {
  const items = [line('a'), line('b'), line('c', 'PRODUCT'), line('d', 'PRODUCT')];
  const result = summary(draft(items), reads(items), stock());
  assert.deepEqual(
    result.lines.map((item) => item.lineId),
    ['a', 'b', 'c', 'd'],
  );
  assert.equal(result.subtotal, '1.16');
  assert.equal(result.lines.length, 4);
});
test('BF193 per-line explicit overrides, including zero, are honored', () => {
  const items = [
    line('a', 'SERVICE', { quantity: 2, unitPriceOverride: '0.10' }),
    line('b', 'PRODUCT', { unitPriceOverride: '0.00' }),
  ];
  const result = summary(draft(items), reads(items), stock());
  assert.equal(result.subtotal, '0.20');
  assert(result.eligible);
});
test('BF193 changing discount replaces the single absolute value', () => {
  const data = draft([line()], { discountAmount: '0.10' }),
    input = reads(data.items);
  assert.equal(summary(data, input).total, '0.19');
  assert.equal(summary({ ...data, discountAmount: '0.20' }, input).total, '0.09');
  assert.equal(data.discountAmount, '0.10');
});
test('BF193 full discount yields valid zero, not negative or a payment requirement', () => {
  const data = draft([line()], { discountAmount: '0.29' });
  const result = summary(data, reads(data.items));
  assert.equal(result.total, '0.00');
  assert(result.eligible);
});
test('BF193 discount above subtotal is preserved invalid, never clamped/reset', () => {
  const data = draft([line()], { discountAmount: '1.00' });
  const original = JSON.stringify(data);
  const result = summary(data, reads(data.items));
  assert.equal(result.subtotal, '0.29');
  assert.equal(result.discountAmount, '1.00');
  assert.equal(result.discountExceedsSubtotal, true);
  assert.equal(result.total, null);
  assert.equal(result.status, 'invalid');
  assert.equal(JSON.stringify(data), original);
});
for (const discountAmount of ['', '-0.01', '0.001', 'NaN', '10000000000.00'])
  test(`BF193 invalid discount ${discountAmount} produces no false total`, () => {
    const data = draft([line()], { discountAmount });
    const result = summary(data, reads(data.items));
    assert(!result.discountValid);
    assert.equal(result.total, null);
    assert.equal(result.discountAmount, discountAmount);
    assert(!result.eligible);
  });
for (const status of ['loading', 'error', 'unavailable'])
  for (const type of ['SERVICE', 'PRODUCT'])
    test(`BF193 ${type} ${status} preserves line and does not impute zero`, () => {
      const items = [line('a', type)],
        result = summary(draft(items), reads(items, { status }), stock());
      assert.equal(result.status, status);
      assert.equal(result.lines.length, 1);
      assert.equal(result.lines[0].lineTotal, null);
      assert.equal(result.subtotal, null);
      assert.equal(result.total, null);
      assert(!result.eligible);
    });
test('BF193 missing/incoherent read is unavailable, never a fabricated catalog price', () => {
  const items = [line()];
  for (const input of [
    [],
    reads(items, { itemId: 'foreign' }),
    [...reads(items), ...reads(items)],
  ]) {
    const result = summary(draft(items), input);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.subtotal, null);
  }
});
test('BF193 stock insufficient considers aggregate demand across duplicate PRODUCT rows', () => {
  const items = [line('a', 'PRODUCT', { quantity: 2 }), line('b', 'PRODUCT', { quantity: 3 })];
  const result = summary(draft(items), reads(items), stock('4'));
  assert.equal(result.status, 'invalid');
  assert(!result.eligible);
  assert.deepEqual(
    result.lines.map((item) => item.stock.demand),
    ['5', '5'],
  );
  assert.equal(result.subtotal, '1.45');
  assert(summary(draft(items), reads(items), stock('5')).eligible);
});
for (const status of ['pending', 'error', 'idle'])
  test(`BF193 stock ${status} is not zero; priced subtotal may remain an estimate`, () => {
    const items = [line('a', 'PRODUCT')],
      result = summary(draft(items), reads(items), { ...stock(), status, data: null });
    assert(!result.eligible);
    assert.equal(result.lines[0].stock.available, null);
    assert.equal(result.subtotal, '0.29');
  });
test('BF193 changing catalog estimate keeps explicit override independent', () => {
  const items = [line('a'), line('b', 'SERVICE', { unitPriceOverride: '0.10' })],
    data = draft(items);
  assert.equal(summary(data, reads(items, { catalogPrice: '1.00' })).subtotal, '1.10');
  assert.equal(summary(data, reads(items, { catalogPrice: '2.00' })).subtotal, '2.10');
  assert.equal(items[1].unitPriceOverride, '0.10');
});
test('BF193 incomplete quantity or price editor invalidates summary instead of reusing valid draft value', () => {
  const items = [line()];
  const result = summary(draft(items), reads(items, { inputValid: false }));
  assert.equal(result.status, 'invalid');
  assert.equal(result.subtotal, null);
  assert.equal(result.total, null);
});
test('BF193 line/subtotal bounds never round or overflow', () => {
  let items = [line('a', 'SERVICE', { quantity: 2 })];
  let result = summary(draft(items), reads(items, { catalogPrice: '9999999999.99' }));
  assert.equal(result.subtotal, null);
  assert(!result.eligible);
  items = [line('a'), line('b')];
  result = summary(draft(items), reads(items, { catalogPrice: '9999999999.99' }));
  assert.equal(result.subtotal, null);
  assert.equal(result.total, null);
  assert(!result.eligible);
});
test('BF193 pending/uncertain capture blocks eligibility, not by inventing payment validation', () => {
  const data = draft(),
    input = reads(data.items);
  const result = summary(data, input, undefined, true);
  assert.equal(result.status, 'blocked');
  assert.equal(result.total, '0.29');
  assert(!result.eligible);
  assert(summary(data, input).eligible);
});
test('BF193 pure derivation leaves the real store and operation untouched', () => {
  const scope = { userId: 'u', businessId: 'b', membershipId: 'm' };
  store.getState().setScope(scope);
  store.getState().startDraft(scope, 'op');
  const before = store.getState().draft;
  summary(draft(), reads([line()]));
  assert.equal(store.getState().draft, before);
  store.getState().setScope(null);
});
