/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
function load(file) {
  const filename = path.resolve(__dirname, '../src', file + '.ts');
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) =>
      load(
        path.relative(
          path.resolve(__dirname, '../src'),
          path.resolve(path.dirname(filename), name),
        ),
      ),
    module,
    module.exports,
  );
  return module.exports;
}
const {
  selectProductStock: select,
  classifyProductStock: classify,
  productStockError: error,
} = load('features/products/utils/productStock');
const { inventoryKeys: keys } = load('features/inventory/constants/inventoryKeys');
const state = (data) => ({
  status: 'success',
  data,
  error: null,
  isFetching: false,
  refetch: async () => {},
});
for (const [value, minimum, level] of [
  ['0', 0, 'OUT'],
  ['0', 5, 'OUT'],
  ['1', 0, 'NORMAL'],
  ['2', 3, 'LOW'],
  ['3', 3, 'LOW'],
  ['4', 3, 'NORMAL'],
  ['9007199254740993', 2147483647, 'NORMAL'],
  ['9223372036854775807', 0, 'NORMAL'],
])
  test(`stock ${value}, minimum ${minimum} => ${level}`, () =>
    assert.equal(classify(value, minimum), level));
for (const value of ['-1', 'NaN', '1.5', '', ' 0 ', '1e3'])
  test(`invalid or uncontracted balance ${JSON.stringify(value)} is unavailable, never NORMAL/zero`, () => {
    assert.equal(classify(value, 3), null);
    assert.deepEqual(select(state([{ product_id: 'p', current_stock: value }]), 'p'), {
      status: 'unavailable',
    });
  });
test('minimum must retain the existing nonnegative safe integer contract', () => {
  for (const minimum of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(classify('5', minimum), null);
});
test('exact bigint stock and legitimate zero remain original strings', () => {
  for (const value of ['0', '9007199254740993', '9223372036854775807'])
    assert.deepEqual(select(state([{ product_id: 'p', current_stock: value }]), 'p'), {
      status: 'success',
      value,
    });
});
test('missing and foreign product rows cannot fabricate zero', () => {
  assert.deepEqual(select(state([]), 'p'), { status: 'unavailable' });
  assert.deepEqual(select(state([{ product_id: 'other', current_stock: '0' }]), 'p'), {
    status: 'unavailable',
  });
});
test('incoherent duplicate product rows are unavailable', () => {
  assert.deepEqual(
    select(
      state([
        { product_id: 'p', current_stock: '0' },
        { product_id: 'p', current_stock: '8' },
      ]),
      'p',
    ),
    { status: 'unavailable' },
  );
});
test('loading, idle and error stay distinguishable', () => {
  assert.deepEqual(select({ ...state(null), status: 'pending' }, 'p'), { status: 'pending' });
  assert.deepEqual(select({ ...state(null), status: 'idle' }, 'p'), { status: 'unavailable' });
  const safe = error({ code: 'NETWORK_ERROR', message: 'secret' });
  assert.deepEqual(select({ ...state(null), status: 'error', error: safe }, 'p'), {
    status: 'error',
    error: safe,
  });
});
for (const [code, expected] of [
  ['INVENTORY_ACCESS_DENIED', 'PRODUCT_ACCESS_DENIED'],
  ['NETWORK_ERROR', 'NETWORK_ERROR'],
  ['INVALID_INPUT', 'INVALID_INPUT'],
  ['other', 'UNKNOWN_ERROR'],
])
  test(`stock errors ${code} use safe structured mapping`, () => {
    const mapped = error({ code, message: 'secret SQL', details: 'private' });
    assert.equal(mapped.code, expected);
    assert.ok(!JSON.stringify(mapped).includes('secret'));
    assert.ok(!JSON.stringify(mapped).includes('private'));
  });
test('batch keys normalize ID sets and isolate actor/member/business under actual inventory prefix', () => {
  const scope = { businessId: 'b', userId: 'u', membershipId: 'm' };
  const key = keys.productStockBatch(scope, ['p2', 'p1', 'p2']);
  assert.deepEqual(key, keys.productStockBatch(scope, ['p1', 'p2']));
  assert.deepEqual(key.slice(0, 2), keys.byBusiness('b'));
  for (const change of [{ businessId: 'x' }, { userId: 'x' }, { membershipId: 'x' }])
    assert.notDeepEqual(key, keys.productStockBatch({ ...scope, ...change }, ['p1', 'p2']));
  assert.notDeepEqual(key, keys.productStockBatch(scope, ['other']));
});
