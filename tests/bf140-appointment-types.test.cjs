/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/features/appointments/types/appointment.types.ts');
const text = fs.readFileSync(file, 'utf8');
const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const appointmentSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261006213442_appointments.sql'),
  'utf8',
);
const lineFile = fs
  .readdirSync(path.join(root, 'supabase/migrations'))
  .find((name) => name.endsWith('_appointment_services.sql'));
assert(lineFile, 'Existing appointment_services migration required');
const lineSql = fs.readFileSync(path.join(root, 'supabase/migrations', lineFile), 'utf8');

test('BF140 exposes exactly the six actual database statuses, no additional runtime API', () => {
  const module = { exports: {} };
  const code = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInThisContext(`(function(module,exports){${code}\n})`, { filename: file })(
    module,
    module.exports,
  );
  const expected = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
  assert.deepEqual(Object.keys(module.exports), ['APPOINTMENT_STATUSES']);
  assert.deepEqual(module.exports.APPOINTMENT_STATUSES, expected);
  const statusCheck = appointmentSql.match(/status IN \(([^)]+)\)/)[1];
  assert.deepEqual(
    [...statusCheck.matchAll(/'([^']+)'/g)].map((match) => match[1]),
    expected,
  );
});

test('BF140 row fields, requiredness, SQL scalar mapping and nullability match actual migrations', () => {
  for (const [typeName, sql] of [
    ['AppointmentRow', appointmentSql],
    ['AppointmentServiceRow', lineSql],
  ]) {
    const declaration = sourceFile.statements.find(
      (node) => ts.isTypeAliasDeclaration(node) && node.name.text === typeName,
    );
    const row = declaration.type.members;
    const columns = [
      ...sql.matchAll(/^  (\w+) (uuid|text|timestamptz|integer|numeric\(12,2\))([^\n]*),?$/gm),
    ];
    assert.deepEqual(
      row.map((member) => member.name.getText(sourceFile)),
      columns.map((column) => column[1]),
      typeName,
    );
    for (const [index, column] of columns.entries()) {
      const member = row[index];
      assert.equal(
        member.questionToken,
        undefined,
        `${typeName}.${column[1]} is a required row field`,
      );
      const nullable = !column[3].includes('NOT NULL');
      const base =
        column[1] === 'status'
          ? 'AppointmentStatus'
          : /^(integer|numeric)/.test(column[2])
            ? 'number'
            : 'string';
      assert.equal(
        member.type.getText(sourceFile),
        base + (nullable ? ' | null' : ''),
        `${typeName}.${column[1]}`,
      );
    }
  }
});

test('BF140 type contract rejects invalid statuses, null FKs, Date values and managed create fields', () => {
  const virtualFile = path.join(root, 'tests/__bf140_type_contract__.ts');
  const source = `
    import { APPOINTMENT_STATUSES } from '@/features/appointments/types/appointment.types';
    import type { AppointmentStatus, AppointmentRow, AppointmentServiceRow, CreateAppointmentItemInput, CreateAppointmentInput, CreateAppointmentRequest, AppointmentRange, AppointmentError, AppointmentResult } from '@/features/appointments/types/appointment.types';
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    export type Status = Assert<Equal<AppointmentStatus, 'PENDING'|'CONFIRMED'|'IN_PROGRESS'|'COMPLETED'|'CANCELLED'|'NO_SHOW'>>;
    export type RowKeys = Assert<Equal<keyof AppointmentRow, 'id'|'business_id'|'client_id'|'barber_member_id'|'start_at'|'end_at'|'status'|'notes'|'created_by'|'created_at'|'updated_at'>>;
    export type LineKeys = Assert<Equal<keyof AppointmentServiceRow, 'id'|'appointment_id'|'service_id'|'service_name_snapshot'|'unit_price_snapshot'|'duration_minutes_snapshot'|'quantity'|'line_total'|'created_at'>>;
    export type RowRequired = Assert<Equal<AppointmentRow, Required<AppointmentRow>>>;
    export type LineRequired = Assert<Equal<AppointmentServiceRow, Required<AppointmentServiceRow>>>;
    export type Notes = Assert<Equal<AppointmentRow['notes'], string|null>>;
    export type ServiceFK = Assert<Equal<AppointmentServiceRow['service_id'], string|null>>;
    export type FKs = Assert<Equal<AppointmentRow['business_id'|'client_id'|'barber_member_id'|'created_by'], string>>;
    export type Times = Assert<Equal<AppointmentRow['start_at'|'end_at'|'created_at'|'updated_at'], string>>;
    export type Money = Assert<Equal<AppointmentServiceRow['unit_price_snapshot'|'line_total'], number>>;
    export type InputKeys = Assert<Equal<keyof CreateAppointmentInput, 'requestId'|'clientId'|'barberMemberId'|'startAt'|'items'|'durationOverride'|'notes'>>;
    export type Item = Assert<Equal<CreateAppointmentInput['items'][number], CreateAppointmentItemInput>>;
    export type ItemKeys = Assert<Equal<keyof CreateAppointmentItemInput, 'serviceId'|'quantity'>>;
    export type OptionalNotes = Assert<Equal<CreateAppointmentInput['notes'], string|null|undefined>>;
    export type Override = Assert<Equal<CreateAppointmentInput['durationOverride'], number|undefined>>;
    export type RequestKeys = Assert<Equal<keyof CreateAppointmentRequest, keyof CreateAppointmentInput|'businessId'>>;
    export type Range = Assert<Equal<AppointmentRange, {from:string;to:string}>>;
    export type ErrorKeys = Assert<Equal<keyof AppointmentError<'TEST_ERROR'>, 'code'|'message'>>;
    const input = { requestId:'request', clientId:'client', barberMemberId:'member', startAt:'2026-01-01T10:00:00Z', items:[{serviceId:'service',quantity:1}] } satisfies CreateAppointmentInput;
    const request = {...input, businessId:'context-business', notes:null, durationOverride:45} satisfies CreateAppointmentRequest;
    const row = {id:'appointment',business_id:'business',client_id:'client',barber_member_id:'member',start_at:'2026-01-01T10:00:00Z',end_at:'2026-01-01T10:30:00Z',status:'PENDING',notes:null,created_by:'user',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'} satisfies AppointmentRow;
    const line = {id:'line',appointment_id:'appointment',service_id:null,service_name_snapshot:'Corte',unit_price_snapshot:0.29,duration_minutes_snapshot:30,quantity:1,line_total:0.29,created_at:'2026-01-01T00:00:00Z'} satisfies AppointmentServiceRow;
    // @ts-expect-error Statuses are a readonly literal tuple.
    APPOINTMENT_STATUSES.push('PENDING');
    // @ts-expect-error No invented status.
    const invalidStatus: AppointmentStatus = 'RESCHEDULED';
    // @ts-expect-error Client is required and non-null.
    const nullClient: AppointmentRow = {...row,client_id:null};
    // @ts-expect-error Barber FK is required and non-null.
    const nullBarber: AppointmentRow = {...row,barber_member_id:null};
    // @ts-expect-error Creator is required and non-null.
    const nullCreator: AppointmentRow = {...row,created_by:null};
    // @ts-expect-error No Date object in database row.
    const dateRow: AppointmentRow = {...row,start_at:new Date()};
    // @ts-expect-error DB nullable field is required, not optional.
    const missingNotes: AppointmentRow = {id:'a'};
    // @ts-expect-error Line ownership derives from appointment, no tenant field.
    const tenantLine: AppointmentServiceRow = {...line,business_id:'other'};
    // @ts-expect-error Context tenant is not caller service input.
    const tenantInput: CreateAppointmentInput = {...input,businessId:'other'};
    // @ts-expect-error Status cannot be supplied by create caller (COMPLETED is not a create shortcut).
    const statusInput: CreateAppointmentInput = {...input,status:'COMPLETED'};
    // @ts-expect-error Caller cannot supply snapshots.
    const snapshot: CreateAppointmentItemInput = {serviceId:'s',quantity:1,unit_price_snapshot:1};
    // @ts-expect-error Both range endpoints mandatory.
    const incompleteRange: AppointmentRange = {from:'2026-01-01T00:00:00Z'};
    // @ts-expect-error Range stays instant strings.
    const dateRange: AppointmentRange = {from:new Date(),to:new Date()};
    // @ts-expect-error No technical detail in the safe error shape.
    const unsafeError: AppointmentError<'TEST_ERROR'> = {code:'TEST_ERROR',message:'safe',details:'private'};
    // @ts-expect-error Failure cannot expose data with an error.
    const invalidResult: AppointmentResult<AppointmentRow,'TEST_ERROR'> = {data:row,error:{code:'TEST_ERROR',message:'safe'}};
    function consume(result:AppointmentResult<AppointmentRow,'TEST_ERROR'>){
      if(result.error!==null){const absent:null=result.data;const code:'TEST_ERROR'=result.error.code;return code;}
      const data:AppointmentRow=result.data;return data.id;
    }
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) =>
    path.resolve(name) === virtualFile
      ? ts.createSourceFile(name, source, options.target ?? ts.ScriptTarget.Latest, true)
      : original(name, ...args);
  const program = ts.createProgram(
    [virtualFile, ...fileNames.filter((name) => name.endsWith('.d.ts'))],
    { ...options, noEmit: true },
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    }),
  );
});

test('BF140 module has no external dependency or implementation beyond status values', () => {
  assert.equal(sourceFile.statements.some(ts.isImportDeclaration), false);
  assert.equal(sourceFile.statements.some(ts.isEnumDeclaration), false);
  assert.equal(sourceFile.statements.some(ts.isFunctionDeclaration), false);
  assert.doesNotMatch(text, /\bany\b|canOverride|blockingStatuses|completeAppointment|Date\(/);
});
