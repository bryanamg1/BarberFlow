/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../src');
function load(file, client, cache = new Map()) {
  const filename = path.resolve(root, file + '.ts');
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name === '@/lib/supabase/client') return { supabase: client };
      if (name === 'zod') return require('zod');
      const target = name.startsWith('@/')
        ? name.slice(2)
        : path.relative(root, path.resolve(path.dirname(filename), name));
      return load(target, client, cache);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const members = [
  { id: 'a', role: 'OWNER', is_active: true },
  { id: 'b', role: 'BARBER', is_active: true },
];
function harness(data = members, error = null, status = 200, reject = false) {
  const requests = [];
  const client = createClient('http://127.0.0.1:9999', 'test-only-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: new URL(url), method: init?.method ?? 'GET' });
        if (reject) throw new Error('private SQL internal');
        return new Response(JSON.stringify(error ?? data), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  return {
    requests,
    repo: load('features/business/repositories/businessDirectoryRepository', client)
      .businessDirectoryRepository,
    service: load('features/business/services/businessDirectoryService', client)
      .businessDirectoryService,
  };
}
test('BF157 D08 one GET with exact projection, tenant, active roles, stable order; no profiles', async () => {
  const h = harness();
  const r = await h.repo.listWorkingMembers(' business ');
  assert.deepEqual(r.data, members);
  assert.equal(h.requests.length, 1);
  const { url, method } = h.requests[0];
  assert.equal(method, 'GET');
  assert.equal(url.pathname, '/rest/v1/business_members');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    select: 'id,role,is_active',
    business_id: 'eq. business ',
    is_active: 'eq.true',
    role: 'in.(OWNER,BARBER)',
    order: 'id.asc',
  });
});
test('BF157 BARBER restriction uses only the membership supplied by authorized context', async () => {
  const h = harness([members[1]]);
  const r = await h.repo.listWorkingMembers('b', 'own-membership');
  assert.equal(r.error, null);
  assert.equal(h.requests[0].url.searchParams.get('id'), 'eq.own-membership');
});
test('BF157 empty directory succeeds without fabricated professional', async () => {
  assert.deepEqual(await harness([]).service.listWorkingMembers('b'), { data: [], error: null });
});
test('BF157 directory retains safe exact operational row data and no foreign PII fields', async () => {
  const r = await harness(
    members.map((m) => ({ ...m, private_email: 'must not propagate' })),
  ).service.listWorkingMembers('b');
  assert.deepEqual(r, { data: members, error: null });
});
for (const invalid of [
  [{ id: 'a', role: 'MANAGER', is_active: true }],
  [{ id: 'a', role: 'OWNER', is_active: false }],
  null,
])
  test(`BF157 rejects unusable directory ${JSON.stringify(invalid)}`, async () => {
    const r = await harness(invalid).service.listWorkingMembers('b');
    assert.equal(r.data, null);
    assert(r.error);
  });
test('BF157 a foreign membership cannot populate the BARBER directory', async () => {
  const r = await harness().service.listWorkingMembers('b', 'own');
  assert.equal(r.data, null);
  assert.equal(r.error.code, 'UNKNOWN_ERROR');
});
test('BF157 invalid tenant/filter performs no transport and does not trim identifiers', async () => {
  const h = harness();
  for (const args of [[''], ['  '], ['b', '']])
    assert((await h.service.listWorkingMembers(...args)).error);
  assert.equal(h.requests.length, 0);
});
for (const status of [401, 403, 500])
  test(`BF157 ${status} has safe error without provider prose`, async () => {
    const r = await harness(
      null,
      { code: status === 403 ? '42501' : 'unexpected', message: 'private SQL internal' },
      status,
    ).service.listWorkingMembers('b');
    assert.equal(r.data, null);
    assert(!r.error.message.includes('private'));
    assert.equal(r.error.code, status === 500 ? 'UNKNOWN_ERROR' : 'BUSINESS_ACCESS_DENIED');
  });
test('BF157 transport failure never leaks provider detail', async () => {
  const r = await harness(null, null, 200, true).service.listWorkingMembers('b');
  assert.equal(r.data, null);
  assert(r.error);
  assert(!r.error.message.includes('private'));
});
test('BF157 repository retains SDK error metadata while service normalizes', async () => {
  const r = await harness(
    null,
    { code: '42501', message: 'raw provider' },
    403,
  ).repo.listWorkingMembers('b');
  assert.equal(r.status, 403);
  assert.equal(r.error.message, 'raw provider');
});
