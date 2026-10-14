/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/products/repositories/productsRepository.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const columns =
  'id,business_id,category_id,name,description,sku,sale_price,default_purchase_cost,minimum_stock,is_active,created_at,updated_at';
const row = Object.freeze({
  id: 'product',
  business_id: 'business',
  category_id: null,
  name: '  Cera  ',
  description: null,
  sku: '',
  sale_price: 0.29,
  default_purchase_cost: 1.01,
  minimum_stock: 0,
  is_active: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00.123456+00:00',
});
const input = Object.freeze({
  name: row.name,
  category_id: null,
  description: null,
  sku: '',
  sale_price: 0.29,
  default_purchase_cost: 1.01,
  minimum_stock: 0,
});
const extras = {
  id: 'injected',
  business_id: 'foreign',
  created_at: 'now',
  updated_at: 'now',
  created_by: 'user',
  current_stock: 9,
  stock: 9,
  quantity: 9,
  available_stock: 9,
  quantity_on_hand: 9,
  currency_code: 'ARS',
  unit_cost_snapshot: 5,
  role: 'OWNER',
  unknown: true,
};
const response = (data = row, error = null, status = 200) => ({
  data,
  error,
  status,
  count: null,
  statusText: 'fixture',
});
function repository(client) {
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      assert.equal(name, '@/lib/supabase/client');
      return { supabase: client };
    },
    module,
    module.exports,
  );
  assert.deepEqual(Object.keys(module.exports), ['productsRepository']);
  assert.deepEqual(Object.keys(module.exports.productsRepository), [
    'getById',
    'create',
    'update',
    'listByBusiness',
  ]);
  return module.exports.productsRepository;
}
function boundary(result = response(), rejection) {
  const calls = [];
  const chain = {
    then(resolve, reject) {
      return (rejection ? Promise.reject(rejection) : Promise.resolve(result)).then(
        resolve,
        reject,
      );
    },
  };
  for (const method of [
    'select',
    'eq',
    'insert',
    'update',
    'single',
    'maybeSingle',
    'order',
    'range',
    'overrideTypes',
  ])
    chain[method] = (...args) => {
      if (method !== 'overrideTypes') calls.push([method, ...args]);
      return chain;
    };
  return {
    calls,
    repo: repository({
      from(table) {
        calls.push(['from', table]);
        return chain;
      },
    }),
  };
}
const invoke = (repo, method, value = input) =>
  method === 'listByBusiness'
    ? repo.listByBusiness(' Original B ', { page: 2, pageSize: 2, status: 'all' })
    : method === 'getById'
      ? repo.getById(' Original B ', ' Original P ')
      : method === 'create'
        ? repo.create(' Original B ', value)
        : repo.update(' Original B ', ' Original P ', value);

test('BF171 import is inert, uses only the normal singleton and exports exactly four operations', () => {
  repository(new Proxy({}, { get: () => assert.fail('No work during import') }));
});
test('BF171 getById projects exactly twelve columns, scopes original IDs and includes inactive/null-category rows', async () => {
  for (const is_active of [true, false]) {
    const result = response({ ...row, is_active });
    const h = boundary(result);
    assert.equal(await invoke(h.repo, 'getById'), result);
    assert.deepEqual(h.calls[0], ['from', 'products']);
    assert.equal(h.calls[1][1].replace(/\s/g, ''), columns);
    assert.deepEqual(h.calls.slice(2), [
      ['eq', 'business_id', ' Original B '],
      ['eq', 'id', ' Original P '],
      ['maybeSingle'],
    ]);
  }
});
test('BF171 missing get/update remains SDK data:null without invented errors', async () => {
  for (const method of ['getById', 'update']) {
    const result = response(null);
    const h = boundary(result);
    assert.equal(await invoke(h.repo, method), result);
  }
});

for (const status of ['active', 'inactive', 'all']) {
  test(`BF171 list ${status} uses tenant, exact projection, name/id order and one-row lookahead`, async () => {
    const result = response([]);
    const h = boundary(result);
    assert.equal(
      await h.repo.listByBusiness(' Original B ', { status, page: 3, pageSize: 25 }),
      result,
    );
    assert.deepEqual(h.calls[0], ['from', 'products']);
    assert.equal(h.calls[1][1].replace(/\s/g, ''), columns);
    const filters = [['eq', 'business_id', ' Original B ']];
    if (status !== 'all') filters.push(['eq', 'is_active', status === 'active']);
    assert.deepEqual(h.calls.slice(2), [
      ...filters,
      ['order', 'name', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['range', 50, 75],
    ]);
  });
}
test('BF171 category filter is optional and preserves the supplied ID, without category join or lookup', async () => {
  const h = boundary(response([]));
  await h.repo.listByBusiness('business', {
    status: 'all',
    page: 1,
    pageSize: 100,
    categoryId: ' Original C ',
  });
  assert.deepEqual(h.calls.slice(2), [
    ['eq', 'business_id', 'business'],
    ['eq', 'category_id', ' Original C '],
    ['order', 'name', { ascending: true }],
    ['order', 'id', { ascending: true }],
    ['range', 0, 100],
  ]);
});
test('BF171 list preserves all SDK rows including lookahead; service owns page slicing/hasNextPage', async () => {
  const rows = [row, { ...row, id: 'second' }, { ...row, id: 'sentinel' }];
  const result = response(rows);
  const h = boundary(result);
  assert.equal(
    await h.repo.listByBusiness('business', { status: 'all', page: 1, pageSize: 2 }),
    result,
  );
  assert.equal(result.data, rows);
  assert.equal(result.data.length, 3);
});

test('BF171 create allowlists fields, uses explicit tenant, preserves nullable/text/numeric semantics and returns one row', async () => {
  for (const value of [undefined, null, '', ' Original ']) {
    const h = boundary();
    const candidate = {
      ...input,
      ...extras,
      is_active: false,
      category_id: value,
      description: value,
      sku: value,
      sale_price: 0,
      default_purchase_cost: 0,
    };
    await invoke(h.repo, 'create', candidate);
    assert.deepEqual(h.calls[0], ['from', 'products']);
    assert.deepEqual(h.calls[1], [
      'insert',
      {
        business_id: ' Original B ',
        name: input.name,
        category_id: value,
        description: value,
        sku: value,
        sale_price: 0,
        default_purchase_cost: 0,
        minimum_stock: 0,
      },
    ]);
    assert.equal(h.calls[2][1].replace(/\s/g, ''), columns);
    assert.deepEqual(h.calls.slice(3), [['single']]);
  }
});
for (const patch of [
  { name: ' Original ' },
  { category_id: null },
  { category_id: ' Category ' },
  { description: null },
  { description: '' },
  { sku: null },
  { sku: '' },
  { sale_price: 0 },
  { default_purchase_cost: 0 },
  { minimum_stock: 0 },
  { is_active: false },
  { is_active: true },
  { ...input, is_active: false },
  { description: undefined, minimum_stock: undefined, sale_price: 1.01 },
]) {
  test(`BF171 update preserves defined allowlisted partial fields ${JSON.stringify(patch)}`, async () => {
    const h = boundary();
    await invoke(h.repo, 'update', { ...patch, ...extras });
    assert.deepEqual(h.calls[0], ['from', 'products']);
    assert.deepEqual(h.calls[1], [
      'update',
      Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    ]);
    assert.deepEqual(h.calls.slice(2, 4), [
      ['eq', 'business_id', ' Original B '],
      ['eq', 'id', ' Original P '],
    ]);
    assert.equal(h.calls[4][1].replace(/\s/g, ''), columns);
    assert.deepEqual(h.calls.slice(5), [['maybeSingle']]);
  });
}

for (const method of ['getById', 'create', 'update', 'listByBusiness']) {
  test(`BF171 ${method} preserves SDK response/error metadata and unexpected rejection`, async () => {
    const error = { code: '42501', message: 'private', details: 'private', hint: 'private' };
    const result = response(null, error, 403);
    const h = boundary(result);
    assert.equal(await invoke(h.repo, method), result);
    assert.equal(result.error, error);
    const thrown = new Error('private');
    const rejected = boundary(null, thrown);
    await assert.rejects(
      async () => await invoke(rejected.repo, method),
      (value) => value === thrown,
    );
  });
}

test('BF171 installed SDK serializes exact projection/filters/bodies once per operation, with HTTP mocked', async () => {
  const requests = [];
  const sdk = createClient('https://synthetic.supabase.co', 'public-test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, options) => {
        requests.push({ url: new URL(url), options });
        return new Response(
          JSON.stringify(
            options.method === 'GET' && new URL(url).searchParams.has('order') ? [] : row,
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    },
  });
  try {
    const repo = repository(sdk);
    assert.deepEqual((await repo.getById('b', 'p')).data, row);
    await repo.create('b', { ...input, ...extras, is_active: false });
    await repo.update('b', 'p', {
      category_id: null,
      description: '',
      sku: null,
      is_active: false,
      ...extras,
    });
    const empty = await repo.listByBusiness('b', {
      status: 'inactive',
      page: 2,
      pageSize: 2,
      categoryId: 'c',
    });
    assert.deepEqual(empty.data, []);
    assert.equal(empty.error, null);
    assert.equal(requests.length, 4);
    for (const request of requests) {
      assert.equal(request.url.pathname, '/rest/v1/products');
      assert.equal(request.url.searchParams.get('select'), columns);
      assert(!request.options.headers.get('Prefer')?.includes('count='));
    }
    assert.equal(requests[0].url.searchParams.get('business_id'), 'eq.b');
    assert.equal(requests[0].url.searchParams.get('id'), 'eq.p');
    assert.equal(requests[0].url.searchParams.has('is_active'), false);
    assert.deepEqual(JSON.parse(requests[1].options.body), { business_id: 'b', ...input });
    assert.equal(requests[1].options.headers.get('Accept'), 'application/vnd.pgrst.object+json');
    assert.deepEqual(JSON.parse(requests[2].options.body), {
      category_id: null,
      description: '',
      sku: null,
      is_active: false,
    });
    assert.equal(requests[2].url.searchParams.get('business_id'), 'eq.b');
    assert.equal(requests[2].url.searchParams.get('id'), 'eq.p');
    assert.equal(requests[3].url.searchParams.get('business_id'), 'eq.b');
    assert.equal(requests[3].url.searchParams.get('is_active'), 'eq.false');
    assert.equal(requests[3].url.searchParams.get('category_id'), 'eq.c');
    assert.equal(requests[3].url.searchParams.get('order'), 'name.asc,id.asc');
    assert.equal(requests[3].url.searchParams.get('offset'), '2');
    assert.equal(requests[3].url.searchParams.get('limit'), '3');
  } finally {
    sdk.auth.stopAutoRefresh();
  }
});

test('BF171 type boundary reuses BF170 row/inputs and returns typed raw SDK envelopes', () => {
  const virtualFile = path.join(root, 'tests/__bf171_type_contract__.ts');
  const source = `
    import { productsRepository as repo } from '@/features/products/repositories/productsRepository';
    import type { ProductRow,ProductListParams } from '@/features/products/types/product.types';
    import type { CreateProductInput,UpdateProductInput } from '@/features/products/schemas/product.schema';
    type Equal<A,B>=(<T>()=>T extends A?1:2)extends(<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true>=T;
    export type CreateInput=Assert<Equal<Parameters<typeof repo.create>[1],CreateProductInput>>;
    export type UpdateInput=Assert<Equal<Parameters<typeof repo.update>[2],UpdateProductInput>>;
    export type ListParams=Assert<Equal<Parameters<typeof repo.listByBusiness>[1],ProductListParams>>;
    export type Detail=Assert<Equal<Awaited<ReturnType<typeof repo.getById>>['data'],ProductRow|null>>;
    export type Create=Assert<Equal<Awaited<ReturnType<typeof repo.create>>['data'],ProductRow|null>>;
    export type Update=Assert<Equal<Awaited<ReturnType<typeof repo.update>>['data'],ProductRow|null>>;
    export type List=Assert<Equal<Awaited<ReturnType<typeof repo.listByBusiness>>['data'],ProductRow[]|null>>;
    // @ts-expect-error No physical deletion API.
    repo.delete('b','p');
    // @ts-expect-error No inventory mutation API.
    repo.updateStock('b','p',5);
    // @ts-expect-error Resolved pagination and status required; repository invents no service defaults.
    repo.listByBusiness('b',{});
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const getSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : getSource(file, ...args);
  const program = ts.createProgram(
    [virtualFile, ...fileNames.filter((file) => file.endsWith('.d.ts'))],
    { ...options, noEmit: true },
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (file) => file,
      getNewLine: () => '\n',
    }),
  );
});
