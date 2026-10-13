/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const feature = path.join(root, 'src/features/appointments');
const cache = new Map();
function load(relative) {
  const file = path.resolve(feature, relative + '.ts');
  if (cache.has(file)) return cache.get(file);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  cache.set(file, module.exports);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    (name) => {
      if (name === 'zod') return require('zod');
      assert(name.startsWith('.'), `Unexpected dependency ${name}`);
      return load(path.relative(feature, path.resolve(path.dirname(file), name)));
    },
    module,
    module.exports,
  );
  return module.exports;
}
const s = load('schemas/appointment.schema');
const item = { serviceId: ' service-original ', quantity: 1 };
const create = {
  requestId: ' request-original ',
  clientId: ' client-original ',
  barberMemberId: ' member-original ',
  startAt: '2020-02-29T10:30:00.123456-03:00',
  items: [item],
};
const reschedule = {
  appointmentId: ' appointment-original ',
  barberMemberId: create.barberMemberId,
  startAt: create.startAt,
};
function invalid(schema, value, field) {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, JSON.stringify(value));
  if (field)
    assert(
      result.error.issues.some((issue) => issue.path[0] === field),
      JSON.stringify(result.error.issues),
    );
  return result.error;
}

test('BF141 minimal create preserves approved DTO, original IDs and timestamp; adds no defaults', () => {
  assert.deepEqual(s.createAppointmentSchema.parse(create), create);
  assert.equal(Object.hasOwn(s.createAppointmentSchema.parse(create), 'notes'), false);
  assert.equal(Object.hasOwn(s.createAppointmentSchema.parse(create), 'durationOverride'), false);
});
test('BF141 optional create notes preserve omitted, undefined, null, empty and original text', () => {
  for (const notes of [undefined, null, '', '  texto\n original  ', 'x'.repeat(10000)]) {
    const result = s.createAppointmentSchema.parse({ ...create, notes });
    assert.equal(Object.hasOwn(result, 'notes'), true);
    assert.equal(result.notes, notes);
  }
});
test('BF141 create IDs are required usable strings without coercion or persistent trim', () => {
  for (const field of ['requestId', 'clientId', 'barberMemberId']) {
    const missing = { ...create };
    delete missing[field];
    invalid(s.createAppointmentSchema, missing, field);
    for (const value of ['', ' \t\n ', null, 1, true, {}, []])
      invalid(s.createAppointmentSchema, { ...create, [field]: value }, field);
  }
});
test('BF141 real zoned instants preserve Z, offsets, fractions and past values', () => {
  for (const startAt of [
    '1900-01-01T00:00:00Z',
    '2000-02-29T12:34:56Z',
    '2026-01-01T00:00:00+03:30',
    '2026-01-01T00:00:00.000000001-03:00',
  ]) {
    assert.equal(s.createAppointmentSchema.parse({ ...create, startAt }).startAt, startAt);
    assert.equal(s.rescheduleAppointmentSchema.parse({ ...reschedule, startAt }).startAt, startAt);
  }
});
test('BF141 rejects nonexistent calendar dates, invalid clock/zone and non-string timestamps', () => {
  for (const startAt of [
    '',
    '2026-02-30T10:00:00Z',
    '1900-02-29T10:00:00Z',
    '2023-02-29T10:00:00Z',
    '2026-13-01T10:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T10:60:00Z',
    '2026-01-01T10:00:60Z',
    '2026-01-01T10:00:00',
    '2026-01-01',
    '2026-01-01T10:00Z',
    '2026-01-01T10:00:00+24:00',
    '2026-01-01T10:00:00+02',
    '2026-01-01T10:00:00+0200',
    new Date(),
    0,
    true,
    {},
    null,
  ]) {
    invalid(s.createAppointmentSchema, { ...create, startAt }, 'startAt');
    invalid(s.rescheduleAppointmentSchema, { ...reschedule, startAt }, 'startAt');
  }
});
test('BF141 strips all tenant/server/permission fields and nested snapshots from create', () => {
  const result = s.createAppointmentSchema.parse({
    ...create,
    businessId: 'other',
    business_id: 'other',
    status: 'COMPLETED',
    created_by: 'other',
    id: 'other',
    created_at: 'x',
    updated_at: 'x',
    endAt: 'x',
    end_at: 'x',
    force: true,
    override: true,
    bypassConflict: true,
    snapshots: [],
    items: [
      {
        ...item,
        service_id: 'other',
        business_id: 'other',
        service_name_snapshot: 'other',
        unit_price_snapshot: 999,
        duration_minutes_snapshot: 999,
        line_total: 999,
        created_at: 'x',
      },
    ],
  });
  assert.deepEqual(result, create);
});
test('BF141 unknown-only input cannot replace required create or item fields', () => {
  invalid(s.createAppointmentSchema, { status: 'COMPLETED', business_id: 'other' });
  invalid(s.createAppointmentItemSchema, { unit_price_snapshot: 1 });
  invalid(
    s.createAppointmentSchema,
    { ...create, items: [{ service_name_snapshot: 'x' }] },
    'items',
  );
});
test('BF141 items require at least one, allow multiple/duplicate services and impose no maximum', () => {
  invalid(s.createAppointmentSchema, { ...create, items: [] }, 'items');
  const missing = { ...create };
  delete missing.items;
  invalid(s.createAppointmentSchema, missing, 'items');
  const items = Array.from({ length: 101 }, () => ({ ...item }));
  assert.deepEqual(s.createAppointmentSchema.parse({ ...create, items }).items, items);
});
test('BF141 item serviceId is required, original and usable; quantity has no implicit default', () => {
  assert.deepEqual(s.createAppointmentItemSchema.parse(item), item);
  for (const serviceId of [undefined, '', ' \t ', null, 1, true, {}])
    invalid(s.createAppointmentItemSchema, { ...item, serviceId }, 'serviceId');
  invalid(s.createAppointmentItemSchema, { serviceId: item.serviceId }, 'quantity');
});
test('BF141 quantities are positive int4 numbers, never coerced or rounded', () => {
  for (const quantity of [1, 17, 2147483647])
    assert.equal(s.createAppointmentItemSchema.parse({ ...item, quantity }).quantity, quantity);
  for (const quantity of [0, -1, 1.5, 2147483648, NaN, Infinity, -Infinity, '1', true, null])
    invalid(s.createAppointmentItemSchema, { ...item, quantity }, 'quantity');
});
test('BF141 durationOverride is optional positive int4, with no step/default/authority flag', () => {
  for (const durationOverride of [1, 17, 2147483647]) {
    assert.equal(
      s.createAppointmentSchema.parse({ ...create, durationOverride }).durationOverride,
      durationOverride,
    );
    assert.equal(
      s.rescheduleAppointmentSchema.parse({ ...reschedule, durationOverride }).durationOverride,
      durationOverride,
    );
  }
  for (const durationOverride of [0, -1, 1.5, 2147483648, NaN, Infinity, '30', true, null])
    invalid(s.createAppointmentSchema, { ...create, durationOverride }, 'durationOverride');
});
test('BF141 reschedule exact approved fields exclude notes/items/end/status/creator and snapshots', () => {
  assert.deepEqual(
    s.rescheduleAppointmentSchema.parse({
      ...reschedule,
      notes: 'x',
      items: [item],
      endAt: 'x',
      status: 'COMPLETED',
      requestId: 'x',
      businessId: 'other',
      created_by: 'x',
      force: true,
    }),
    reschedule,
  );
  for (const field of ['appointmentId', 'barberMemberId', 'startAt']) {
    const missing = { ...reschedule };
    delete missing[field];
    invalid(s.rescheduleAppointmentSchema, missing, field);
  }
});
test('BF141 notes update requires original appointmentId and explicit nullable notes', () => {
  for (const notes of [null, '', '  texto\n original  '])
    assert.deepEqual(
      s.updateAppointmentNotesSchema.parse({
        appointmentId: reschedule.appointmentId,
        notes,
        status: 'COMPLETED',
      }),
      { appointmentId: reschedule.appointmentId, notes },
    );
  for (const notes of [undefined, 1, true, {}])
    invalid(s.updateAppointmentNotesSchema, { appointmentId: 'a', notes }, 'notes');
  invalid(s.updateAppointmentNotesSchema, { notes: null }, 'appointmentId');
  invalid(s.updateAppointmentNotesSchema, { appointmentId: ' \t ', notes: null }, 'appointmentId');
});
test('BF141 status action accepts exactly four operational destinations, not transitions or permissions', () => {
  for (const status of ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'])
    assert.deepEqual(
      s.appointmentStatusActionSchema.parse({
        appointmentId: reschedule.appointmentId,
        status,
        previousStatus: 'COMPLETED',
        force: true,
        businessId: 'other',
      }),
      { appointmentId: reschedule.appointmentId, status },
    );
  for (const status of [
    'PENDING',
    'COMPLETED',
    'RESCHEDULED',
    'confirmed',
    undefined,
    null,
    1,
    true,
  ])
    invalid(s.appointmentStatusActionSchema, { appointmentId: 'a', status }, 'status');
  invalid(
    s.appointmentStatusActionSchema,
    { appointmentId: '', status: 'CONFIRMED' },
    'appointmentId',
  );
});
test('BF141 mandatory half-open range preserves representation, has no horizon and strips extra fields', () => {
  const range = { from: '1900-01-01T00:00:00Z', to: '2100-01-01T00:00:00+03:00' };
  assert.deepEqual(
    s.appointmentRangeSchema.parse({ ...range, businessId: 'other', timezone: 'device' }),
    range,
  );
  invalid(s.appointmentRangeSchema, { from: range.from }, 'to');
  invalid(s.appointmentRangeSchema, { to: range.to }, 'from');
});
test('BF141 range rejects equal or descending instants including equivalent offsets/fractions', () => {
  for (const range of [
    { from: '2026-01-01T10:00:00Z', to: '2026-01-01T10:00:00Z' },
    { from: '2026-01-01T10:00:00Z', to: '2026-01-01T09:00:00Z' },
    { from: '2026-01-01T10:00:00Z', to: '2026-01-01T13:00:00+03:00' },
    { from: '2026-01-01T10:00:00.1Z', to: '2026-01-01T10:00:00.100000000Z' },
  ])
    invalid(s.appointmentRangeSchema, range, 'to');
});
test('BF141 range compares sub-millisecond precision without truncation or rounding', () => {
  for (const [fromFraction, toFraction] of [
    ['000001', '000002'],
    ['000000001', '000000002'],
    ['1', '100000001'],
    ['09', '1'],
  ]) {
    const range = {
      from: `2026-01-01T10:00:00.${fromFraction}Z`,
      to: `2026-01-01T10:00:00.${toFraction}Z`,
    };
    assert.deepEqual(s.appointmentRangeSchema.parse(range), range);
    invalid(s.appointmentRangeSchema, { from: range.to, to: range.from }, 'to');
  }
});
test('BF141 range compares actual instants across offsets and civil-day boundaries', () => {
  const range = { from: '2026-01-02T00:00:00.000001+01:00', to: '2026-01-01T23:00:00.000002Z' };
  assert.deepEqual(s.appointmentRangeSchema.parse(range), range);
  invalid(s.appointmentRangeSchema, { from: range.to, to: range.from }, 'to');
});
test('BF141 range format errors stay associated with endpoints without spurious order errors', () => {
  const errors = invalid(s.appointmentRangeSchema, {
    from: '2026-02-30T00:00:00Z',
    to: '2026-01-01T00:00:00Z',
  });
  assert.deepEqual(
    errors.issues.map((issue) => issue.path),
    [['from']],
  );
  invalid(s.appointmentRangeSchema, { from: new Date(), to: '2026-01-01T00:00:00Z' }, 'from');
  invalid(s.appointmentRangeSchema, { from: '2026-01-01T00:00:00Z', to: false }, 'to');
});
test('BF141 inferred inputs preserve BF140 public DTOs and reject caller-managed fields at compile time', () => {
  const virtualFile = path.join(root, 'tests/__bf141_type_contract__.ts');
  const source = `
    import {z} from 'zod';
    import {createAppointmentSchema,createAppointmentItemSchema,rescheduleAppointmentSchema,updateAppointmentNotesSchema,appointmentStatusActionSchema,appointmentRangeSchema} from '@/features/appointments/schemas/appointment.schema';
    import type {CreateAppointmentInput,CreateAppointmentItemInput,RescheduleAppointmentInput,UpdateAppointmentNotesInput,AppointmentStatusActionInput,AppointmentRangeInput} from '@/features/appointments/schemas/appointment.schema';
    import type {CreateAppointmentInput as PreviousCreate,CreateAppointmentItemInput as PreviousItem,AppointmentRange,CreateAppointmentRequest} from '@/features/appointments/types/appointment.types';
    type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true>=T;
    export type Create=Assert<Equal<CreateAppointmentInput,PreviousCreate>>;
    export type Item=Assert<Equal<CreateAppointmentItemInput,PreviousItem>>;
    export type Range=Assert<Equal<AppointmentRangeInput,AppointmentRange>>;
    export type Derived=Assert<Equal<CreateAppointmentInput,z.infer<typeof createAppointmentSchema>>>;
    export type Reschedule=Assert<Equal<RescheduleAppointmentInput,{appointmentId:string;barberMemberId:string;startAt:string;durationOverride?:number|undefined}>>;
    export type Notes=Assert<Equal<UpdateAppointmentNotesInput,{appointmentId:string;notes:string|null}>>;
    export type Status=Assert<Equal<AppointmentStatusActionInput['status'],'CONFIRMED'|'IN_PROGRESS'|'CANCELLED'|'NO_SHOW'>>;
    export type NoTenant=Assert<Equal<keyof CreateAppointmentRequest,keyof CreateAppointmentInput|'businessId'>>;
    const create={requestId:'r',clientId:'c',barberMemberId:'m',startAt:'2026-01-01T00:00:00Z',items:[{serviceId:'s',quantity:1}]} satisfies CreateAppointmentInput;
    // @ts-expect-error Numeric inputs are not coerced.
    const quantity:CreateAppointmentItemInput={serviceId:'s',quantity:'1'};
    // @ts-expect-error Caller input cannot control tenant.
    const tenant:CreateAppointmentInput={...create,businessId:'other'};
    // @ts-expect-error Caller input cannot control status.
    const status:CreateAppointmentInput={...create,status:'COMPLETED'};
    // @ts-expect-error No Date output/input type.
    const date:CreateAppointmentInput={...create,startAt:new Date()};
    // @ts-expect-error No completed shortcut in status action.
    const completed:AppointmentStatusActionInput={appointmentId:'a',status:'COMPLETED'};
    // @ts-expect-error Notes must be explicit in notes update.
    const notes:UpdateAppointmentNotesInput={appointmentId:'a'};
    // @ts-expect-error Reschedule cannot reprice/change service items.
    const reschedule:RescheduleAppointmentInput={appointmentId:'a',barberMemberId:'m',startAt:'x',items:[]};
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options),
    original = host.getSourceFile.bind(host);
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
test('BF141 public runtime API is six schemas only, no operation or service implementation', () => {
  assert.deepEqual(
    Object.keys(s).sort(),
    [
      'createAppointmentItemSchema',
      'createAppointmentSchema',
      'rescheduleAppointmentSchema',
      'updateAppointmentNotesSchema',
      'appointmentStatusActionSchema',
      'appointmentRangeSchema',
    ].sort(),
  );
  const source = fs.readFileSync(path.join(feature, 'schemas/appointment.schema.ts'), 'utf8');
  assert.doesNotMatch(
    source,
    /z\.coerce|supabase|useBusiness|servicesRepository|createClient|Date\.now|new Date|z\.strictObject/,
  );
});
