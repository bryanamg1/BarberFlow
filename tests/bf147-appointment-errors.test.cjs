/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/appointments/services/appointmentErrors.ts');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleUnderTest = { exports: {} };
vm.runInThisContext(`(function(module,exports){${compiled}\n})`, { filename })(
  moduleUnderTest,
  moduleUnderTest.exports,
);
const { mapAppointmentError: map } = moduleUnderTest.exports;
const codes = [
  'APPOINTMENT_NOT_FOUND',
  'APPOINTMENT_CONFLICT',
  'INVALID_APPOINTMENT',
  'APPOINTMENT_ACCESS_DENIED',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
];
const privateText = 'public.appointments tenant-private policy_private 23505 SELECT * private';
function check(input, code) {
  const result = map(input);
  assert.equal(result.code, code);
  assert.deepEqual(Object.keys(result).sort(), ['code', 'message']);
  assert.equal(typeof result.message, 'string');
  assert(result.message.length > 0);
  assert(!result.message.includes(privateText));
  return result;
}

test('BF147 exposes only one pure adapter and exactly the six READY domain codes', () => {
  assert.deepEqual(Object.keys(moduleUnderTest.exports), ['mapAppointmentError']);
  for (const code of codes) check(code, code);
  for (const code of ['APPOINTMENT_VALIDATION_ERROR', 'APPOINTMENT_INVALID_STATE', 'OTHER']) {
    check(code, 'UNKNOWN_ERROR');
  }
});

test('BF147 null/undefined and SDK success remain no error, including empty/missing data', () => {
  for (const input of [
    null,
    undefined,
    { data: [], error: null, status: 200 },
    { data: null, error: null, status: 200 },
    { error: undefined },
  ]) {
    assert.equal(map(input), null);
  }
  // Absence is contextual: this adapter cannot decide whether the operation was a detail read.
  check('APPOINTMENT_NOT_FOUND', 'APPOINTMENT_NOT_FOUND');
});

test('BF147 SDK transport response status zero is network, without inspecting message', () => {
  for (const message of ['', privateText, 'not a network description']) {
    check({ error: { code: '', message, hint: privateText }, status: 0 }, 'NETWORK_ERROR');
  }
});

test('BF147 structurally identified status-zero rejection is network', () => {
  check(Object.assign(new Error(privateText), { status: 0 }), 'NETWORK_ERROR');
  check({ status: 0, message: privateText }, 'NETWORK_ERROR');
});

test('BF147 status-zero transport has priority over access indicators', () => {
  check({ status: 0, error: { code: '42501' } }, 'NETWORK_ERROR');
});

test('BF147 HTTP 401 and 403 SDK responses map to access denied', () => {
  for (const status of [401, 403]) {
    check(
      { status, error: { code: 'unrecognized', message: privateText } },
      'APPOINTMENT_ACCESS_DENIED',
    );
    check({ status, message: privateText }, 'APPOINTMENT_ACCESS_DENIED');
  }
});

test('BF147 SQLSTATE 42501 maps to access denied, raw or wrapped', () => {
  const error = { code: '42501', message: privateText, details: privateText, hint: privateText };
  check(error, 'APPOINTMENT_ACCESS_DENIED');
  check({ status: 400, error }, 'APPOINTMENT_ACCESS_DENIED');
});

test('BF147 numeric HTTP statuses and SQLSTATE strings are not coerced', () => {
  for (const status of ['0', '401', '403']) check({ status }, 'UNKNOWN_ERROR');
  check({ code: 42501 }, 'UNKNOWN_ERROR');
});

test('BF147 missing and RLS-invisible detail use the same explicit safe domain signal', () => {
  const missing = check('APPOINTMENT_NOT_FOUND', 'APPOINTMENT_NOT_FOUND');
  const invisible = check('APPOINTMENT_NOT_FOUND', 'APPOINTMENT_NOT_FOUND');
  assert.deepEqual(missing, invisible);
  assert.equal(missing.message, 'No se encontró el turno o no está disponible.');
});

test('BF147 does not mistake singular-response cardinality errors for proven absence', () => {
  // PGRST116 may indicate zero OR multiple rows. No free-form details parsing.
  for (const code of ['PGRST116', 'P0002']) {
    check({ code, details: privateText, message: privateText }, 'UNKNOWN_ERROR');
  }
});

test('BF147 failed caller validation is an explicit INVALID_APPOINTMENT signal', () => {
  check('INVALID_APPOINTMENT', 'INVALID_APPOINTMENT');
  // A future service owns safeParse; the technical mapper neither parses input nor walks issues.
  check(
    { name: 'ZodError', issues: [{ message: privateText, path: ['private'] }] },
    'UNKNOWN_ERROR',
  );
});

test('BF147 conflict is a domain signal without invented technical RPC/SQLSTATE mapping', () => {
  check('APPOINTMENT_CONFLICT', 'APPOINTMENT_CONFLICT');
  for (const code of ['23P01', '23505', 'P0001', 'APPOINTMENT_CONFLICT']) {
    check({ code, message: 'APPOINTMENT_CONFLICT', details: privateText }, 'UNKNOWN_ERROR');
  }
  check({ status: 409, error: { code: '23505' } }, 'UNKNOWN_ERROR');
});

test('BF147 invalid lifecycle state is not a separate unapproved public code', () => {
  for (const code of ['APPOINTMENT_INVALID_STATE', 'INVALID_STATUS', '22023', '23514']) {
    check({ code, message: privateText }, 'UNKNOWN_ERROR');
  }
  check('APPOINTMENT_INVALID_STATE', 'UNKNOWN_ERROR');
});

test('BF147 arbitrary errors/rejections do not become network automatically', () => {
  for (const error of [
    new Error(privateText),
    new TypeError('Failed to fetch'),
    'Failed to fetch',
    '',
    false,
    0,
    1,
    [],
    {},
    Symbol('error'),
    10n,
    { name: 'FetchError', message: privateText },
    { code: 'ECONNRESET' },
  ]) {
    check(error, 'UNKNOWN_ERROR');
  }
});

test('BF147 malicious message/details/hint/stack values never reach public errors', () => {
  for (const input of [
    { status: 0, error: { message: privateText, details: privateText, hint: privateText } },
    { code: '42501', message: privateText, details: privateText, hint: privateText },
    {
      code: '23505',
      message: privateText,
      details: privateText,
      hint: privateText,
      stack: privateText,
    },
  ]) {
    const result = map(input);
    assert.deepEqual(Object.keys(result).sort(), ['code', 'message']);
    for (const fragment of [
      'public.appointments',
      'tenant-private',
      'policy_private',
      '23505',
      'SELECT',
    ]) {
      assert(!JSON.stringify(result).includes(fragment));
    }
  }
});

test('BF147 classification is unchanged by message prose and does not read sensitive fields', () => {
  const error = { code: '42501' };
  for (const field of ['message', 'details', 'hint', 'stack']) {
    Object.defineProperty(error, field, {
      get() {
        throw new Error('must not read');
      },
    });
  }
  check(error, 'APPOINTMENT_ACCESS_DENIED');
  for (const message of ['conflict', 'not found', 'network', privateText]) {
    assert.deepEqual(map({ code: '42501', message }), map(error));
    check({ message }, 'UNKNOWN_ERROR');
  }
});

test('BF147 unknown objects with throwing accessors/proxies fail safely', () => {
  const throwing = {};
  Object.defineProperty(throwing, 'status', {
    get() {
      throw new Error(privateText);
    },
  });
  check(throwing, 'UNKNOWN_ERROR');
  check(
    new Proxy(
      {},
      {
        has() {
          throw new Error(privateText);
        },
      },
    ),
    'UNKNOWN_ERROR',
  );
});

test('BF147 inputs are not mutated and output objects are independent', () => {
  const cause = Object.freeze({ code: '42501', message: privateText });
  const input = Object.freeze({ error: cause, status: 403 });
  const before = JSON.stringify(input);
  const result = check(input, 'APPOINTMENT_ACCESS_DENIED');
  result.message = privateText;
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(map(input).message, privateText);
});

test('BF147 no arbitrary prototype key can select a public message', () => {
  for (const value of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    check(value, 'UNKNOWN_ERROR');
  }
});

test('BF147 public types have exactly approved codes and code/message envelope', () => {
  const virtualFile = path.join(root, 'tests/__bf147_type_contract__.ts');
  const contract = `
    import {mapAppointmentError} from '@/features/appointments/services/appointmentErrors';
    import type {AppointmentErrorCode,AppointmentServiceError} from '@/features/appointments/services/appointmentErrors';
    import type {AppointmentError,AppointmentResult,AppointmentRow} from '@/features/appointments/types/appointment.types';
    type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true>=T;
    export type Codes=Assert<Equal<AppointmentErrorCode,'APPOINTMENT_NOT_FOUND'|'APPOINTMENT_CONFLICT'|'INVALID_APPOINTMENT'|'APPOINTMENT_ACCESS_DENIED'|'NETWORK_ERROR'|'UNKNOWN_ERROR'>>;
    export type Keys=Assert<Equal<keyof AppointmentServiceError,'code'|'message'>>;
    export type Compatible=Assert<Equal<AppointmentServiceError,AppointmentError<AppointmentErrorCode>>>;
    export type Output=Assert<Equal<ReturnType<typeof mapAppointmentError>,AppointmentServiceError|null>>;
    const failure:AppointmentResult<AppointmentRow,AppointmentErrorCode>={data:null,error:{code:'INVALID_APPOINTMENT',message:'seguro'}};
    // @ts-expect-error No new invalid-state public code.
    const invalid:AppointmentErrorCode='APPOINTMENT_INVALID_STATE';
    // @ts-expect-error No renamed validation code.
    const validation:AppointmentErrorCode='APPOINTMENT_VALIDATION_ERROR';
    // @ts-expect-error No public technical metadata.
    const leaked:AppointmentServiceError={code:'UNKNOWN_ERROR',message:'seguro',details:'private'};
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtualFile
      ? ts.createSourceFile(file, contract, options.target ?? ts.ScriptTarget.Latest, true)
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
