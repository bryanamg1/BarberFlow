/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const feature = path.resolve(__dirname, '../src/features/inventory');
function load(file, dependencies = {}) {
  const filename = path.resolve(feature, file + '.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(
    (name) => {
      if (name in dependencies) return dependencies[name];
      if (name === 'zod') return require('zod');
      assert(name.startsWith('.'), `Unexpected dependency ${name}`);
      return load(path.relative(feature, path.resolve(path.dirname(filename), name)), dependencies);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const row = {
  id: 'm',
  business_id: 'b',
  product_id: 'p',
  type: 'RETURN',
  quantity_delta: -3,
  unit_cost: null,
  reference_type: 'arbitrary',
  reference_id: null,
  notes: ' Original\n ',
  occurred_at: '2026-01-01T03:30:00.123456+00:00',
  created_by: 'actor',
  created_at: '2026-01-01T03:30:00Z',
};
function service(result = { data: [], error: null, status: 200 }, rejection) {
  const calls = [];
  const repository = {
    listStockMovements: (...args) => {
      calls.push(args);
      return rejection ? Promise.reject(rejection) : Promise.resolve(result);
    },
  };
  return {
    calls,
    api: load('services/inventoryService', {
      '../repositories/inventoryRepository': { inventoryRepository: repository },
    }).inventoryService,
  };
}
test('history read remains available alongside BF224 adapters, defaults 1/25 and preserves empty success', async () => {
  const h = service();
  assert.deepEqual(Object.keys(h.api), [
    'getLowStockProducts',
    'adjustStock',
    'getProductStock',
    'listStockMovements',
  ]);
  const r = await h.api.listStockMovements('b', 'p');
  assert.deepEqual(r, {
    data: { items: [], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  assert.deepEqual(h.calls, [['b', 'p', { page: 1, pageSize: 25 }]]);
});
test('lookahead is trimmed without reordering rows or deriving a count/balance', async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ ...row, id: 'm' + (3 - i) }));
  const h = service({ data: rows, error: null, status: 200 });
  const r = await h.api.listStockMovements('b', 'p', { page: 2, pageSize: 2 });
  assert.deepEqual(r.data, { items: rows.slice(0, 2), page: 2, pageSize: 2, hasNextPage: true });
  assert.deepEqual(Object.keys(r.data), ['items', 'page', 'pageSize', 'hasNextPage']);
  assert.equal(r.data.items[0], rows[0]);
});
for (const type of ['PURCHASE', 'SALE', 'LOSS', 'ADJUSTMENT', 'RETURN'])
  test(`preserve ${type}, signed delta, nullable cost and original metadata`, async () => {
    const original = { ...row, type };
    const h = service({ data: [original], error: null, status: 200 });
    const r = await h.api.listStockMovements(' Original B ', ' Original P ', { type });
    assert.equal(r.data.items[0], original);
    assert.deepEqual(h.calls, [[' Original B ', ' Original P ', { page: 1, pageSize: 25, type }]]);
  });
test('zoned half-open optional filters and original IDs pass unchanged, unknown fields stripped', async () => {
  const h = service();
  const from = '2026-01-01T00:00:00.123456-03:00',
    to = '2026-01-02T00:00:00+05:30';
  await h.api.listStockMovements(' b ', ' p ', {
    page: 3,
    pageSize: 100,
    type: 'LOSS',
    from,
    to,
    business_id: 'foreign',
    search: 'not permitted',
  });
  assert.deepEqual(h.calls, [[' b ', ' p ', { page: 3, pageSize: 100, type: 'LOSS', from, to }]]);
  for (const filters of [{ from }, { to }]) {
    await h.api.listStockMovements('b', 'p', filters);
    assert.deepEqual(h.calls.at(-1), ['b', 'p', { page: 1, pageSize: 25, ...filters }]);
  }
});
test('invalid params do not query: no coercion, invalid/zoneless dates, unsafe endpoints or unsupported filters', async () => {
  const h = service();
  for (const params of [
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { page: '1' },
    { page: NaN },
    { pageSize: 0 },
    { pageSize: 101 },
    { pageSize: Infinity },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { type: 'OTHER' },
    { from: '2026-01-01' },
    { from: '2026-01-01T00:00:00' },
    { to: '' },
    null,
  ]) {
    const r = await h.api.listStockMovements('b', 'p', params);
    assert.equal(r.error.code, 'UNKNOWN_ERROR');
  }
  assert.equal(h.calls.length, 0);
});
test('invalid identity stops before repository without silently trimming an ID', async () => {
  const h = service();
  assert.equal((await h.api.listStockMovements(' ', 'p')).error.code, 'INVENTORY_ACCESS_DENIED');
  assert.equal((await h.api.listStockMovements('b', ' ')).error.code, 'UNKNOWN_ERROR');
  assert.equal(h.calls.length, 0);
});
for (const [status, code, expected] of [
  [0, '42501', 'NETWORK_ERROR'],
  [401, 'x', 'INVENTORY_ACCESS_DENIED'],
  [403, 'x', 'INVENTORY_ACCESS_DENIED'],
  [400, '42501', 'INVENTORY_ACCESS_DENIED'],
  [500, 'x', 'UNKNOWN_ERROR'],
])
  test(`safe error mapping ${status}/${code}`, async () => {
    const h = service({
      data: null,
      error: { code, message: 'raw SQL private', details: 'secret', hint: 'secret' },
      status,
    });
    const r = await h.api.listStockMovements('b', 'p');
    assert.equal(r.error.code, expected);
    assert.deepEqual(Object.keys(r.error), ['code', 'message']);
    assert(!JSON.stringify(r).includes('secret'));
    assert(!JSON.stringify(r).includes('raw SQL'));
  });
test('null/undefined successful payload and unexpected rejects cannot become a fabricated empty history', async () => {
  for (const data of [null, undefined])
    assert.equal(
      (await service({ data, error: null, status: 200 }).api.listStockMovements('b', 'p')).error
        .code,
      'UNKNOWN_ERROR',
    );
  for (const error of [new Error('secret'), 'INVENTORY_ACCESS_DENIED'])
    assert.equal(
      (await service(null, error).api.listStockMovements('b', 'p')).error.code,
      'UNKNOWN_ERROR',
    );
});
test('every key dimension isolates business/product/page/size/type/from/to', () => {
  const { inventoryKeys: k } = load('constants/inventoryKeys');
  const params = {
    page: 1,
    pageSize: 25,
    type: 'SALE',
    from: '2026-01-01T00:00:00Z',
    to: '2026-02-01T00:00:00Z',
  };
  const keys = [
    k.stockMovements('b', 'p', params),
    k.stockMovements('other', 'p', params),
    k.stockMovements('b', 'other', params),
    ...Object.keys(params).map((key) =>
      k.stockMovements('b', 'p', {
        ...params,
        [key]:
          key === 'page'
            ? 2
            : key === 'pageSize'
              ? 30
              : key === 'type'
                ? 'LOSS'
                : key === 'from'
                  ? '2026-01-02T00:00:00Z'
                  : '2026-02-02T00:00:00Z',
      }),
    ),
  ];
  assert.equal(new Set(keys.map((key) => JSON.stringify(key))).size, keys.length);
  assert.deepEqual(k.byBusiness('b'), ['inventory', 'b']);
});
