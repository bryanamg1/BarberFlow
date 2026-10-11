/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const filename = path.join(
  root,
  'src/features/business/repositories/businessSettingsRepository.ts',
);
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const businessId = '00000000-0000-4000-8000-000000000104';
const columns =
  'business_id,appointment_interval_minutes,default_service_buffer_minutes,allow_overlapping_appointments,low_stock_notifications';
const settings = {
  business_id: businessId,
  appointment_interval_minutes: 15,
  default_service_buffer_minutes: 5,
  allow_overlapping_appointments: true,
  low_stock_notifications: false,
};

function loadRepository(client) {
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
    (name) => {
      // Fail if the repository imports Auth, Context, hooks or a privileged/alternate client.
      assert.equal(name, '@/lib/supabase/client');
      return { supabase: client };
    },
    module,
    module.exports,
  );
  assert.deepEqual(Object.keys(module.exports), ['businessSettingsRepository']);
  assert.deepEqual(Object.keys(module.exports.businessSettingsRepository), ['getByBusinessId']);
  return module.exports.businessSettingsRepository;
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
  const repository = loadRepository({
    from(table) {
      calls.push(['from', table]);
      return query;
    },
  });
  return { repository, calls };
}

test('BF-104: import is inert and public API is read-only', () => {
  loadRepository(new Proxy({}, { get: () => assert.fail('No client access during import') }));
});

for (const id of [businessId, '00000000-0000-4000-8000-000000000204', ' MixedCase-ID ']) {
  test(`BF-104: exact single nullable settings query preserves supplied ID ${JSON.stringify(id)}`, async () => {
    const data = { ...settings, business_id: id };
    const result = { data, error: null, count: null, status: 200, statusText: 'OK' };
    const h = boundary(result);
    assert.equal(await h.repository.getByBusinessId(id), result);
    assert.equal(result.data, data);
    // This exact allowed chain excludes timestamps, wildcard, joins, single(), order/limit,
    // membership/role checks, in-memory tenant filtering, writes and a second query.
    assert.deepEqual(h.calls, [
      ['from', 'business_settings'],
      ['select', columns],
      ['eq', 'business_id', id],
      ['maybeSingle'],
    ]);
  });
}

test('BF-104: no visible row remains successful null without fallback/defaults', async () => {
  const result = { data: null, error: null, count: null, status: 200, statusText: 'OK' };
  const h = boundary(result);
  assert.equal(await h.repository.getByBusinessId(businessId), result);
  assert.equal(h.calls.filter(([name]) => name === 'from').length, 1);
});

test('BF-104: original SDK error and response metadata pass through without domain normalization', async () => {
  const error = { code: '42501', message: 'Synthetic denial', details: '', hint: '' };
  const result = { data: null, error, count: null, status: 403, statusText: 'Forbidden' };
  const received = await boundary(result).repository.getByBusinessId(businessId);
  assert.equal(received, result);
  assert.equal(received.error, error);
});

test('BF-104: unexpected SDK rejection is not caught or wrapped', async () => {
  const failure = new Error('Synthetic unexpected rejection');
  const h = boundary(undefined, failure);
  await assert.rejects(
    async () => await h.repository.getByBusinessId(businessId),
    (error) => error === failure,
  );
});

for (const [name, payload, expectedData, status] of [
  ['existing row', [settings], settings, 200],
  ['missing or RLS-hidden row', [], null, 200],
  ['SDK error', { code: '42501', message: 'Synthetic denial', details: '', hint: '' }, null, 403],
]) {
  test(`BF-104: installed SDK performs one ordinary GET and handles ${name}`, async () => {
    const requests = [];
    const client = createClient('https://synthetic.supabase.co', 'synthetic-public-key', {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, options) => {
          const url = new URL(input);
          requests.push(url);
          assert.equal(url.origin, 'https://synthetic.supabase.co');
          assert.equal(url.pathname, '/rest/v1/business_settings');
          assert.equal(options.method, 'GET');
          assert.deepEqual([...url.searchParams.keys()].sort(), ['business_id', 'select']);
          assert.equal(url.searchParams.get('select'), columns);
          assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
          const headers = new Headers(options.headers);
          assert.equal(headers.get('apikey'), 'synthetic-public-key');
          assert.equal(headers.get('authorization'), 'Bearer synthetic-public-key');
          assert(!headers.has('range'));
          return new Response(JSON.stringify(payload), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    });
    try {
      const result = await loadRepository(client).getByBusinessId(businessId);
      assert.equal(requests.length, 1);
      assert.deepEqual(result.data, expectedData);
      if (status === 200) {
        assert.equal(result.error, null);
      } else {
        assert.deepEqual(result.error, payload);
        assert.equal(result.status, status);
      }
    } finally {
      client.auth.stopAutoRefresh();
    }
  });
}

test('BF-104: TypeScript exposes exactly five functional fields and a nullable SDK result', () => {
  const virtualFile = path.join(root, 'tests/__bf104_type_contract__.ts');
  const source = `
    import { businessSettingsRepository, type BusinessSettings } from '@/features/business/repositories/businessSettingsRepository';
    import type { PostgrestError } from '@supabase/supabase-js';
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
      (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    type Expected = {
      business_id: string;
      appointment_interval_minutes: number;
      default_service_buffer_minutes: number;
      allow_overlapping_appointments: boolean;
      low_stock_notifications: boolean;
    };
    type Result = Awaited<ReturnType<typeof businessSettingsRepository.getByBusinessId>>;
    export type Shape = Assert<Equal<BusinessSettings, Expected>>;
    export type Data = Assert<Equal<Result['data'], BusinessSettings | null>>;
    export type Error = Assert<Equal<Result['error'], PostgrestError | null>>;
    export type Operations = Assert<Equal<keyof typeof businessSettingsRepository, 'getByBusinessId'>>;
    export type Input = Assert<Equal<Parameters<typeof businessSettingsRepository.getByBusinessId>, [businessId: string]>>;
    declare const settings: BusinessSettings;
    // @ts-expect-error No audit timestamps in the functional projection.
    settings.created_at;
    // @ts-expect-error No audit timestamps in the functional projection.
    settings.updated_at;
    // @ts-expect-error No settings writes in BF-104.
    businessSettingsRepository.updateSettings;
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
