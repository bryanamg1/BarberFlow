/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../src/features/products');
function load(file, dependencies) {
  const filename = path.resolve(root, file + '.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name in dependencies) return dependencies[name];
      if (name === 'zod') return require(name);
      assert(name.startsWith('.'), `Unexpected import ${name}`);
      return load(path.relative(root, path.resolve(path.dirname(filename), name)), dependencies);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const rows = [
  {
    id: 'cat-201',
    business_id: 'b',
    name: 'Archivada fuera de primera página',
    is_active: false,
    created_at: 't',
    updated_at: 't',
  },
  {
    id: 'cat-202',
    business_id: 'b',
    name: 'Activa',
    is_active: true,
    created_at: 't',
    updated_at: 't',
  },
];
function transport() {
  const calls = [];
  const client = createClient('https://d14.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        calls.push({ url: new URL(url), method: init.method });
        return new Response(JSON.stringify(rows), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  return {
    calls,
    repo: load('repositories/productCategoriesRepository', {
      '@/lib/supabase/client': { supabase: client },
    }).productCategoriesRepository,
  };
}
test('empty IDs perform zero SDK requests', async () => {
  const a = transport();
  assert.deepEqual((await a.repo.getByIds('b', [])).data, []);
  assert.equal(a.calls.length, 0);
});
for (const input of [['cat-201'], ['cat-202', 'cat-201'], ['cat-201', 'cat-201', 'cat-202']])
  test(`one batch for ${input.length} input IDs with tenant and exact existing projection`, async () => {
    const a = transport();
    const result = await a.repo.getByIds('b', input);
    assert.deepEqual(result.data, rows);
    assert.equal(a.calls.length, 1);
    const u = a.calls[0].url;
    assert.equal(u.pathname, '/rest/v1/product_categories');
    assert.equal(a.calls[0].method, 'GET');
    assert.equal(u.searchParams.get('business_id'), 'eq.b');
    assert.equal(
      u.searchParams.get('select').replaceAll(' ', ''),
      'id,business_id,name,is_active,created_at,updated_at',
    );
    assert.equal(u.searchParams.has('is_active'), false);
    assert.equal(u.searchParams.has('offset'), false);
    assert.equal(u.searchParams.has('limit'), false);
    const selected = u.searchParams.get('id');
    for (const id of new Set(input)) assert.equal(selected.split(id).length - 1, 1);
  });
function service(result = { data: rows, error: null, status: 200 }) {
  const calls = [];
  return {
    calls,
    api: load('services/productCategoriesService', {
      '../repositories/productCategoriesRepository': {
        productCategoriesRepository: {
          getByIds: async (...args) => {
            calls.push(args);
            if (result instanceof Error) throw result;
            return result;
          },
        },
      },
    }).productCategoriesService,
  };
}
test('service preserves active/archived rows and deduplicates without rewriting IDs', async () => {
  const a = service();
  assert.deepEqual((await a.api.getByIds(' b ', [' old ', ' old ', 'x'])).data, rows);
  assert.deepEqual(a.calls, [[' b ', [' old ', 'x']]]);
});
test('service empty input does not invoke repository', async () => {
  const a = service();
  assert.deepEqual(await a.api.getByIds('b', []), { data: [], error: null });
  assert.equal(a.calls.length, 0);
});
for (const ids of [[' '], [null], null])
  test(`invalid IDs ${JSON.stringify(ids)} never query`, async () => {
    const a = service();
    assert.equal((await a.api.getByIds('b', ids)).error.code, 'UNKNOWN_ERROR');
    assert.equal(a.calls.length, 0);
  });
test('missing category stays successful empty, not uncategorized fabrication', async () => {
  const a = service({ data: [], error: null, status: 200 });
  assert.deepEqual(await a.api.getByIds('b', ['missing']), { data: [], error: null });
});
test('invalid business never queries', async () => {
  const a = service();
  assert.equal((await a.api.getByIds(' ', ['x'])).error.code, 'PRODUCT_CATEGORY_ACCESS_DENIED');
  assert.equal(a.calls.length, 0);
});
for (const [status, code, expected] of [
  [0, '42501', 'NETWORK_ERROR'],
  [403, '42501', 'PRODUCT_CATEGORY_ACCESS_DENIED'],
  [500, 'x', 'UNKNOWN_ERROR'],
])
  test(`safe structured batch error ${status}`, async () => {
    const a = service({ data: null, error: { code, message: 'secret SQL' }, status });
    const out = await a.api.getByIds('b', ['x']);
    assert.equal(out.error.code, expected);
    assert.ok(!JSON.stringify(out).includes('secret'));
  });
test('unexpected rejection stays safe', async () => {
  const a = service(new Error('secret SQL'));
  assert.equal((await a.api.getByIds('b', ['x'])).error.code, 'UNKNOWN_ERROR');
});
test('batch key uses deterministic ID set plus actor/member/business', () => {
  const { productCategoriesKeys: k } = load('constants/productCategoriesKeys', {});
  const s = { businessId: 'b', userId: 'u', membershipId: 'm' };
  assert.deepEqual(k.batch(s, ['z', 'a', 'z']), k.batch(s, ['a', 'z']));
  for (const changed of [
    { ...s, businessId: 'other' },
    { ...s, userId: 'other' },
    { ...s, membershipId: 'other' },
  ])
    assert.notDeepEqual(k.batch(s, ['a']), k.batch(changed, ['a']));
  assert.notDeepEqual(k.batch(s, ['a']), k.batch(s, ['z']));
});
