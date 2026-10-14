/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const feature = path.resolve(__dirname, '../src/features/products');
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
const schemas = load('schemas/productCategory.schema');
const row = {
  id: 'c',
  business_id: 'b',
  name: ' Cabello ',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const extras = {
  id: 'foreign',
  business_id: 'foreign',
  created_at: 'now',
  updated_at: 'now',
  description: 'no',
};
test('category create preserves SQL-valid text and strips all managed fields, including active state', () => {
  for (const name of [' Cabello ', '\t', '\n', 'É'])
    assert.deepEqual(
      schemas.createProductCategorySchema.parse({ name, ...extras, is_active: false }),
      { name },
    );
});
for (const name of ['', '   ', null, undefined, 3])
  test(`invalid category name ${JSON.stringify(name)}`, () => {
    assert.equal(schemas.createProductCategorySchema.safeParse({ name }).success, false);
  });
test('category patch is partial, preserves false and rejects empty/unknown-only/undefined-only payloads', () => {
  for (const input of [
    {},
    extras,
    { name: undefined },
    { is_active: undefined },
    { name: null },
    { is_active: 'false' },
  ])
    assert.equal(schemas.updateProductCategorySchema.safeParse(input).success, false);
  assert.deepEqual(schemas.updateProductCategorySchema.parse({ is_active: false, ...extras }), {
    is_active: false,
  });
  assert.deepEqual(schemas.updateProductCategorySchema.parse({ name: row.name }), {
    name: row.name,
  });
});
function repository(client) {
  return load('repositories/productCategoriesRepository', {
    '@/lib/supabase/client': { supabase: client },
  }).productCategoriesRepository;
}
const columns = 'id,business_id,name,is_active,created_at,updated_at';
function sdkHarness(data = row, status = 200) {
  const requests = [];
  const sdk = createClient('http://fixture.invalid', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, options) => {
        requests.push({ url: new URL(url), options });
        return new Response(JSON.stringify(data), { status });
      },
    },
  });
  return { requests, repo: repository(sdk) };
}
test('actual SDK uses exact category projection, explicit tenant/id and no active filter on detail', async () => {
  const h = sdkHarness([row]);
  const result = await h.repo.getById('b', 'c');
  assert.deepEqual(result.data, row);
  const q = h.requests[0].url;
  assert.equal(q.pathname, '/rest/v1/product_categories');
  assert.equal(q.searchParams.get('select'), columns);
  assert.equal(q.searchParams.get('business_id'), 'eq.b');
  assert.equal(q.searchParams.get('id'), 'eq.c');
  assert.equal(q.searchParams.get('is_active'), null);
});
test('create allows duplicate names, strips server/active fields and sends only category name and explicit tenant', async () => {
  const h = sdkHarness(row);
  await h.repo.create('b', { name: row.name, is_active: false, ...extras });
  await h.repo.create('b', { name: row.name });
  assert.equal(h.requests.length, 2);
  for (const r of h.requests) {
    assert.deepEqual(JSON.parse(r.options.body), { business_id: 'b', name: row.name });
    assert.equal(r.url.searchParams.get('select'), columns);
  }
});
test('update is an allowlisted tenant/id PATCH, never deletes, changes products or sends undefined fields', async () => {
  const h = sdkHarness([row]);
  await h.repo.update('b', 'c', { name: undefined, is_active: false, ...extras });
  assert.equal(h.requests.length, 1);
  const r = h.requests[0];
  assert.equal(r.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(r.options.body), { is_active: false });
  assert.equal(r.url.searchParams.get('business_id'), 'eq.b');
  assert.equal(r.url.searchParams.get('id'), 'eq.c');
});
for (const status of ['active', 'inactive', 'all'])
  test(`list categories ${status}: exact scope, stable order and inclusive sentinel`, async () => {
    const h = sdkHarness([]);
    await h.repo.listByBusiness('b', { page: 2, pageSize: 25, status });
    const q = h.requests[0].url;
    assert.equal(q.searchParams.get('business_id'), 'eq.b');
    assert.equal(q.searchParams.get('select'), columns);
    assert.equal(
      q.searchParams.get('is_active'),
      status === 'all' ? null : `eq.${status === 'active'}`,
    );
    assert.equal(q.searchParams.get('order'), 'name.asc,id.asc');
    assert.equal(q.searchParams.get('offset'), '25');
    assert.equal(q.searchParams.get('limit'), '26');
    assert.equal(q.searchParams.get('category_id'), null);
  });
function service(result, rejection) {
  const calls = [];
  const repo = Object.fromEntries(
    ['getById', 'create', 'update', 'listByBusiness'].map((method) => [
      method,
      (...args) => {
        calls.push([method, ...args]);
        return rejection ? Promise.reject(rejection) : Promise.resolve(result);
      },
    ]),
  );
  return {
    calls,
    api: load('services/productCategoriesService', {
      '../repositories/productCategoriesRepository': { productCategoriesRepository: repo },
    }).productCategoriesService,
  };
}
test('service resolves list defaults and sentinel without local filtering or treating empty as missing', async () => {
  const h = service({ data: Array.from({ length: 26 }, () => row), error: null, status: 200 });
  const r = await h.api.listByBusiness('b');
  assert.equal(r.data.items.length, 25);
  assert.equal(r.data.hasNextPage, true);
  assert.deepEqual(h.calls, [['listByBusiness', 'b', { page: 1, pageSize: 25, status: 'active' }]]);
  assert.deepEqual(
    (await service({ data: [], error: null, status: 200 }).api.listByBusiness('b')).data,
    { items: [], page: 1, pageSize: 25, hasNextPage: false },
  );
});
test('service rejects invalid pagination/identity before repository', async () => {
  const h = service({ data: [], error: null, status: 200 });
  for (const params of [
    { page: 0 },
    { page: 1.5 },
    { pageSize: 101 },
    { pageSize: 0 },
    { status: 'other' },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
  ])
    assert.equal((await h.api.listByBusiness('b', params)).error.code, 'UNKNOWN_ERROR');
  assert.equal((await h.api.listByBusiness(' ')).error.code, 'PRODUCT_CATEGORY_ACCESS_DENIED');
  assert.equal(h.calls.length, 0);
});
test('service validates and strips inputs, preserves duplicate names and archive status only', async () => {
  const h = service({ data: row, error: null, status: 200 });
  await h.api.create('b', { name: row.name, ...extras, is_active: false });
  await h.api.update('b', 'c', { is_active: false, ...extras });
  assert.deepEqual(h.calls, [
    ['create', 'b', { name: row.name }],
    ['update', 'b', 'c', { is_active: false }],
  ]);
  assert.equal((await h.api.create('b', { name: ' ' })).error.code, 'UNKNOWN_ERROR');
  assert.equal((await h.api.update('b', 'c', extras)).error.code, 'UNKNOWN_ERROR');
  assert.equal(h.calls.length, 2);
});
for (const [status, code, expected] of [
  [0, '42501', 'NETWORK_ERROR'],
  [403, 'x', 'PRODUCT_CATEGORY_ACCESS_DENIED'],
  [400, '42501', 'PRODUCT_CATEGORY_ACCESS_DENIED'],
  [500, 'x', 'UNKNOWN_ERROR'],
])
  test(`safe category errors ${status}/${code}`, async () => {
    const h = service({
      data: null,
      error: { code, message: 'secret SQL', details: 'private' },
      status,
    });
    const r = await h.api.getById('b', 'c');
    assert.equal(r.error.code, expected);
    assert.deepEqual(Object.keys(r.error), ['code', 'message']);
    assert(!JSON.stringify(r).includes('private'));
    assert(!JSON.stringify(r).includes('secret SQL'));
  });
test('service maps invisible detail to not found and unexpected rejection safely; repository keeps SDK failure', async () => {
  assert.equal(
    (await service({ data: null, error: null, status: 200 }).api.getById('b', 'c')).error.code,
    'PRODUCT_CATEGORY_NOT_FOUND',
  );
  assert.equal(
    (await service(null, new Error('private')).api.create('b', { name: 'N' })).error.code,
    'UNKNOWN_ERROR',
  );
  const h = sdkHarness({ code: '42501', message: 'raw SDK' }, 403);
  const r = await h.repo.getById('b', 'c');
  assert.equal(r.status, 403);
  assert.equal(r.error.message, 'raw SDK');
});
