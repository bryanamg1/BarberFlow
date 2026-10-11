/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const zod = require('zod');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/clients/schemas/client.schema.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const schemaModule = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
  (name) => {
    // Actual Zod is the validation boundary; no SDK, Auth, Context, service or UI dependency.
    assert.equal(name, 'zod');
    return zod;
  },
  schemaModule,
  schemaModule.exports,
);
const { createClientSchema, updateClientSchema } = schemaModule.exports;
const minimal = { first_name: 'Synthetic' };
const textFields = ['last_name', 'phone', 'email', 'instagram', 'notes', 'preferences'];

test('BF-110: only two public runtime schemas and minimal create without injected defaults', () => {
  assert.deepEqual(Object.keys(schemaModule.exports).sort(), [
    'createClientSchema',
    'updateClientSchema',
  ]);
  assert.deepEqual(createClientSchema.parse(minimal), minimal);
  assert.equal(createClientSchema.safeParse({}).success, false);
});

test('BF-110: first_name rejects missing/null/nonstrings and whitespace-only without coercion', () => {
  for (const first_name of [
    undefined,
    null,
    '',
    ' ',
    '     ',
    '\t\n',
    '\u00a0',
    1,
    false,
    {},
    [],
    new String('A'),
  ]) {
    const result = createClientSchema.safeParse({ first_name });
    assert.equal(result.success, false);
    assert(result.error.issues.some((issue) => issue.path[0] === 'first_name'));
    assert.equal(updateClientSchema.safeParse({ first_name }).success, false);
  }
});

test('BF-110: first_name preserves outer whitespace, casing, Unicode and unrestricted characters', () => {
  for (const first_name of [
    'B',
    '  Bryan  ',
    '\tÉlodie\n',
    'e\u0301',
    '李',
    '123 <sample>',
    'A'.repeat(5000),
  ]) {
    const input = Object.freeze({ first_name });
    assert.deepEqual(createClientSchema.parse(input), input);
    assert.deepEqual(updateClientSchema.parse(input), input);
  }
});

for (const field of textFields) {
  test(`BF-110: ${field} preserves omission/null/empty/free text and rejects nonstrings`, () => {
    assert(!Object.hasOwn(createClientSchema.parse(minimal), field));
    for (const value of [
      undefined,
      null,
      '',
      '   ',
      '\t\n',
      ' +54 (arbitrary) @Mixed / not-an-email ',
      '["free text"]',
      '<sample>',
      'x'.repeat(5000),
    ]) {
      const input = { ...minimal, [field]: value };
      assert.deepEqual(createClientSchema.parse(input), input);
      if (value !== undefined) {
        const patch = { [field]: value };
        assert.deepEqual(updateClientSchema.parse(patch), patch);
      }
    }
    for (const value of [0, true, {}, [], new String('text')]) {
      assert.equal(createClientSchema.safeParse({ ...minimal, [field]: value }).success, false);
      assert.equal(updateClientSchema.safeParse({ [field]: value }).success, false);
    }
  });
}

test('BF-110: valid civil dates stay exact strings, including leap centuries and future dates', () => {
  for (const birth_date of [
    '2026-01-01',
    '2000-02-29',
    '1995-12-31',
    '2024-02-29',
    '1900-02-28',
    '0001-01-01',
    '0099-12-31',
    '2400-02-29',
    '9999-12-31',
  ]) {
    const input = { ...minimal, birth_date };
    assert.deepEqual(createClientSchema.parse(input), input);
    assert.deepEqual(updateClientSchema.parse({ birth_date }), { birth_date });
    assert.equal(typeof createClientSchema.parse(input).birth_date, 'string');
  }
});

test('BF-110: malformed dates and impossible calendar days cannot roll over or be coerced', () => {
  for (const birth_date of [
    '',
    ' ',
    '2026-1-1',
    '01/01/2026',
    '2026/01/01',
    '2026-02-31',
    '2025-02-29',
    '1900-02-29',
    '2100-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-01-32',
    '0000-01-01',
    'abcd-ef-gh',
    '2026-01-01\n',
    ' 2026-01-01',
    '2026-01-01T00:00:00Z',
    '2026-01-01+03:00',
    20260101,
    false,
    {},
    [],
    new Date('2026-01-01T00:00:00Z'),
  ]) {
    assert.equal(
      createClientSchema.safeParse({ ...minimal, birth_date }).success,
      false,
      String(birth_date),
    );
    assert.equal(updateClientSchema.safeParse({ birth_date }).success, false, String(birth_date));
  }
});

test('BF-110: birth_date can be omitted, undefined or explicitly null without defaults', () => {
  assert.deepEqual(createClientSchema.parse(minimal), minimal);
  for (const birth_date of [undefined, null]) {
    const input = { ...minimal, birth_date };
    assert.deepEqual(createClientSchema.parse(input), input);
  }
  assert.deepEqual(updateClientSchema.parse({ birth_date: null }), { birth_date: null });
});

test('BF-110: update accepts each recognized defined field, including null/false/empty string', () => {
  const patches = [
    { first_name: 'Bryan' },
    { last_name: null },
    { phone: null },
    { email: '' },
    { instagram: ' ' },
    { birth_date: '2000-02-29' },
    { notes: 'Cliente frecuente' },
    { preferences: null },
    { is_active: false },
    { is_active: true },
    { phone: undefined, is_active: false },
  ];
  for (const input of patches) assert.deepEqual(updateClientSchema.parse(input), input);
});

test('BF-110: update requires a recognized defined value after stripping unknown fields', () => {
  const emptyInputs = [
    {},
    { first_name: undefined },
    { phone: undefined },
    { birth_date: undefined },
    { is_active: undefined },
    { random_field: 'x' },
    { random_field: 'x', phone: undefined },
    { id: 'synthetic-id', business_id: 'synthetic-business', created_at: 'now', updated_at: 'now' },
    Object.fromEntries(
      ['first_name', ...textFields, 'birth_date', 'is_active'].map((key) => [key, undefined]),
    ),
  ];
  for (const input of emptyInputs) {
    const result = updateClientSchema.safeParse(input);
    assert.equal(result.success, false);
    assert(
      result.error.issues.some(
        (issue) => issue.message === 'Ingresa al menos un campo para actualizar.',
      ),
    );
  }
});

test('BF-110: is_active is stripped from create and only real booleans are valid for update', () => {
  for (const is_active of [true, false, 'true', 'false', 1, 0, null, {}]) {
    assert.deepEqual(createClientSchema.parse({ ...minimal, is_active }), minimal);
  }
  for (const is_active of ['true', 'false', 1, 0, null, {}, []]) {
    assert.equal(updateClientSchema.safeParse({ is_active }).success, false);
  }
});

test('BF-110: both schemas strip identities, tenant ownership, timestamps and unknown fields', () => {
  const untrusted = {
    id: 'synthetic-id',
    business_id: 'synthetic-business',
    created_at: 'synthetic-date',
    updated_at: 'synthetic-date',
    random_field: 'x',
    role: 'OWNER',
  };
  const input = Object.freeze({ ...minimal, ...untrusted });
  assert.deepEqual(createClientSchema.parse(input), minimal);
  assert.deepEqual(updateClientSchema.parse(input), minimal);
  assert.equal(input.business_id, 'synthetic-business');
});

test('BF-110: object boundaries reject nonobjects without coercion', () => {
  for (const input of [undefined, null, 'client', 1, false, []]) {
    assert.equal(createClientSchema.safeParse(input).success, false);
    assert.equal(updateClientSchema.safeParse(input).success, false);
  }
});

test('BF-110: validation messages do not echo rejected client information', () => {
  const sensitive = 'synthetic-sensitive-input';
  const result = createClientSchema.safeParse({
    first_name: { sensitive },
    birth_date: sensitive,
    phone: { sensitive },
  });
  assert.equal(result.success, false);
  assert(!JSON.stringify(result.error.issues).includes(sensitive));
});

test('BF-110: public types match z.infer and the approved create/update allowlists', () => {
  const virtualFile = path.join(root, 'tests/__bf110_type_contract__.ts');
  const source = `
    import { z } from 'zod';
    import { createClientSchema, updateClientSchema, type CreateClientInput, type UpdateClientInput } from '@/features/clients/schemas/client.schema';
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
      (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    type ExpectedCreate = { first_name: string; last_name?: string|null; phone?: string|null;
      email?: string|null; instagram?: string|null; birth_date?: string|null; notes?: string|null; preferences?: string|null };
    type ExpectedUpdate = Partial<ExpectedCreate> & { is_active?: boolean };
    export type Create = Assert<Equal<CreateClientInput, ExpectedCreate>>;
    export type Update = Assert<Equal<UpdateClientInput, { [K in keyof ExpectedUpdate]: ExpectedUpdate[K] }>>;
    export type InferCreate = Assert<Equal<CreateClientInput, z.infer<typeof createClientSchema>>>;
    export type InferUpdate = Assert<Equal<UpdateClientInput, z.infer<typeof updateClientSchema>>>;
    // @ts-expect-error Name is required in create.
    const missing: CreateClientInput = {};
    // @ts-expect-error Name is not nullable.
    const nullName: UpdateClientInput = { first_name: null };
    // @ts-expect-error Date is a string, not a Date object.
    const date: CreateClientInput = { first_name: 'A', birth_date: new Date() };
    // @ts-expect-error Create cannot set active state.
    const active: CreateClientInput = { first_name: 'A', is_active: false };
    // @ts-expect-error Tenant identity is outside the input contract.
    const tenant: UpdateClientInput = { business_id: 'synthetic' };
    void missing; void nullName; void date; void active; void tenant;
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
