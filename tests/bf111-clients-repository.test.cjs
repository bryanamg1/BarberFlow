/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/clients/repositories/clientsRepository.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const businessId = '00000000-0000-4000-8000-000000000111';
const clientId = '00000000-0000-4000-8000-000000001111';
const columns =
  'id,business_id,first_name,last_name,phone,email,instagram,birth_date,notes,preferences,is_active,created_at,updated_at';
const row = Object.freeze({
  id: clientId,
  business_id: businessId,
  first_name: '  Synthetic  ',
  last_name: null,
  phone: ' + arbitrary phone ',
  email: '',
  instagram: ' @Mixed ',
  birth_date: '2000-02-29',
  notes: '   ',
  preferences: null,
  is_active: false,
  created_at: '2026-01-01T00:00:00+00:00',
  updated_at: '2026-01-02T00:00:00.123456+00:00',
});
const createInput = Object.freeze({
  first_name: row.first_name,
  last_name: row.last_name,
  phone: row.phone,
  email: row.email,
  instagram: row.instagram,
  birth_date: row.birth_date,
  notes: row.notes,
  preferences: row.preferences,
});
const extra = {
  id: 'untrusted-id',
  business_id: 'untrusted-tenant',
  is_active: false,
  created_at: 'untrusted-date',
  updated_at: 'untrusted-date',
  unknown: 'untrusted',
  role: 'OWNER',
};

function loadRepository(client) {
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
    (name) => {
      // Type-only schema imports must disappear; no Zod/Auth/Context/alternate client at runtime.
      if (name === './clientSearchFilter') {
        const helperFile = path.join(path.dirname(filename), 'clientSearchFilter.ts');
        const helper = { exports: {} };
        const code = ts.transpileModule(fs.readFileSync(helperFile, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText;
        vm.runInThisContext(`(function(require,module,exports){${code}\n})`, {
          filename: helperFile,
        })(() => assert.fail('Pure filter'), helper, helper.exports);
        return helper.exports;
      }
      assert.equal(name, '@/lib/supabase/client');
      return { supabase: client };
    },
    module,
    module.exports,
  );
  assert.deepEqual(Object.keys(module.exports), ['clientsRepository']);
  assert.deepEqual(Object.keys(module.exports.clientsRepository), [
    'getById',
    'create',
    'update',
    'listByBusiness',
    'searchByBusiness',
  ]);
  return module.exports.clientsRepository;
}

function boundary(result, failure) {
  const calls = [];
  const query = {
    select(value) {
      calls.push(['select', value.replace(/\s/g, '')]);
      return this;
    },
    eq(key, value) {
      calls.push(['eq', key, value]);
      return this;
    },
    insert(value) {
      calls.push(['insert', value]);
      return this;
    },
    update(value) {
      calls.push(['update', value]);
      return this;
    },
    single() {
      calls.push(['single']);
      return this;
    },
    maybeSingle() {
      calls.push(['maybeSingle']);
      return this;
    },
    overrideTypes() {
      return this;
    },
    then(resolve, reject) {
      return (failure ? Promise.reject(failure) : Promise.resolve(result)).then(resolve, reject);
    },
  };
  return {
    calls,
    repository: loadRepository({
      from(table) {
        calls.push(['from', table]);
        return query;
      },
    }),
  };
}
function invoke(repository, operation, input = createInput, business = businessId, id = clientId) {
  if (operation === 'getById') return repository.getById(business, id);
  if (operation === 'create') return repository.create(business, input);
  return repository.update(business, id, input);
}
function response(data, error = null) {
  return {
    data,
    error,
    count: null,
    status: error ? 403 : 200,
    statusText: error ? 'Forbidden' : 'OK',
  };
}

test('BF-111: inert import preserves original operations, no Zod or Auth runtime dependency', () => {
  loadRepository(new Proxy({}, { get: () => assert.fail('No client access during import') }));
});

test('BF-111: getById uses both exact IDs, explicit projection and maybeSingle, including archived rows', async () => {
  for (const [business, id] of [
    [businessId, clientId],
    [' MixedCase-Tenant ', ' MixedCase-Client '],
  ]) {
    const result = response(row);
    const h = boundary(result);
    assert.equal(await h.repository.getById(business, id), result);
    assert.equal(result.data, row);
    assert.deepEqual(h.calls, [
      ['from', 'clients'],
      ['select', columns],
      ['eq', 'business_id', business],
      ['eq', 'id', id],
      ['maybeSingle'],
    ]);
    assert.equal(result.data.is_active, false);
    assert.equal(result.data.birth_date, '2000-02-29');
    assert.equal(result.data.updated_at, row.updated_at);
  }
});

test('BF-111: create allowlist preserves all functional values and cannot overwrite ownership/defaults', async () => {
  const input = Object.freeze({ ...createInput, ...extra });
  const result = response(row);
  const h = boundary(result);
  assert.equal(await h.repository.create(' MixedCase-Tenant ', input), result);
  assert.equal(result.data, row);
  assert.deepEqual(h.calls, [
    ['from', 'clients'],
    ['insert', { business_id: ' MixedCase-Tenant ', ...createInput }],
    ['select', columns],
    ['single'],
  ]);
  assert.equal(input.business_id, 'untrusted-tenant');
});

test('BF-111: minimal create does not inject defaults or replace omitted nullable values', async () => {
  const h = boundary(response(row));
  await h.repository.create(businessId, { first_name: 'A' });
  const payload = h.calls.find(([name]) => name === 'insert')[1];
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    business_id: businessId,
    first_name: 'A',
  });
  for (const field of ['id', 'is_active', 'created_at', 'updated_at', 'unknown'])
    assert(!Object.hasOwn(payload, field));
  for (const field of [
    'last_name',
    'phone',
    'email',
    'instagram',
    'birth_date',
    'notes',
    'preferences',
  ]) {
    assert.equal(payload[field], undefined);
  }
});

test('BF-111: update permits exactly nine functional fields and preserves null/false/empty/whitespace', async () => {
  const input = Object.freeze({ ...createInput, ...extra });
  const result = response(row);
  const h = boundary(result);
  assert.equal(
    await h.repository.update(' MixedCase-Tenant ', ' MixedCase-Client ', input),
    result,
  );
  assert.equal(result.data, row);
  assert.deepEqual(h.calls, [
    ['from', 'clients'],
    ['update', { ...createInput, is_active: false }],
    ['eq', 'business_id', ' MixedCase-Tenant '],
    ['eq', 'id', ' MixedCase-Client '],
    ['select', columns],
    ['maybeSingle'],
  ]);
  assert.equal(input.id, 'untrusted-id');
});

test('BF-111: each partial update sends only its defined field, with no truthiness filtering', async () => {
  const allowed = { ...createInput, is_active: false };
  const undefinedFields = Object.fromEntries(Object.keys(allowed).map((key) => [key, undefined]));
  for (const [key, value] of Object.entries(allowed)) {
    const h = boundary(response(row));
    await h.repository.update(businessId, clientId, { ...undefinedFields, [key]: value });
    assert.deepEqual(h.calls.find(([name]) => name === 'update')[1], { [key]: value });
  }
  for (const key of [
    'last_name',
    'phone',
    'email',
    'instagram',
    'birth_date',
    'notes',
    'preferences',
  ]) {
    const h = boundary(response(row));
    await h.repository.update(businessId, clientId, { [key]: null });
    assert.deepEqual(h.calls.find(([name]) => name === 'update')[1], { [key]: null });
  }
  const h = boundary(response(row));
  await h.repository.update(businessId, clientId, { is_active: true });
  assert.deepEqual(h.calls.find(([name]) => name === 'update')[1], { is_active: true });
});

test('BF-111: internal empty/undefined/unknown-only misuse adds no fallback or domain validation', async () => {
  for (const input of [
    {},
    { phone: undefined, is_active: undefined },
    { id: 'extra', business_id: 'extra' },
  ]) {
    const result = response(null);
    const h = boundary(result);
    assert.equal(await h.repository.update(businessId, clientId, input), result);
    assert.deepEqual(h.calls.find(([name]) => name === 'update')[1], {});
    assert.equal(h.calls.filter(([name]) => name === 'from').length, 1);
  }
});

for (const operation of ['getById', 'create', 'update']) {
  test(`BF-111: ${operation} preserves SDK error/metadata and unexpected rejected promises`, async () => {
    const error = { code: '42501', message: 'Synthetic denial', details: '', hint: '' };
    const result = response(null, error);
    const received = await invoke(boundary(result).repository, operation);
    assert.equal(received, result);
    assert.equal(received.error, error);
    const failure = new Error('Synthetic rejection');
    await assert.rejects(
      async () => await invoke(boundary(null, failure).repository, operation),
      (e) => e === failure,
    );
  });
  test(`BF-111: ${operation} preserves synchronous builder failures without wrapping`, () => {
    const failure = new Error('Synthetic builder failure');
    const repository = loadRepository({
      from() {
        throw failure;
      },
    });
    assert.throws(
      () => invoke(repository, operation),
      (e) => e === failure,
    );
  });
}
for (const operation of ['getById', 'update']) {
  test(`BF-111: ${operation} zero visible rows remains successful null without a second query`, async () => {
    const result = response(null);
    const h = boundary(result);
    assert.equal(await invoke(h.repository, operation), result);
    assert.equal(h.calls.filter(([name]) => name === 'from').length, 1);
  });
}

for (const operation of ['getById', 'create', 'update']) {
  for (const scenario of [
    'row',
    'error',
    ...(operation === 'create' ? [] : ['empty', 'multiple']),
  ]) {
    test(`BF-111: installed SDK ${operation}/${scenario} uses one scoped request and exact payload/projection`, async () => {
      const requests = [];
      const error = { code: '42501', message: 'Synthetic denial', details: '', hint: '' };
      const payload =
        scenario === 'error'
          ? error
          : scenario === 'empty'
            ? []
            : scenario === 'multiple'
              ? [row, row]
              : operation === 'create'
                ? row
                : [row];
      const client = createClient('https://synthetic.supabase.co', 'synthetic-public-key', {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        global: {
          fetch: async (input, options) => {
            const url = new URL(input);
            requests.push({ url, options });
            return new Response(JSON.stringify(payload), {
              status: scenario === 'error' ? 403 : operation === 'create' ? 201 : 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        },
      });
      try {
        const repository = loadRepository(client);
        const result = await invoke(repository, operation, { ...createInput, ...extra });
        assert.equal(requests.length, 1);
        const { url, options } = requests[0];
        assert.equal(url.origin, 'https://synthetic.supabase.co');
        assert.equal(url.pathname, '/rest/v1/clients');
        assert.equal(
          options.method,
          operation === 'getById' ? 'GET' : operation === 'create' ? 'POST' : 'PATCH',
        );
        assert.equal(url.searchParams.get('select'), columns);
        assert.deepEqual(
          [...url.searchParams.keys()].sort(),
          operation === 'create' ? ['select'] : ['business_id', 'id', 'select'],
        );
        if (operation !== 'create') {
          assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
          assert.equal(url.searchParams.get('id'), `eq.${clientId}`);
        }
        const headers = new Headers(options.headers);
        assert.equal(headers.get('apikey'), 'synthetic-public-key');
        assert.equal(headers.get('authorization'), 'Bearer synthetic-public-key');
        assert(!headers.has('range'));
        assert.equal(
          headers.get('accept')?.includes('vnd.pgrst.object') ?? false,
          operation === 'create',
        );
        if (operation === 'getById') assert.equal(options.body, undefined);
        else {
          assert.deepEqual(
            JSON.parse(options.body),
            operation === 'create'
              ? { business_id: businessId, ...createInput }
              : { ...createInput, is_active: false },
          );
          assert(headers.get('prefer').includes('return=representation'));
        }
        if (scenario === 'error') {
          assert.equal(result.data, null);
          assert.deepEqual(result.error, error);
          assert.equal(result.status, 403);
        } else if (scenario === 'multiple') {
          assert.equal(result.data, null);
          assert.equal(result.error.code, 'PGRST116');
        } else {
          assert.deepEqual(result.data, scenario === 'empty' ? null : row);
          assert.equal(result.error, null);
        }
      } finally {
        client.auth.stopAutoRefresh();
      }
    });
  }
}

test('BF-111: public types expose exact ClientRow, BF-110 inputs and nullable SDK results', () => {
  const virtualFile = path.join(root, 'tests/__bf111_type_contract__.ts');
  const source = `
    import { clientsRepository, type ClientRow } from '@/features/clients/repositories/clientsRepository';
    import type { CreateClientInput, UpdateClientInput } from '@/features/clients/schemas/client.schema';
    import type { PostgrestError } from '@supabase/supabase-js';
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    type Expected = { id:string; business_id:string; first_name:string; last_name:string|null;
      phone:string|null; email:string|null; instagram:string|null; birth_date:string|null; notes:string|null;
      preferences:string|null; is_active:boolean; created_at:string; updated_at:string };
    export type Shape = Assert<Equal<ClientRow, Expected>>;
    export type API = Assert<Equal<keyof typeof clientsRepository, 'getById'|'create'|'update'|'listByBusiness'|'searchByBusiness'>>;
    export type GetInput = Assert<Equal<Parameters<typeof clientsRepository.getById>, [businessId:string,clientId:string]>>;
    export type CreateInput = Assert<Equal<Parameters<typeof clientsRepository.create>, [businessId:string,input:CreateClientInput]>>;
    export type UpdateInput = Assert<Equal<Parameters<typeof clientsRepository.update>, [businessId:string,clientId:string,input:UpdateClientInput]>>;
    type Results = { [K in keyof typeof clientsRepository]: Awaited<ReturnType<typeof clientsRepository[K]>> };
    export type Data = Assert<Equal<{ [K in keyof Results]: Results[K]['data'] }, {
      getById:ClientRow|null; create:ClientRow|null; update:ClientRow|null; listByBusiness:ClientRow[]|null; searchByBusiness:ClientRow[]|null
    }>>;
    export type Errors = Assert<Equal<{ [K in keyof Results]: Results[K]['error'] }, {
      getById:PostgrestError|null; create:PostgrestError|null; update:PostgrestError|null; listByBusiness:PostgrestError|null; searchByBusiness:PostgrestError|null
    }>>;
    // @ts-expect-error Civil date stays string, not Date.
    const birth: ClientRow['birth_date'] = new Date();
    // @ts-expect-error Timestamps stay strings.
    const timestamp: ClientRow['updated_at'] = new Date();
    // @ts-expect-error Name is required in create.
    clientsRepository.create('tenant', {});
    // @ts-expect-error No tenant field in update input.
    clientsRepository.update('tenant','client',{business_id:'other'});
    // @ts-expect-error No delete API.
    clientsRepository.delete('tenant','client');
    void birth; void timestamp;
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : original(file, ...args);
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
