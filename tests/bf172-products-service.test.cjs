/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src/features/products');
function load(file, repository) {
  const filename = path.resolve(root, file + '.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name === '../repositories/productsRepository') return { productsRepository: repository };
      if (name === 'zod') return require(name);
      assert(name.startsWith('.'), `Unexpected import ${name}`);
      return load(path.relative(root, path.resolve(path.dirname(filename), name)), repository);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const input = {
  name: '  Cera  ',
  sale_price: 0.29,
  default_purchase_cost: 1.01,
  minimum_stock: 0,
  category_id: null,
  sku: '',
  description: null,
};
const row = {
  ...input,
  id: 'p',
  business_id: 'b',
  is_active: true,
  created_at: 't',
  updated_at: 't',
};
const response = (data, error = null, status = 200) => ({ data, error, status });
function setup(result = response(row)) {
  const calls = [];
  const repo = Object.fromEntries(
    ['listByBusiness', 'getById', 'create', 'update'].map((method) => [
      method,
      async (...args) => {
        calls.push([method, ...args]);
        return typeof result === 'function' ? result() : result;
      },
    ]),
  );
  return { service: load('services/productsService', repo).productsService, calls };
}
test('list defaults, explicit tenant, exact params and lookahead are preserved', async () => {
  const { service, calls } = setup(response([row, row, row]));
  const out = await service.listByBusiness(' b ', {
    page: 3,
    pageSize: 2,
    status: 'inactive',
    categoryId: ' old ',
  });
  assert.deepEqual(calls, [
    ['listByBusiness', ' b ', { page: 3, pageSize: 2, status: 'inactive', categoryId: ' old ' }],
  ]);
  assert.deepEqual(out, {
    data: { items: [row, row], page: 3, pageSize: 2, hasNextPage: true },
    error: null,
  });
});
test('empty is successful, defaults active/1/25', async () => {
  const { service, calls } = setup(response([]));
  assert.deepEqual((await service.listByBusiness('b')).data, {
    items: [],
    page: 1,
    pageSize: 25,
    hasNextPage: false,
  });
  assert.deepEqual(calls[0][2], { page: 1, pageSize: 25, status: 'active' });
});
for (const params of [
  { page: 0 },
  { pageSize: 101 },
  { status: 'bad' },
  { categoryId: ' ' },
  { page: Number.MAX_SAFE_INTEGER },
  null,
])
  test(`invalid params ${JSON.stringify(params)} do not query`, async () => {
    const { service, calls } = setup();
    assert.equal((await service.listByBusiness('b', params)).error.code, 'INVALID_INPUT');
    assert.equal(calls.length, 0);
  });
test('detail includes archived row and missing maps safe NOT_FOUND', async () => {
  let a = setup(response({ ...row, is_active: false }));
  assert.equal((await a.service.getById('b', 'p')).data.is_active, false);
  assert.deepEqual(a.calls, [['getById', 'b', 'p']]);
  a = setup(response(null));
  assert.equal((await a.service.getById('b', 'missing')).error.code, 'PRODUCT_NOT_FOUND');
});
test('create validates, strips managed fields and preserves text/null', async () => {
  const a = setup();
  await a.service.create('b', { ...input, business_id: 'foreign', id: 'injected', stock: 9 });
  assert.deepEqual(a.calls, [['create', 'b', input]]);
});
test('update is partial and does not insert create defaults', async () => {
  const a = setup();
  await a.service.update('b', 'p', {
    sku: '',
    category_id: null,
    is_active: false,
    business_id: 'x',
  });
  assert.deepEqual(a.calls, [
    ['update', 'b', 'p', { sku: '', category_id: null, is_active: false }],
  ]);
});
for (const [method, args] of [
  ['create', ['b', { ...input, sale_price: -1 }]],
  ['update', ['b', 'p', {}]],
  ['getById', ['b', ' ']],
  ['create', [' ', input]],
  ['listByBusiness', [' ']],
])
  test(`${method} invalid input/tenant does not query`, async () => {
    const a = setup();
    assert.ok((await a.service[method](...args)).error);
    assert.equal(a.calls.length, 0);
  });
for (const [status, code, expected] of [
  [0, '42501', 'NETWORK_ERROR'],
  [403, 'x', 'PRODUCT_ACCESS_DENIED'],
  [400, '42501', 'PRODUCT_ACCESS_DENIED'],
  [500, 'x', 'UNKNOWN_ERROR'],
])
  test(`safe error ${status}/${code}`, async () => {
    const a = setup(response(null, { code, message: 'secret SQL token' }, status));
    const out = await a.service.getById('b', 'p');
    assert.equal(out.error.code, expected);
    assert.ok(!JSON.stringify(out).includes('secret'));
  });
test('unexpected repository rejection is safe', async () => {
  const a = setup(() => {
    throw Error('secret SQL');
  });
  assert.equal((await a.service.create('b', input)).error.code, 'UNKNOWN_ERROR');
});
test('keys isolate business, actor, membership, filters and detail ids', () => {
  const { productsKeys: k } = load('constants/productsKeys');
  const a = { businessId: 'a', userId: 'u', membershipId: 'm' };
  const p = { page: 1, pageSize: 25, status: 'active' };
  const key = k.list(a, p);
  for (const scope of [
    { ...a, businessId: 'b' },
    { ...a, userId: 'other' },
    { ...a, membershipId: 'other' },
  ])
    assert.notDeepEqual(k.list(scope, p), key);
  for (const params of [
    { ...p, page: 2 },
    { ...p, pageSize: 10 },
    { ...p, status: 'all' },
    { ...p, categoryId: 'c' },
  ])
    assert.notDeepEqual(k.list(a, params), key);
  assert.notDeepEqual(k.detail(a, 'p'), k.detail(a, 'q'));
  assert.deepEqual(key.slice(0, 2), k.byBusiness('a'));
});
