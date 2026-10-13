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
  'src/features/appointments/repositories/appointmentsRepository.ts',
);
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const columns =
  'id,business_id,client_id,barber_member_id,start_at,end_at,status,notes,created_by,created_at,updated_at';
const lineColumns =
  'id,appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,quantity,line_total,created_at';
const businessId = ' Business Original ';
const appointmentId = ' Appointment Original ';
const range = Object.freeze({ from: '2026-10-01T00:00:00-03:00', to: '2026-10-02T00:00:00-03:00' });
const row = Object.freeze({
  id: appointmentId,
  business_id: businessId,
  client_id: ' Client ',
  barber_member_id: ' Barber ',
  start_at: '2026-10-01T12:00:00Z',
  end_at: '2026-10-01T12:45:00Z',
  status: 'COMPLETED',
  notes: null,
  created_by: ' Creator ',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-10-01T12:45:00Z',
});
const line = Object.freeze({
  id: 'line',
  appointment_id: appointmentId,
  service_id: null,
  service_name_snapshot: ' Historical name ',
  unit_price_snapshot: 0.29,
  duration_minutes_snapshot: 45,
  quantity: 2,
  line_total: 0.58,
  created_at: row.created_at,
});
const detail = Object.freeze({ ...row, appointment_services: Object.freeze([line]) });
const createInput = Object.freeze({
  requestId: ' Request ',
  clientId: row.client_id,
  barberMemberId: row.barber_member_id,
  startAt: row.start_at,
  items: Object.freeze([Object.freeze({ serviceId: ' Service ', quantity: 2 })]),
});
const rescheduleInput = Object.freeze({
  appointmentId,
  barberMemberId: row.barber_member_id,
  startAt: row.start_at,
});
const availabilityInput = Object.freeze({
  barberMemberId: row.barber_member_id,
  date: '2026-10-01',
  durationMinutes: 45,
});
const extras = Object.freeze({
  business_id: 'foreign',
  businessId: 'foreign',
  p_business_id: 'foreign',
  status: 'COMPLETED',
  created_by: 'spoofed',
  endAt: 'spoofed',
  end_at: 'spoofed',
  id: 'spoofed',
  created_at: 'spoofed',
  updated_at: 'spoofed',
  snapshots: [line],
  appointment_services: [line],
  force: true,
  role: 'OWNER',
});
const methods = [
  'listByRange',
  'getById',
  'getAvailability',
  'create',
  'reschedule',
  'updateNotes',
  'changeStatus',
];
function load(client) {
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
    (name) => {
      assert.equal(name, '@/lib/supabase/client');
      return { supabase: client };
    },
    module,
    module.exports,
  );
  assert.deepEqual(Object.keys(module.exports), ['appointmentsRepository']);
  assert.deepEqual(Object.keys(module.exports.appointmentsRepository), methods);
  return module.exports.appointmentsRepository;
}
function boundary(result = { data: detail, error: null, status: 200 }, rejection) {
  const calls = [];
  const chain = {
    then(resolve, reject) {
      return (rejection !== undefined ? Promise.reject(rejection) : Promise.resolve(result)).then(
        resolve,
        reject,
      );
    },
  };
  for (const name of ['select', 'eq', 'lt', 'gt', 'order', 'maybeSingle', 'overrideTypes']) {
    chain[name] = (...args) => {
      if (name !== 'overrideTypes') calls.push([name, ...args]);
      return chain;
    };
  }
  const repo = load({
    from(table) {
      calls.push(['from', table]);
      return chain;
    },
    rpc(name, args) {
      calls.push(['rpc', name, args]);
      return chain;
    },
  });
  return { repo, calls };
}
function invoke(repo, method) {
  if (method === 'listByRange') return repo.listByRange(businessId, range);
  if (method === 'getById') return repo.getById(businessId, appointmentId);
  if (method === 'getAvailability') return repo.getAvailability(businessId, availabilityInput);
  if (method === 'create') return repo.create(businessId, createInput);
  if (method === 'reschedule') return repo.reschedule(businessId, rescheduleInput);
  if (method === 'updateNotes') return repo.updateNotes(businessId, { appointmentId, notes: null });
  return repo.changeStatus(businessId, { appointmentId, status: 'CONFIRMED' });
}
const compact = (value) => value.replace(/\s/g, '');

test('BF142 import is inert, singleton-only, and public API is exactly seven approved operations', () => {
  load(
    new Proxy(
      {},
      {
        get() {
          assert.fail('No request during import');
        },
      },
    ),
  );
});

test('BF142 range query has exact scalar projection, tenant, strict overlap and stable ordering', async () => {
  const h = boundary();
  await invoke(h.repo, 'listByRange');
  assert.deepEqual(h.calls[0], ['from', 'appointments']);
  assert.equal(compact(h.calls[1][1]), columns);
  assert.deepEqual(h.calls.slice(2), [
    ['eq', 'business_id', businessId],
    ['lt', 'start_at', range.to],
    ['gt', 'end_at', range.from],
    ['order', 'start_at', { ascending: true }],
    ['order', 'id', { ascending: true }],
  ]);
});

test('BF142 range collection empty/multiple results and SDK metadata are preserved unchanged', async () => {
  for (const data of [[], [row, { ...row, id: 'earlier-but-sdk-order', status: 'CANCELLED' }]]) {
    const result = Object.freeze({ data, error: null, status: 200, statusText: 'OK', count: null });
    const h = boundary(result);
    assert.equal(await invoke(h.repo, 'listByRange'), result);
    assert.equal(result.data, data);
  }
});

test('BF142 detail uses one relational projection with exact nine snapshot fields and no catalog join', async () => {
  const result = { data: detail, error: null, status: 200 };
  const h = boundary(result);
  assert.equal(await invoke(h.repo, 'getById'), result);
  assert.deepEqual(h.calls[0], ['from', 'appointments']);
  assert.equal(compact(h.calls[1][1]), `${columns},appointment_services(${lineColumns})`);
  assert.deepEqual(h.calls.slice(2), [
    ['eq', 'business_id', businessId],
    ['eq', 'id', appointmentId],
    ['maybeSingle'],
  ]);
  assert.equal(h.calls.filter(([method]) => method === 'from').length, 1);
  assert.equal(result.data.appointment_services[0].service_id, null);
  assert.equal(result.data.appointment_services[0], line);
});

test('BF142 detail missing/RLS-invisible stays data:null/error:null without fabricated domain error', async () => {
  const result = Object.freeze({ data: null, error: null, status: 200 });
  const h = boundary(result);
  assert.equal(await invoke(h.repo, 'getById'), result);
});

test('BF142 detail preserves all six statuses and empty/duplicate historical lines', async () => {
  for (const status of [
    'PENDING',
    'CONFIRMED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ]) {
    for (const lines of [[], [line, line]]) {
      const result = {
        data: { ...row, status, appointment_services: lines },
        error: null,
        status: 200,
      };
      const h = boundary(result);
      assert.equal(await invoke(h.repo, 'getById'), result);
      assert(!h.calls.some(([method, key]) => method === 'eq' && key === 'status'));
    }
  }
});

test('BF142 availability uses exact RPC arguments, explicit tenant and no local slot calculation', async () => {
  const data = [{ start_at: row.start_at, end_at: row.end_at, available: false }];
  const result = { data, error: null, status: 200 };
  const h = boundary(result);
  assert.equal(
    await h.repo.getAvailability(businessId, {
      ...availabilityInput,
      ...extras,
      excludeAppointmentId: appointmentId,
    }),
    result,
  );
  assert.deepEqual(h.calls, [
    [
      'rpc',
      'get_availability',
      {
        p_business_id: businessId,
        p_barber_member_id: row.barber_member_id,
        p_date: availabilityInput.date,
        p_duration_minutes: 45,
        p_exclude_appointment_id: appointmentId,
      },
    ],
  ]);
});

test('BF142 availability omits undefined exclusion and preserves empty slot result', async () => {
  const result = { data: [], error: null, status: 200 };
  const h = boundary(result);
  assert.equal(await invoke(h.repo, 'getAvailability'), result);
  assert(!Object.hasOwn(h.calls[0][2], 'p_exclude_appointment_id'));
});

test('BF142 create allowlists RPC and nested items, mapping requestId rather than caller id', async () => {
  const h = boundary();
  await h.repo.create(businessId, {
    ...createInput,
    ...extras,
    items: [
      {
        ...createInput.items[0],
        ...extras,
        service_id: 'spoofed',
        service_name_snapshot: 'spoofed',
      },
    ],
  });
  assert.deepEqual(h.calls, [
    [
      'rpc',
      'create_appointment_with_services',
      {
        p_appointment_id: createInput.requestId,
        p_business_id: businessId,
        p_client_id: row.client_id,
        p_barber_member_id: row.barber_member_id,
        p_start_at: row.start_at,
        p_service_items: [{ service_id: ' Service ', quantity: 2 }],
      },
    ],
  ]);
});

test('BF142 create preserves admitted notes/duration, omits undefined, and never writes snapshots/end/creator/status', async () => {
  for (const notes of [undefined, null, '', ' Original text ']) {
    for (const durationOverride of [undefined, 1, 2_147_483_647]) {
      const h = boundary();
      await h.repo.create(businessId, { ...createInput, notes, durationOverride });
      const args = h.calls[0][2];
      assert.equal(Object.hasOwn(args, 'p_notes'), notes !== undefined);
      if (notes !== undefined) assert.equal(args.p_notes, notes);
      assert.equal(Object.hasOwn(args, 'p_duration_override'), durationOverride !== undefined);
      if (durationOverride !== undefined) assert.equal(args.p_duration_override, durationOverride);
      assert.deepEqual(
        Object.keys(args).sort(),
        [
          'p_appointment_id',
          'p_business_id',
          'p_client_id',
          'p_barber_member_id',
          'p_start_at',
          'p_service_items',
          ...(notes !== undefined ? ['p_notes'] : []),
          ...(durationOverride !== undefined ? ['p_duration_override'] : []),
        ].sort(),
      );
    }
  }
});

test('BF142 create preserves duplicate service items/order/quantity and input immutability', async () => {
  const item = Object.freeze({ serviceId: 'service', quantity: 2 });
  const input = Object.freeze({ ...createInput, items: Object.freeze([item, item]) });
  const before = JSON.stringify(input);
  const result = { data: detail, error: null, status: 200 };
  const h = boundary(result);
  assert.equal(await h.repo.create(businessId, input), result);
  assert.deepEqual(h.calls[0][2].p_service_items, [
    { service_id: 'service', quantity: 2 },
    { service_id: 'service', quantity: 2 },
  ]);
  assert.equal(JSON.stringify(input), before);
});

test('BF142 reschedule sends only approved tenant/id/barber/start/optional duration', async () => {
  for (const durationOverride of [undefined, 45]) {
    const h = boundary();
    await h.repo.reschedule(businessId, {
      ...rescheduleInput,
      ...extras,
      notes: 'ignored',
      items: createInput.items,
      durationOverride,
    });
    assert.deepEqual(h.calls, [
      [
        'rpc',
        'reschedule_appointment',
        {
          p_business_id: businessId,
          p_appointment_id: appointmentId,
          p_barber_member_id: row.barber_member_id,
          p_start_at: row.start_at,
          ...(durationOverride !== undefined ? { p_duration_override: durationOverride } : {}),
        },
      ],
    ]);
  }
});

test('BF142 notes update preserves explicit null/empty/original text and excludes arbitrary fields', async () => {
  for (const notes of [null, '', ' Original notes ']) {
    const h = boundary();
    await h.repo.updateNotes(businessId, { ...extras, appointmentId, notes });
    assert.deepEqual(h.calls, [
      [
        'rpc',
        'update_appointment_notes',
        {
          p_business_id: businessId,
          p_appointment_id: appointmentId,
          p_notes: notes,
        },
      ],
    ]);
  }
});

test('BF142 status action transports approved destination only, without transitions or extra fields', async () => {
  for (const status of ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW']) {
    const h = boundary();
    await h.repo.changeStatus(businessId, { ...extras, appointmentId, status });
    assert.deepEqual(h.calls, [
      [
        'rpc',
        'change_appointment_status',
        {
          p_business_id: businessId,
          p_appointment_id: appointmentId,
          p_status: status,
        },
      ],
    ]);
  }
});

test('BF142 each operation propagates SDK errors/status/details verbatim for later service normalization', async () => {
  for (const method of methods) {
    for (const [status, code] of [
      [0, ''],
      [403, '42501'],
      [404, 'PGRST202'],
      [409, '23505'],
    ]) {
      const error = Object.freeze({
        code,
        message: 'synthetic raw SDK error',
        details: 'private',
        hint: 'private',
      });
      const result = Object.freeze({
        data: null,
        error,
        status,
        statusText: 'fixture',
        count: null,
      });
      const h = boundary(result);
      assert.equal(await invoke(h.repo, method), result);
      assert.equal(result.error, error);
    }
  }
});

test('BF142 each operation preserves unexpected rejection identity', async () => {
  for (const method of methods) {
    for (const rejection of [
      new Error('synthetic'),
      'synthetic string',
      Object.freeze({ code: 'unexpected' }),
    ]) {
      const h = boundary(undefined, rejection);
      await assert.rejects(
        async () => invoke(h.repo, method),
        (error) => error === rejection,
      );
    }
  }
});

test('BF142 every RPC takes tenant from explicit context argument, never caller payload', async () => {
  for (const method of methods.slice(2)) {
    const h = boundary();
    await invoke(h.repo, method);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][0], 'rpc');
    assert.equal(h.calls[0][2].p_business_id, businessId);
  }
});

test('BF142 installed SDK serializes exact requests through fake fetch only; no DML/count/extra queries', async () => {
  const requests = [];
  const client = createClient('https://bf142-test.invalid', 'synthetic-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, options) => {
        requests.push({ url: new URL(String(url)), options });
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const repo = load(client);
  for (const method of methods) await invoke(repo, method);
  assert.equal(requests.length, 7);
  const [list, get, ...rpcs] = requests;
  assert.equal(list.options.method, 'GET');
  assert.equal(list.url.pathname, '/rest/v1/appointments');
  assert.equal(list.url.searchParams.get('select'), columns);
  assert.equal(list.url.searchParams.get('business_id'), `eq.${businessId}`);
  assert.equal(list.url.searchParams.get('start_at'), `lt.${range.to}`);
  assert.equal(list.url.searchParams.get('end_at'), `gt.${range.from}`);
  assert.equal(list.url.searchParams.get('order'), 'start_at.asc,id.asc');
  assert.deepEqual(
    [...list.url.searchParams.keys()].sort(),
    ['select', 'business_id', 'start_at', 'end_at', 'order'].sort(),
  );
  assert.equal(
    get.url.searchParams.get('select'),
    `${columns},appointment_services(${lineColumns})`,
  );
  assert.equal(get.url.searchParams.get('business_id'), `eq.${businessId}`);
  assert.equal(get.url.searchParams.get('id'), `eq.${appointmentId}`);
  assert.deepEqual([...get.url.searchParams.keys()].sort(), ['select', 'business_id', 'id'].sort());
  assert.deepEqual(
    rpcs.map(({ url }) => url.pathname),
    [
      '/rest/v1/rpc/get_availability',
      '/rest/v1/rpc/create_appointment_with_services',
      '/rest/v1/rpc/reschedule_appointment',
      '/rest/v1/rpc/update_appointment_notes',
      '/rest/v1/rpc/change_appointment_status',
    ],
  );
  for (const request of rpcs) {
    assert.equal(request.options.method, 'POST');
    assert.equal(JSON.parse(request.options.body).p_business_id, businessId);
    assert.equal(request.url.search, '');
  }
});

test('BF142 approved type contracts reuse BF140/141 and preserve SDK nullability', () => {
  const virtual = path.join(root, 'tests/__bf142_type_contract__.ts');
  const contract = `
    import {appointmentsRepository as repo} from '@/features/appointments/repositories/appointmentsRepository';
    import type {AppointmentDetail,AppointmentRow,AppointmentServiceRow,AppointmentAvailabilitySlot} from '@/features/appointments/types/appointment.types';
    type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true>=T;
    type Data<M extends keyof typeof repo>=Awaited<ReturnType<typeof repo[M]>>['data'];
    export type List=Assert<Equal<Data<'listByRange'>,AppointmentRow[]|null>>;
    export type Detail=Assert<Equal<Data<'getById'>,AppointmentDetail|null>>;
    export type Lines=Assert<Equal<AppointmentDetail['appointment_services'],AppointmentServiceRow[]>>;
    export type Create=Assert<Equal<Data<'create'>,AppointmentDetail|null>>;
    export type Slots=Assert<Equal<Data<'getAvailability'>,AppointmentAvailabilitySlot[]|null>>;
    export type Reschedule=Assert<Equal<Data<'reschedule'>,AppointmentRow|null>>;
    export type Notes=Assert<Equal<Data<'updateNotes'>,AppointmentRow|null>>;
    export type Status=Assert<Equal<Data<'changeStatus'>,AppointmentRow|null>>;
    // @ts-expect-error Tenant is mandatory and separate from caller input.
    repo.create({requestId:'r',clientId:'c',barberMemberId:'b',startAt:'t',items:[]});
    // @ts-expect-error COMPLETED is not a direct action.
    repo.changeStatus('b',{appointmentId:'a',status:'COMPLETED'});
    // @ts-expect-error PENDING is not a direct action.
    repo.changeStatus('b',{appointmentId:'a',status:'PENDING'});
    // @ts-expect-error Not a generic update.
    repo.update('b','a',{status:'COMPLETED'});
    // @ts-expect-error No physical deletion.
    repo.delete('b','a');
    // @ts-expect-error No caller-controlled endAt in reschedule.
    repo.reschedule('b',{appointmentId:'a',barberMemberId:'m',startAt:'t',endAt:'t'});
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options),
    original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtual
      ? ts.createSourceFile(file, contract, options.target ?? ts.ScriptTarget.Latest, true)
      : original(file, ...args);
  const program = ts.createProgram(
    [virtual, ...fileNames.filter((file) => file.endsWith('.d.ts'))],
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
