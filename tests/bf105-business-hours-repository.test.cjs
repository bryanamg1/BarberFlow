/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/business/repositories/businessHoursRepository.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const businessId = '00000000-0000-4000-8000-000000000105';
const columns = 'id,business_id,day_of_week,open_time,close_time,is_closed';
const hours = [
  {
    id: 'synthetic-0',
    business_id: businessId,
    day_of_week: 0,
    open_time: '09:15:30.123456',
    close_time: '18:45:00',
    is_closed: false,
  },
  {
    id: 'synthetic-3',
    business_id: businessId,
    day_of_week: 3,
    open_time: '09:00:00',
    close_time: '09:00:00',
    is_closed: true,
  },
  {
    id: 'synthetic-6',
    business_id: businessId,
    day_of_week: 6,
    open_time: '18:00:00',
    close_time: '08:00:00',
    is_closed: true,
  },
];

function loadRepository(client) {
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
    (name) => {
      // No Auth/Context, timezone helpers, alternate clients or other data modules.
      assert.equal(name, '@/lib/supabase/client');
      return { supabase: client };
    },
    module,
    module.exports,
  );
  assert.deepEqual(Object.keys(module.exports), ['businessHoursRepository']);
  assert.deepEqual(Object.keys(module.exports.businessHoursRepository), ['getByBusinessId']);
  return module.exports.businessHoursRepository;
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
    order(column, options) {
      calls.push(['order', column, options]);
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

test('BF-105: import is inert and public API is read-only', () => {
  loadRepository(new Proxy({}, { get: () => assert.fail('No client access during import') }));
});

for (const id of [businessId, '00000000-0000-4000-8000-000000000205', ' MixedCase-ID ']) {
  test(`BF-105: exact plural query preserves supplied ID ${JSON.stringify(id)} and sparse hours`, async () => {
    const data = hours.map((row) => ({ ...row, business_id: id }));
    const result = { data, error: null, count: null, status: 200, statusText: 'OK' };
    const h = boundary(result);
    assert.equal(await h.repository.getByBusinessId(id), result);
    assert.equal(result.data, data);
    // Exact chain excludes wildcard/timestamps/joins, membership/role checks, limit,
    // single/maybeSingle, other tables, writes, second query and client-side authorization.
    assert.deepEqual(h.calls, [
      ['from', 'business_hours'],
      ['select', columns],
      ['eq', 'business_id', id],
      ['order', 'day_of_week', { ascending: true }],
    ]);
    assert.deepEqual(
      data.map((row) => row.day_of_week),
      [0, 3, 6],
    );
    assert.equal(data[0].open_time, '09:15:30.123456');
    assert.equal(data[0].is_closed, false);
    assert.equal(data[1].is_closed, true);
    assert.equal(data[1].open_time, '09:00:00');
    assert.equal(data[1].close_time, '09:00:00');
    assert.equal(data[2].is_closed, true);
    assert.equal(data[2].open_time, '18:00:00');
    assert.equal(data[2].close_time, '08:00:00');
  });
}

test('BF-105: ordering belongs to SDK query, never an in-memory sort/filter or day completion', async () => {
  const data = Object.freeze([Object.freeze({ ...hours[2] }), Object.freeze({ ...hours[0] })]);
  const result = { data, error: null, count: null, status: 200, statusText: 'OK' };
  const received = await boundary(result).repository.getByBusinessId(businessId);
  assert.equal(received, result);
  assert.equal(received.data, data);
  assert.deepEqual(
    received.data.map((row) => row.day_of_week),
    [6, 0],
  );
});

test('BF-105: zero visible rows preserves successful empty array without defaults or fallback', async () => {
  const result = { data: [], error: null, count: null, status: 200, statusText: 'OK' };
  const h = boundary(result);
  assert.equal(await h.repository.getByBusinessId(businessId), result);
  assert.equal(h.calls.filter(([name]) => name === 'from').length, 1);
});

test('BF-105: original SDK error and response metadata are not normalized', async () => {
  const error = { code: '42501', message: 'Synthetic denial', details: '', hint: '' };
  const result = { data: null, error, count: null, status: 403, statusText: 'Forbidden' };
  const received = await boundary(result).repository.getByBusinessId(businessId);
  assert.equal(received, result);
  assert.equal(received.error, error);
});

test('BF-105: unexpected SDK rejection is neither caught nor wrapped', async () => {
  const failure = new Error('Synthetic unexpected rejection');
  await assert.rejects(
    async () => await boundary(undefined, failure).repository.getByBusinessId(businessId),
    (error) => error === failure,
  );
});

for (const [name, payload, status] of [
  ['sparse open/closed rows', hours, 200],
  ['zero rows', [], 200],
  ['SDK error', { code: '42501', message: 'Synthetic denial', details: '', hint: '' }, 403],
]) {
  test(`BF-105: installed SDK sends one ordered GET and preserves ${name}`, async () => {
    const requests = [];
    const client = createClient('https://synthetic.supabase.co', 'synthetic-public-key', {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, options) => {
          const url = new URL(input);
          requests.push(url);
          assert.equal(url.origin, 'https://synthetic.supabase.co');
          assert.equal(url.pathname, '/rest/v1/business_hours');
          assert.equal(options.method, 'GET');
          assert.deepEqual([...url.searchParams.keys()].sort(), ['business_id', 'order', 'select']);
          assert.equal(url.searchParams.get('select'), columns);
          assert.equal(url.searchParams.get('business_id'), `eq.${businessId}`);
          assert.equal(url.searchParams.get('order'), 'day_of_week.asc');
          const headers = new Headers(options.headers);
          assert.equal(headers.get('apikey'), 'synthetic-public-key');
          assert.equal(headers.get('authorization'), 'Bearer synthetic-public-key');
          assert(!headers.has('range'));
          assert(!headers.get('accept')?.includes('vnd.pgrst.object'));
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
      if (status === 200) {
        assert.deepEqual(result.data, payload);
        assert.equal(result.error, null);
      } else {
        assert.equal(result.data, null);
        assert.deepEqual(result.error, payload);
        assert.equal(result.status, status);
      }
    } finally {
      client.auth.stopAutoRefresh();
    }
  });
}

test('BF-105: public TypeScript contract is six fields, numeric days, string times and plural SDK data', () => {
  const virtualFile = path.join(root, 'tests/__bf105_type_contract__.ts');
  const source = `
    import { businessHoursRepository, type BusinessHour } from '@/features/business/repositories/businessHoursRepository';
    import type { PostgrestError } from '@supabase/supabase-js';
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
      (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    type Expected = { id: string; business_id: string; day_of_week: 0|1|2|3|4|5|6;
      open_time: string; close_time: string; is_closed: boolean };
    type Result = Awaited<ReturnType<typeof businessHoursRepository.getByBusinessId>>;
    export type Shape = Assert<Equal<BusinessHour, Expected>>;
    export type Data = Assert<Equal<Result['data'], BusinessHour[] | null>>;
    export type Error = Assert<Equal<Result['error'], PostgrestError | null>>;
    export type Operations = Assert<Equal<keyof typeof businessHoursRepository, 'getByBusinessId'>>;
    export type Input = Assert<Equal<Parameters<typeof businessHoursRepository.getByBusinessId>, [businessId: string]>>;
    // @ts-expect-error Day remains the schema's numeric range.
    const invalidDay: BusinessHour['day_of_week'] = 7;
    // @ts-expect-error No named weekdays.
    const namedDay: BusinessHour['day_of_week'] = 'MONDAY';
    // @ts-expect-error Closed rows still have nonnullable string times.
    const nullTime: BusinessHour['open_time'] = null;
    declare const row: BusinessHour;
    // @ts-expect-error No audit timestamp in this projection.
    row.created_at;
    // @ts-expect-error No audit timestamp in this projection.
    row.updated_at;
    // @ts-expect-error Read-only API.
    businessHoursRepository.updateHours;
    void invalidDay; void namedDay; void nullTime;
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
