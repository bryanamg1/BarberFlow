/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, beforeEach } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = new Map();
function load(filename) {
  if (modules.has(filename)) return modules.get(filename);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
      // Real state/validation libraries; any SDK, persistence or network dependency fails.
      assert(['zod', 'zustand/vanilla'].includes(name), `Unexpected dependency: ${name}`);
      return require(name);
    },
    mod,
    mod.exports,
  );
  modules.set(filename, mod.exports);
  return mod.exports;
}
const { purchaseDraftStore: store } = load(
  path.join(root, 'src/features/purchases/store/purchaseDraftStore.ts'),
);
const { completePurchaseSchema: schema } = load(
  path.join(root, 'src/features/purchases/schemas/purchase.schema.ts'),
);
const state = () => store.getState();
const start = () => {
  state().setBusiness('business-a');
  assert.equal(state().startDraft('business-a', 'operation-a'), true);
};
const complete = {
  supplierName: '  Proveedor original  ',
  expenseCategoryId: ' category-a ',
  paymentMethod: 'CASH',
  purchasedAt: '2026-01-01T10:00:00.123456-03:00',
  notes: '  Nota\noriginal  ',
  items: [{ productId: ' product-a ', quantity: 2, unitCost: '0000.29' }],
};
beforeEach(() => state().setBusiness(null));

test('BF211 initial state and approved API have no persistence or manufactured fields', () => {
  assert.equal(state().businessId, null);
  assert.equal(state().draft, null);
  assert.deepEqual(Object.keys(state()).sort(), [
    'businessId',
    'clearDraft',
    'draft',
    'patchDraft',
    'setBusiness',
    'startDraft',
  ]);
  assert.equal(store.persist, undefined);
  assert.equal(state().startDraft('business-a', 'operation-a'), false);
  assert.equal(state().startDraft(null, 'operation-a'), false);
});
test('BF211 start requires matching context and usable caller operationId', () => {
  state().setBusiness('business-a');
  for (const id of ['', ' \n\t ', null, 1])
    assert.equal(state().startDraft('business-a', id), false);
  assert.equal(state().startDraft('business-b', 'operation-a'), false);
  assert.equal(state().startDraft('business-a', ' operation-a '), true);
  assert.deepEqual(state().draft, { operationId: ' operation-a ', items: [] });
});
test('BF211 existing draft and retry preserve operation identity and all edits', () => {
  start();
  state().patchDraft('business-a', 'operation-a', complete);
  const draft = state().draft;
  assert.equal(state().startDraft('business-a', 'operation-b'), false);
  assert.equal(state().startDraft('business-a', 'operation-a'), false);
  state().setBusiness('business-a');
  assert.equal(state().draft, draft);
  assert.deepEqual(schema.parse(draft), { operationId: 'operation-a', ...complete });
});
test('BF211 patch preserves original strings, exact costs, null and empty values', () => {
  start();
  assert.equal(state().patchDraft('business-a', 'operation-a', complete), true);
  assert.deepEqual(state().draft, { operationId: 'operation-a', ...complete });
  state().patchDraft('business-a', 'operation-a', { notes: null, supplierName: '' });
  assert.equal(state().draft.notes, null);
  assert.equal(state().draft.supplierName, '');
  state().patchDraft('business-a', 'operation-a', { notes: '' });
  assert.equal(state().draft.notes, '');
  const previous = state().draft;
  state().patchDraft('business-a', 'operation-a', { notes: undefined });
  assert.equal(state().draft, previous);
});
test('BF211 incomplete edits remain editable while BF210 owns final validation', () => {
  start();
  assert.equal(schema.safeParse(state().draft).success, false);
  const invalidItems = [{ productId: '', quantity: 0, unitCost: '1.999' }];
  assert.equal(state().patchDraft('business-a', 'operation-a', { items: invalidItems }), true);
  assert.deepEqual(state().draft.items, invalidItems);
  assert.equal(schema.safeParse(state().draft).success, false);
  state().patchDraft('business-a', 'operation-a', complete);
  assert.equal(schema.safeParse(state().draft).success, true);
});
test('BF211 duplicate lines are preserved; final schema rejects differing costs and quantity/cost bounds', () => {
  start();
  const item = complete.items[0];
  state().patchDraft('business-a', 'operation-a', {
    ...complete,
    items: [item, { ...item, unitCost: '0.29' }],
  });
  assert.equal(state().draft.items.length, 2);
  assert.equal(schema.safeParse(state().draft).success, true);
  for (const patch of [{ unitCost: '0.30' }, { quantity: 2147483648 }, { unitCost: '1.999' }]) {
    state().patchDraft('business-a', 'operation-a', { items: [item, { ...item, ...patch }] });
    assert.equal(state().draft.items.length, 2);
    assert.equal(schema.safeParse(state().draft).success, false);
  }
});
test('BF211 ignores operation/server fields and strips line snapshots without mutating input', () => {
  start();
  const line = {
    ...complete.items[0],
    id: 'injected',
    product_name_snapshot: 'injected',
    line_total: '100.00',
  };
  const items = [line];
  state().patchDraft('business-a', 'operation-a', {
    ...complete,
    items,
    operationId: 'hijacked',
    business_id: 'foreign',
    created_by: 'foreign',
    status: 'COMPLETED',
    total: '100.00',
  });
  assert.deepEqual(state().draft, { operationId: 'operation-a', ...complete });
  items.push(line);
  line.quantity = 99;
  assert.equal(state().draft.items.length, 1);
  assert.equal(state().draft.items[0].quantity, 2);
  assert.equal(line.id, 'injected');
});
test('BF211 wrong tenant/operation callbacks cannot patch or clear the active draft', () => {
  start();
  const previous = state().draft;
  for (const [business, operation] of [
    ['business-b', 'operation-a'],
    ['business-a', 'operation-b'],
  ]) {
    assert.equal(state().patchDraft(business, operation, complete), false);
    assert.equal(state().clearDraft(business, operation), false);
    assert.equal(state().draft, previous);
  }
});
test('BF211 guarded success clears only its captured intention; next intention has a new caller key', () => {
  start();
  assert.equal(state().clearDraft('business-a', 'operation-a'), true);
  assert.equal(state().businessId, 'business-a');
  assert.equal(state().draft, null);
  assert.equal(state().startDraft('business-a', 'operation-b'), true);
  assert.equal(state().clearDraft('business-a', 'operation-a'), false);
  assert.equal(state().patchDraft('business-a', 'operation-a', complete), false);
  assert.deepEqual(state().draft, { operationId: 'operation-b', items: [] });
});
test('BF211 context switch/loss discards prior draft and late callbacks stay isolated', () => {
  start();
  state().setBusiness('business-b');
  assert.equal(state().draft, null);
  state().startDraft('business-b', 'operation-b');
  assert.equal(state().clearDraft('business-a', 'operation-a'), false);
  assert.equal(state().patchDraft('business-a', 'operation-a', complete), false);
  for (const context of [null, '', ' \n ']) {
    state().setBusiness(context);
    assert.equal(state().businessId, null);
    assert.equal(state().draft, null);
  }
});
