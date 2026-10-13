/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const feature = path.join(root, 'src/features/appointments');
const methods = [
  'listByRange',
  'getById',
  'getAvailability',
  'create',
  'reschedule',
  'updateNotes',
  'changeStatus',
];
const businessId = ' Original Business ';
const range = { from: '2026-10-13T00:00:00-03:00', to: '2026-10-14T00:00:00-03:00' };
const inputs = {
  listByRange: range,
  getById: ' Original Appointment ',
  getAvailability: { barberMemberId: ' Original Barber ', date: '2024-02-29', durationMinutes: 30 },
  create: {
    requestId: ' Request ',
    clientId: ' Client ',
    barberMemberId: ' Barber ',
    startAt: '2020-02-29T12:00:00.123456-03:00',
    items: [{ serviceId: ' Service ', quantity: 2 }],
  },
  reschedule: {
    appointmentId: ' Appointment ',
    barberMemberId: ' Barber ',
    startAt: '2020-02-29T12:00:00Z',
  },
  updateNotes: { appointmentId: ' Appointment ', notes: null },
  changeStatus: { appointmentId: ' Appointment ', status: 'CONFIRMED' },
};
const row = Object.freeze({
  id: 'appointment',
  business_id: businessId,
  client_id: 'client',
  barber_member_id: 'barber',
  start_at: range.from,
  end_at: range.to,
  status: 'COMPLETED',
  notes: null,
  created_by: 'creator',
  created_at: range.from,
  updated_at: range.from,
});
const line = Object.freeze({
  id: 'line',
  appointment_id: row.id,
  service_id: null,
  service_name_snapshot: 'Historical',
  unit_price_snapshot: 0.29,
  duration_minutes_snapshot: 30,
  quantity: 2,
  line_total: 0.58,
  created_at: range.from,
});
const detail = Object.freeze({ ...row, appointment_services: Object.freeze([line]) });
const slots = Object.freeze([{ start_at: row.start_at, end_at: row.end_at, available: false }]);
function load(repository) {
  const cache = new Map();
  function visit(relative) {
    const filename = path.resolve(feature, relative + '.ts');
    if (cache.has(filename)) return cache.get(filename);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    cache.set(filename, module.exports);
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
      (name) => {
        if (name === 'zod') return require('zod');
        if (name === '../repositories/appointmentsRepository')
          return { appointmentsRepository: repository };
        assert(name.startsWith('.'), `Unexpected runtime dependency ${name}`);
        return visit(path.relative(feature, path.resolve(path.dirname(filename), name)));
      },
      module,
      module.exports,
    );
    return module.exports;
  }
  const result = visit('services/appointmentsService');
  assert.deepEqual(Object.keys(result), ['appointmentsService']);
  assert.deepEqual(Object.keys(result.appointmentsService), methods);
  return result.appointmentsService;
}
function harness(handler) {
  const calls = [];
  const repository = Object.fromEntries(
    methods.map((method) => [
      method,
      (...args) => {
        calls.push([method, ...args]);
        if (handler) return handler(method, ...args);
        const data =
          method === 'listByRange'
            ? [row]
            : method === 'getAvailability'
              ? slots
              : ['getById', 'create'].includes(method)
                ? detail
                : row;
        return Promise.resolve({ data, error: null, status: 200, statusText: 'OK', count: null });
      },
    ]),
  );
  return { service: load(repository), calls };
}
const invoke = (h, method, input = inputs[method], tenant = businessId) =>
  h.service[method](tenant, input);
function error(result, code) {
  assert.equal(result.data, null);
  assert.equal(result.error.code, code);
  assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message']);
  assert.equal(typeof result.error.message, 'string');
  return result.error;
}

test('BF143 import is inert and exposes exactly seven service operations without Supabase/UI dependency', () => {
  load(
    new Proxy(
      {},
      {
        get() {
          assert.fail('No repository calls at import');
        },
      },
    ),
  );
});

test('BF143 all seven successful operations call repository once and return domain envelope', async () => {
  for (const method of methods) {
    const h = harness();
    const result = await invoke(h, method);
    assert.deepEqual(h.calls, [[method, businessId, inputs[method]]]);
    assert.equal(result.error, null);
    assert.deepEqual(Object.keys(result).sort(), ['data', 'error']);
    if (method === 'listByRange') assert.deepEqual(result.data, [row]);
    else {
      assert.equal(
        result.data,
        method === 'getAvailability'
          ? slots
          : ['getById', 'create'].includes(method)
            ? detail
            : row,
      );
    }
  }
});

test('BF143 rejects blank/nonstring business identifiers for every operation before access', async () => {
  for (const method of methods)
    for (const tenant of ['', ' \t ', null, undefined, 42, {}]) {
      const h = harness();
      error(await h.service[method](tenant, inputs[method]), 'INVALID_APPOINTMENT');
      assert.deepEqual(h.calls, []);
    }
});

test('BF143 invalid inputs on each operation fail safely without repository calls', async () => {
  const invalid = {
    listByRange: { from: range.to, to: range.from },
    getById: '  ',
    getAvailability: { ...inputs.getAvailability, durationMinutes: 0 },
    create: { ...inputs.create, items: [] },
    reschedule: { ...inputs.reschedule, startAt: 'local-no-zone' },
    updateNotes: { appointmentId: 'a' },
    changeStatus: { appointmentId: 'a', status: 'COMPLETED' },
  };
  for (const method of methods) {
    const h = harness();
    error(await invoke(h, method, invalid[method]), 'INVALID_APPOINTMENT');
    assert.deepEqual(h.calls, []);
  }
});

test('BF143 malformed/null caller objects fail as validation rather than causing access', async () => {
  for (const method of methods)
    for (const input of [null, undefined, false, 17, []]) {
      const h = harness();
      error(await h.service[method](businessId, input), 'INVALID_APPOINTMENT');
      assert.deepEqual(h.calls, []);
    }
});

test('BF143 range reuses zoned strict schema and passes original endpoints and empty collection unchanged', async () => {
  const data = [];
  const h = harness(() => Promise.resolve({ data, error: null, status: 200 }));
  const result = await invoke(h, 'listByRange', {
    ...range,
    business_id: 'foreign',
    status: 'PENDING',
  });
  assert.equal(result.data, data);
  assert.equal(result.error, null);
  assert.deepEqual(h.calls, [['listByRange', businessId, range]]);
  for (const invalid of [
    { from: range.from, to: range.from },
    { from: '2026-02-30T00:00:00Z', to: range.to },
  ]) {
    const bad = harness();
    error(await invoke(bad, 'listByRange', invalid), 'INVALID_APPOINTMENT');
    assert.deepEqual(bad.calls, []);
  }
});

test('BF143 detail missing and RLS-invisible produce same safe not-found error', async () => {
  const outcomes = [];
  for (const reason of ['missing', 'invisible']) {
    const h = harness(() => Promise.resolve({ data: null, error: null, status: 200, reason }));
    outcomes.push(error(await invoke(h, 'getById'), 'APPOINTMENT_NOT_FOUND'));
    assert.equal(h.calls.length, 1);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
  assert.equal(outcomes[0].message, 'No se encontró el turno o no está disponible.');
});

test('BF143 detail preserves nullable catalog history and all database statuses without filtering', async () => {
  for (const status of [
    'PENDING',
    'CONFIRMED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ]) {
    const data = { ...detail, status };
    const h = harness(() => Promise.resolve({ data, error: null, status: 200 }));
    assert.equal((await invoke(h, 'getById')).data, data);
    assert.equal(data.appointment_services[0], line);
  }
});

test('BF143 availability validates civil date, positive int4 duration and usable optional exclusion', async () => {
  const base = inputs.getAvailability;
  const invalid = [
    { date: '2025-02-29' },
    { date: '2024-02-30' },
    { date: '0000-01-01' },
    { date: '2026-10-13T00:00:00Z' },
    { durationMinutes: '30' },
    { durationMinutes: 1.5 },
    { durationMinutes: 2_147_483_648 },
    { barberMemberId: ' ' },
    { excludeAppointmentId: '' },
    { excludeAppointmentId: null },
  ];
  for (const patch of invalid) {
    const h = harness();
    error(await invoke(h, 'getAvailability', { ...base, ...patch }), 'INVALID_APPOINTMENT');
    assert.deepEqual(h.calls, []);
  }
  for (const durationMinutes of [1, 2_147_483_647]) {
    const h = harness();
    const input = { ...base, durationMinutes, excludeAppointmentId: ' Original Exclusion ' };
    assert.equal((await invoke(h, 'getAvailability', input)).data, slots);
    assert.deepEqual(h.calls, [['getAvailability', businessId, input]]);
  }
});

test('BF143 availability strips unapproved fields and permits successful empty slot array', async () => {
  const h = harness(() => Promise.resolve({ data: [], error: null, status: 200 }));
  const result = await invoke(h, 'getAvailability', {
    ...inputs.getAvailability,
    businessId: 'foreign',
    role: 'OWNER',
    buffer: 999,
  });
  assert.deepEqual(result, { data: [], error: null });
  assert.deepEqual(h.calls, [['getAvailability', businessId, inputs.getAvailability]]);
});

test('BF143 create strips managed fields and nested snapshot injection using actual BF141 schema', async () => {
  const injected = {
    businessId: 'foreign',
    business_id: 'foreign',
    status: 'COMPLETED',
    created_by: 'spoof',
    endAt: 'spoof',
    snapshots: [line],
    id: 'spoof',
    force: true,
  };
  const input = {
    ...inputs.create,
    ...injected,
    items: [{ ...inputs.create.items[0], ...injected, unit_price_snapshot: 999 }],
  };
  const h = harness();
  const result = await invoke(h, 'create', input);
  assert.equal(result.data, detail);
  assert.deepEqual(h.calls, [['create', businessId, inputs.create]]);
});

test('BF143 create preserves nullable/empty notes, original IDs/times, duplicates and optional duration', async () => {
  for (const notes of [undefined, null, '', ' Original notes ']) {
    const input = {
      ...inputs.create,
      notes,
      durationOverride: 1,
      items: [inputs.create.items[0], inputs.create.items[0]],
    };
    const before = JSON.stringify(input);
    const h = harness();
    await invoke(h, 'create', input);
    assert.deepEqual(h.calls, [['create', businessId, input]]);
    assert.equal(JSON.stringify(input), before);
  }
});

test('BF143 operational actions strip extra fields and preserve explicit notes clearing', async () => {
  for (const method of ['reschedule', 'updateNotes', 'changeStatus']) {
    const h = harness();
    await invoke(h, method, {
      ...inputs[method],
      business_id: 'foreign',
      endAt: 'spoof',
      snapshots: [line],
      force: true,
    });
    assert.deepEqual(h.calls, [[method, businessId, inputs[method]]]);
  }
  for (const notes of [null, '', ' Original ']) {
    const h = harness();
    await invoke(h, 'updateNotes', { appointmentId: 'a', notes });
    assert.equal(h.calls[0][2].notes, notes);
  }
});

test('BF143 status destinations restricted by BF141 but no client transition/permission logic', async () => {
  for (const status of ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW']) {
    const h = harness();
    assert.equal((await invoke(h, 'changeStatus', { appointmentId: 'a', status })).error, null);
    assert.equal(h.calls.length, 1);
  }
  for (const status of ['PENDING', 'COMPLETED', 'OTHER']) {
    const h = harness();
    error(await invoke(h, 'changeStatus', { appointmentId: 'a', status }), 'INVALID_APPOINTMENT');
    assert.deepEqual(h.calls, []);
  }
});

test('BF143 all operations use BF147 structural mapping with safe unknown RPC fallback', async () => {
  for (const method of methods)
    for (const [status, code, expected] of [
      [0, '42501', 'NETWORK_ERROR'],
      [401, '', 'APPOINTMENT_ACCESS_DENIED'],
      [403, '', 'APPOINTMENT_ACCESS_DENIED'],
      [400, '42501', 'APPOINTMENT_ACCESS_DENIED'],
      [404, 'PGRST202', 'UNKNOWN_ERROR'],
      [409, '23505', 'UNKNOWN_ERROR'],
      [400, 'APPOINTMENT_CONFLICT', 'UNKNOWN_ERROR'],
    ]) {
      const raw = Object.freeze({
        code,
        message: 'SELECT private appointments policy',
        details: 'private',
        hint: 'private',
      });
      const h = harness(() => Promise.resolve({ data: null, error: raw, status }));
      const result = await invoke(h, method);
      error(result, expected);
      assert(!JSON.stringify(result).includes('SELECT'));
      assert(!JSON.stringify(result).includes('private'));
      assert.equal(h.calls.length, 1);
    }
});

test('BF143 rejections including nullish and public-code-looking strings never become success or raw output', async () => {
  for (const method of methods)
    for (const rejection of [
      new Error('private'),
      new TypeError('Failed to fetch'),
      'APPOINTMENT_CONFLICT',
      'APPOINTMENT_NOT_FOUND',
      null,
      undefined,
      { name: 'FetchError', message: 'private' },
    ]) {
      const h = harness(() => Promise.reject(rejection));
      error(await invoke(h, method), 'UNKNOWN_ERROR');
      assert.equal(h.calls.length, 1);
    }
});

test('BF143 structurally identified rejected transport/access errors use BF147 safely', async () => {
  for (const rejection of [{ status: 0 }, { status: 403 }, { code: '42501' }]) {
    const h = harness(() => Promise.reject(rejection));
    error(
      await invoke(h, 'create'),
      rejection.status === 0 ? 'NETWORK_ERROR' : 'APPOINTMENT_ACCESS_DENIED',
    );
  }
});

test('BF143 null successful payload is unknown except contextual missing detail', async () => {
  for (const method of methods) {
    const h = harness(() => Promise.resolve({ data: null, error: null, status: 200 }));
    error(
      await invoke(h, method),
      method === 'getById' ? 'APPOINTMENT_NOT_FOUND' : 'UNKNOWN_ERROR',
    );
  }
});

test('BF143 malformed undefined payload never masquerades as missing detail or success', async () => {
  for (const method of methods) {
    const h = harness(() => Promise.resolve({ data: undefined, error: null, status: 200 }));
    error(await invoke(h, method), 'UNKNOWN_ERROR');
  }
});

test('BF143 validation and technical errors do not expose issues or invoke raw prose getters', async () => {
  const raw = { code: '42501' };
  for (const field of ['message', 'details', 'hint', 'stack'])
    Object.defineProperty(raw, field, {
      get() {
        throw new Error('must not read');
      },
    });
  const h = harness(() => Promise.resolve({ data: null, error: raw, status: 403 }));
  error(await invoke(h, 'getById'), 'APPOINTMENT_ACCESS_DENIED');
  const bad = harness();
  const result = await invoke(bad, 'create', { ...inputs.create, clientId: '   ' });
  error(result, 'INVALID_APPOINTMENT');
  assert(!JSON.stringify(result).includes('issues'));
  assert(!JSON.stringify(result).includes('clientId'));
});

test('BF143 public inferred service results reuse BF140 rows and BF147 safe error codes', () => {
  const virtual = path.join(root, 'tests/__bf143_type_contract__.ts');
  const source = `
    import {appointmentsService as service} from '@/features/appointments/services/appointmentsService';
    import type {AppointmentRow,AppointmentDetail,AppointmentAvailabilitySlot,AppointmentResult} from '@/features/appointments/types/appointment.types';
    import type {AppointmentErrorCode} from '@/features/appointments/services/appointmentErrors';
    type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true>=T;
    type Result<M extends keyof typeof service>=Awaited<ReturnType<typeof service[M]>>;
    export type List=Assert<Equal<Result<'listByRange'>,AppointmentResult<AppointmentRow[],AppointmentErrorCode>>>;
    export type Detail=Assert<Equal<Result<'getById'>,AppointmentResult<AppointmentDetail,AppointmentErrorCode>>>;
    export type Create=Assert<Equal<Result<'create'>,AppointmentResult<AppointmentDetail,AppointmentErrorCode>>>;
    export type Slots=Assert<Equal<Result<'getAvailability'>,AppointmentResult<AppointmentAvailabilitySlot[],AppointmentErrorCode>>>;
    export type Reschedule=Assert<Equal<Result<'reschedule'>,AppointmentResult<AppointmentRow,AppointmentErrorCode>>>;
    export type Notes=Assert<Equal<Result<'updateNotes'>,AppointmentResult<AppointmentRow,AppointmentErrorCode>>>;
    export type Status=Assert<Equal<Result<'changeStatus'>,AppointmentResult<AppointmentRow,AppointmentErrorCode>>>;
    // @ts-expect-error COMPLETED remains checkout-owned.
    service.changeStatus('b',{appointmentId:'a',status:'COMPLETED'});
    // @ts-expect-error No generic update bypass.
    service.update('b','a',{status:'COMPLETED'});
    // @ts-expect-error No physical deletion.
    service.delete('b','a');
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options),
    original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtual
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : original(file, ...args);
  const program = ts.createProgram(
      [virtual, ...fileNames.filter((file) => file.endsWith('.d.ts'))],
      { ...options, noEmit: true },
      host,
    ),
    diagnostics = ts.getPreEmitDiagnostics(program);
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
