/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/business/repositories/businessRepository.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const userId = '00000000-0000-4000-8000-000000000100';
const columns =
  'id,user_id,business_id,role,is_active,business:businesses(id,name,currency_code,timezone,is_active)';
const memberships = [
  {
    id: 'synthetic-membership-barber',
    user_id: userId,
    business_id: 'synthetic-business-a',
    role: 'BARBER',
    is_active: true,
    business: {
      id: 'synthetic-business-a',
      name: 'Synthetic business',
      currency_code: 'ARS',
      timezone: 'America/Argentina/Buenos_Aires',
      is_active: false,
    },
  },
  {
    id: 'synthetic-membership-owner',
    user_id: userId,
    business_id: 'synthetic-business-b',
    role: 'OWNER',
    is_active: true,
    business: null,
  },
];

function loadRepository(client) {
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
    (name) => {
      // No Auth, hooks, role services, alternate clients or other data modules may be imported.
      assert.equal(name, '@/lib/supabase/client');
      return { supabase: client };
    },
    module,
    module.exports,
  );
  assert.deepEqual(Object.keys(module.exports), ['businessRepository']);
  assert.deepEqual(Object.keys(module.exports.businessRepository), [
    'getActiveMembershipsByUserId',
  ]);
  return module.exports.businessRepository;
}

function boundary(result, failure) {
  const calls = [];
  const query = {
    select(value) {
      calls.push(['select', value.replace(/\s/g, '')]);
      return this;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return this;
    },
    overrideTypes() {
      return this;
    },
    then(resolve, reject) {
      return (failure ? Promise.reject(failure) : Promise.resolve(result)).then(resolve, reject);
    },
  };
  const repository = loadRepository({
    from(table) {
      calls.push(['from', table]);
      return query;
    },
  });
  return { repository, calls };
}

test('BF-100: import performs no query or Auth work and exposes only the approved operation', () => {
  loadRepository(new Proxy({}, { get: () => assert.fail('No client access during import') }));
});

test('BF-100: one explicit active-user query preserves all memberships, roles, inactive businesses and null relations', async () => {
  const result = { data: memberships, error: null, count: null, status: 200, statusText: 'OK' };
  const h = boundary(result);
  assert.equal(await h.repository.getActiveMembershipsByUserId(userId), result);
  // Exact allowed query: no business-active filter, ordering, limit, single, role interpretation,
  // current-business selection, settings/hours request, write or privileged operation.
  assert.deepEqual(h.calls, [
    ['from', 'business_members'],
    ['select', columns],
    ['eq', 'user_id', userId],
    ['eq', 'is_active', true],
  ]);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].role, 'BARBER');
  assert.equal(result.data[1].role, 'OWNER');
  assert.equal(result.data[0].business.is_active, false);
  assert.equal(result.data[1].business, null);
});

test('BF-100: no memberships is the unchanged successful SDK empty array', async () => {
  const result = { data: [], error: null, count: null, status: 200, statusText: 'OK' };
  assert.equal(await boundary(result).repository.getActiveMembershipsByUserId(userId), result);
});

test('BF-100: original SDK errors and response metadata pass through without normalization', async () => {
  const error = { code: '42501', message: 'Synthetic denial', details: '', hint: '' };
  const result = { data: null, error, count: null, status: 403, statusText: 'Forbidden' };
  const received = await boundary(result).repository.getActiveMembershipsByUserId(userId);
  assert.equal(received, result);
  assert.equal(received.error, error);
});

test('BF-100: unexpected rejected SDK operations remain rejected', async () => {
  const failure = new Error('Synthetic unexpected rejection');
  const h = boundary(undefined, failure);
  await assert.rejects(
    async () => await h.repository.getActiveMembershipsByUserId(userId),
    (error) => error === failure,
  );
});

for (const [name, data, status] of [
  ['plural roles and nullable business', memberships, 200],
  ['empty result', [], 200],
  ['SDK error', { code: '42501', message: 'Synthetic denial', details: '', hint: '' }, 403],
]) {
  test(`BF-100: installed SDK sends one ordinary relational GET and preserves ${name}`, async () => {
    const requests = [];
    const client = createClient('https://synthetic.supabase.co', 'synthetic-public-key', {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, options) => {
          const url = new URL(input);
          requests.push(url);
          assert.equal(url.origin, 'https://synthetic.supabase.co');
          assert.equal(url.pathname, '/rest/v1/business_members');
          assert.equal(options.method, 'GET');
          assert.deepEqual([...url.searchParams.keys()].sort(), ['is_active', 'select', 'user_id']);
          assert.equal(url.searchParams.get('select'), columns);
          assert.equal(url.searchParams.get('user_id'), `eq.${userId}`);
          assert.equal(url.searchParams.get('is_active'), 'eq.true');
          const headers = new Headers(options.headers);
          assert.equal(headers.get('apikey'), 'synthetic-public-key');
          assert.equal(headers.get('authorization'), 'Bearer synthetic-public-key');
          assert(!headers.has('range'));
          assert(!headers.get('accept')?.includes('vnd.pgrst.object'));
          return new Response(JSON.stringify(data), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    });
    try {
      const result = await loadRepository(client).getActiveMembershipsByUserId(userId);
      assert.equal(requests.length, 1);
      if (status === 200) {
        assert.deepEqual(result.data, data);
        assert.equal(result.error, null);
      } else {
        assert.equal(result.data, null);
        assert.deepEqual(result.error, data);
        assert.equal(result.status, status);
      }
    } finally {
      client.auth.stopAutoRefresh();
    }
  });
}

test('BF-100: public TypeScript result is plural, nullable and role-safe without any', () => {
  const virtualFile = path.join(root, 'tests/__bf100_type_contract__.ts');
  const source = `
    import { businessRepository, type BusinessMembership } from '@/features/business/repositories/businessRepository';
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
      (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    type Result = Awaited<ReturnType<typeof businessRepository.getActiveMembershipsByUserId>>;
    export type Data = Assert<Equal<Result['data'], BusinessMembership[] | null>>;
    export type Role = Assert<Equal<BusinessMembership['role'], 'OWNER' | 'BARBER'>>;
    export type Nullable = Assert<Equal<Extract<BusinessMembership['business'], null>, null>>;
    export type Operations = Assert<Equal<keyof typeof businessRepository, 'getActiveMembershipsByUserId'>>;
    // @ts-expect-error Membership role does not accept unapproved roles.
    const invalidRole: BusinessMembership['role'] = 'ADMIN';
    void invalidRole;
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : originalGetSourceFile(file, ...args);
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
