/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src/features/inventory');
const b = '00000000-0000-4000-8000-000000000225';
function load(file, dependencies) {
  const filename = path.resolve(root, file + '.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(
    (name) => {
      if (name in dependencies) return dependencies[name];
      if (name === 'zod') return require('zod');
      assert(name.startsWith('.'));
      return load(path.relative(root, path.resolve(path.dirname(filename), name)), dependencies);
    },
    module,
    module.exports,
  );
  return module.exports;
}
function service(data, error = null, status = 200, rejection) {
  if (arguments.length === 0) data = [];
  const calls = [];
  const repository = {
    getLowStockProducts: (...args) => {
      calls.push(args);
      return rejection ? Promise.reject(rejection) : Promise.resolve({ data, error, status });
    },
  };
  return {
    calls,
    api: load('services/inventoryService', {
      '../repositories/inventoryRepository': { inventoryRepository: repository },
    }).inventoryService,
  };
}
test('empty collection succeeds with defaults 1/25, no count or invented stock', async () => {
  const h = service();
  assert.deepEqual(await h.api.getLowStockProducts(b), {
    data: { items: [], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  assert.deepEqual(h.calls, [[b, { page: 1, pageSize: 25 }]]);
});
test('preserves server low-stock rows, equality, zero, signed/bigint strings, order and sentinel', async () => {
  const rows = [
    { product_id: 'a', name: '  A ', minimum_stock: 3, current_stock: '3' },
    { product_id: 'b', name: 'B', minimum_stock: 0, current_stock: '0' },
    { product_id: 'c', name: 'C', minimum_stock: 2, current_stock: '-1' },
    { product_id: 'd', name: 'D', minimum_stock: 4, current_stock: '9007199254740993' },
    { product_id: 'sentinel', name: 'E', minimum_stock: 1, current_stock: '0' },
  ];
  const h = service(rows);
  const result = await h.api.getLowStockProducts(b, {
    page: 2,
    pageSize: 4,
    status: 'all',
    business_id: 'foreign',
  });
  assert.deepEqual(result.data, {
    items: rows.slice(0, 4),
    page: 2,
    pageSize: 4,
    hasNextPage: true,
  });
  assert.equal(result.data.items[0], rows[0]);
  assert.deepEqual(h.calls, [[b, { page: 2, pageSize: 4 }]]);
});
test('invalid page/size/tenant prevents SDK, no coercion', async () => {
  const h = service();
  for (const params of [
    null,
    { page: 0 },
    { page: 1.1 },
    { page: '1' },
    { page: NaN },
    { pageSize: 0 },
    { pageSize: 101 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
  ])
    assert.equal((await h.api.getLowStockProducts(b, params)).error.code, 'INVALID_INPUT');
  assert.equal((await h.api.getLowStockProducts('bad')).error.code, 'INVALID_INPUT');
  assert.equal(h.calls.length, 0);
});
for (const [status, code, expected] of [
  [0, '42501', 'NETWORK_ERROR'],
  [401, '22023', 'INVENTORY_ACCESS_DENIED'],
  [403, 'x', 'INVENTORY_ACCESS_DENIED'],
  [400, '42501', 'INVENTORY_ACCESS_DENIED'],
  [400, '22023', 'INVALID_INPUT'],
  [400, '22P02', 'INVALID_INPUT'],
  [400, '22003', 'INVALID_INPUT'],
  [500, 'secret', 'UNKNOWN_ERROR'],
])
  test(`safe low-stock mapping ${status}/${code}`, async () => {
    const result = await service(
      null,
      { code, message: 'private', details: 'token' },
      status,
    ).api.getLowStockProducts(b);
    assert.equal(result.error.code, expected);
    assert.equal(result.data, null);
    assert(!JSON.stringify(result).includes('private'));
    assert(!JSON.stringify(result).includes('token'));
  });
test('absent payload/rejection is error, never successful empty list', async () => {
  for (const data of [null, undefined])
    assert.equal((await service(data).api.getLowStockProducts(b)).error.code, 'UNKNOWN_ERROR');
  const h = service(null, null, 200, new Error('private'));
  assert.equal((await h.api.getLowStockProducts(b)).error.code, 'UNKNOWN_ERROR');
});
