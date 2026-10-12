/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const zod = require('zod');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/services/schemas/service.schema.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const schemaModule = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
  (name) => {
    // Exercise actual installed Zod; no SDK, repository, Auth, hooks or UI dependency.
    assert.equal(name, 'zod');
    return zod;
  },
  schemaModule,
  schemaModule.exports,
);
const { createServiceSchema: create, updateServiceSchema: update } = schemaModule.exports;
const minimal = { name: 'Corte clásico', price: 10000, duration_minutes: 30 };

test('BF-130: exports only the two runtime schemas; minimal create has no injected defaults', () => {
  assert.deepEqual(Object.keys(schemaModule.exports).sort(), [
    'createServiceSchema',
    'updateServiceSchema',
  ]);
  assert.deepEqual(create.parse(minimal), minimal);
  assert.equal(create.safeParse({}).success, false);
  assert.equal(Object.hasOwn(create.parse(minimal), 'description'), false);
  assert.equal(Object.hasOwn(create.parse(minimal), 'is_active'), false);
});

for (const field of ['name', 'price', 'duration_minutes']) {
  test(`BF-130: create requires ${field} and rejects null without coercion`, () => {
    const missing = { ...minimal };
    delete missing[field];
    for (const input of [
      missing,
      { ...minimal, [field]: undefined },
      { ...minimal, [field]: null },
    ]) {
      const result = create.safeParse(input);
      assert.equal(result.success, false);
      assert(result.error.issues.some((issue) => issue.path[0] === field));
    }
    assert.equal(update.safeParse({ [field]: null }).success, false);
  });
}

test('BF-130: SQL-style name validation rejects empty/ASCII-space-only and invalid types', () => {
  for (const name of ['', ' ', '    ', null, 1, true, {}, [], new String('A')]) {
    assert.equal(create.safeParse({ ...minimal, name }).success, false);
    assert.equal(update.safeParse({ name }).success, false);
  }
});

test('BF-130: preserves original name and does not broaden PostgreSQL space-trim rules', () => {
  for (const name of [
    '  Corte  ',
    '\t\n',
    '\u00a0',
    ' \t ',
    '李',
    'e\u0301',
    '<text>',
    'A'.repeat(5000),
  ]) {
    assert.deepEqual(create.parse({ ...minimal, name }), { ...minimal, name });
    assert.deepEqual(update.parse({ name }), { name });
  }
});

test('BF-130: description preserves omitted/undefined/null/empty/free text without max length or sanitation', () => {
  for (const description of [
    undefined,
    null,
    '',
    '   ',
    '\t\n',
    '<b>Texto</b>',
    'X'.repeat(5000),
  ]) {
    const input = { ...minimal, description };
    assert.deepEqual(create.parse(input), input);
    if (description !== undefined) assert.deepEqual(update.parse({ description }), { description });
  }
  for (const description of [0, true, {}, [], new String('text')]) {
    assert.equal(create.safeParse({ ...minimal, description }).success, false);
    assert.equal(update.safeParse({ description }).success, false);
  }
});

test('BF-130: duration accepts every positive int4 minute, with no schedule increments', () => {
  for (const duration_minutes of [1, 7, 13, 15, 30, 1441, 2_147_483_647]) {
    assert.deepEqual(create.parse({ ...minimal, duration_minutes }), {
      ...minimal,
      duration_minutes,
    });
    assert.deepEqual(update.parse({ duration_minutes }), { duration_minutes });
  }
});

test('BF-130: duration rejects zero, negative, fractional, nonfinite, overflow and coerced values', () => {
  for (const duration_minutes of [
    0,
    -0,
    -1,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    2_147_483_648,
    Number.MAX_SAFE_INTEGER,
    '30',
    true,
    null,
    {},
    [],
    30n,
  ]) {
    assert.equal(create.safeParse({ ...minimal, duration_minutes }).success, false);
    assert.equal(update.safeParse({ duration_minutes }).success, false);
  }
});

test('BF-130: catalog number prices preserve zero, binary-sensitive cents and numeric12,2 boundaries', () => {
  for (const price of [
    0, -0, 0.01, 0.29, 1.01, 1.15, 1.1, 19.99, 10000, 9_999_999_999.98, 9_999_999_999.99,
  ]) {
    assert.deepEqual(create.parse({ ...minimal, price }), { ...minimal, price });
    assert.deepEqual(update.parse({ price }), { price });
  }
});

test('BF-130: all hundredths in a representative catalog range validate without binary modulo rejection', () => {
  for (let cents = 0; cents < 10000; cents++) {
    const price = cents / 100;
    assert.equal(create.parse({ ...minimal, price }).price, price);
  }
});

test('BF-130: excess monetary precision is rejected, never silently rounded', () => {
  for (const price of [
    0.001,
    1.001,
    1.999,
    9_999_999_999.999,
    0.1 + 0.2,
    1e-7,
    Number.MIN_VALUE,
    0.29000000000000004,
  ]) {
    assert.equal(create.safeParse({ ...minimal, price }).success, false);
    assert.equal(update.safeParse({ price }).success, false);
  }
});

test('BF-130: price rejects negatives, NaN/infinity, numeric overflow and nonnumber inputs', () => {
  for (const price of [
    -0.01,
    -1,
    NaN,
    Infinity,
    -Infinity,
    10_000_000_000,
    Number.MAX_VALUE,
    Number.MAX_SAFE_INTEGER,
    '0.29',
    '10000',
    '1,01',
    '',
    null,
    true,
    {},
    [],
    1n,
  ]) {
    assert.equal(create.safeParse({ ...minimal, price }).success, false);
    assert.equal(update.safeParse({ price }).success, false);
  }
});

test('BF-130: update permits each single field and a multi-field PATCH, including false/null/empty/zero', () => {
  for (const patch of [
    { name: 'Otro' },
    { description: null },
    { description: '' },
    { price: 0 },
    { duration_minutes: 1 },
    { is_active: false },
    { is_active: true },
    { ...minimal, description: null, is_active: false },
    { name: undefined, is_active: false },
  ]) {
    assert.deepEqual(update.parse(patch), patch);
  }
});

test('BF-130: update rejects no recognized defined value after unknown-field stripping', () => {
  for (const input of [
    {},
    { name: undefined },
    { description: undefined },
    { price: undefined },
    { duration_minutes: undefined },
    { is_active: undefined },
    { unknown: 'x' },
    { unknown: 'x', description: undefined },
    { id: 'id', business_id: 'tenant', created_at: 'now', updated_at: 'now' },
  ]) {
    const result = update.safeParse(input);
    assert.equal(result.success, false);
    assert(
      result.error.issues.some(
        (issue) => issue.message === 'Ingresa al menos un campo para actualizar.',
      ),
    );
  }
});

test('BF-130: is_active belongs only to update and never coerces booleans', () => {
  for (const is_active of [true, false, 'true', 'false', 1, 0, null, {}, []]) {
    assert.deepEqual(create.parse({ ...minimal, is_active }), minimal);
  }
  for (const is_active of ['true', 'false', 1, 0, null, {}, []]) {
    assert.equal(update.safeParse({ is_active }).success, false);
  }
});

test('BF-130: strips tenant/identity/audit/unknown fields and never adds per-service buffer/currency/roles', () => {
  const extra = {
    id: 'id',
    business_id: 'foreign-tenant',
    created_at: 'now',
    updated_at: 'now',
    role: 'OWNER',
    buffer: 10,
    buffer_minutes: 10,
    currency_code: 'ARS',
    unknown: true,
  };
  const input = Object.freeze({ ...minimal, ...extra });
  assert.deepEqual(create.parse(input), minimal);
  assert.deepEqual(update.parse(input), minimal);
  assert.equal(update.safeParse(extra).success, false);
  assert.equal(input.business_id, 'foreign-tenant');
});

test('BF-130: object boundaries reject nonobjects without coercion', () => {
  for (const input of [undefined, null, 'service', 1, false, []]) {
    assert.equal(create.safeParse(input).success, false);
    assert.equal(update.safeParse(input).success, false);
  }
});

test('BF-130: errors provide Spanish copy without echoing rejected input', () => {
  const sensitive = 'synthetic-private-payload';
  const result = create.safeParse({
    name: { sensitive },
    price: sensitive,
    duration_minutes: sensitive,
  });
  assert.equal(result.success, false);
  assert(result.error.issues.every((issue) => /Ingresa/.test(issue.message)));
  assert(!JSON.stringify(result.error.issues).includes(sensitive));
});

test('BF-130: inferred TypeScript types match exact create/update allowlists and numeric catalog inputs', () => {
  const virtualFile = path.join(root, 'tests/__bf130_type_contract__.ts');
  const source = `
    import { z } from 'zod';
    import { createServiceSchema, updateServiceSchema, type CreateServiceInput, type UpdateServiceInput } from '@/features/services/schemas/service.schema';
    type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true> = T;
    type ExpectedCreate = { name: string; description?: string|null; price: number; duration_minutes: number };
    type ExpectedUpdate = Partial<ExpectedCreate> & { is_active?: boolean };
    export type Create = Assert<Equal<CreateServiceInput,ExpectedCreate>>;
    export type Update = Assert<Equal<UpdateServiceInput,{[K in keyof ExpectedUpdate]:ExpectedUpdate[K]}>>;
    export type InferCreate = Assert<Equal<CreateServiceInput,z.infer<typeof createServiceSchema>>>;
    export type InferUpdate = Assert<Equal<UpdateServiceInput,z.infer<typeof updateServiceSchema>>>;
    // @ts-expect-error Name, price and duration are required.
    const missing: CreateServiceInput = {};
    // @ts-expect-error Catalog price is number, not a coerced string.
    const money: UpdateServiceInput = { price: '1.01' };
    // @ts-expect-error Duration is number, not a coerced string.
    const duration: UpdateServiceInput = { duration_minutes: '30' };
    // @ts-expect-error Name cannot be null.
    const name: UpdateServiceInput = { name: null };
    // @ts-expect-error Create cannot set archive status.
    const active: CreateServiceInput = { name: 'A', price: 0, duration_minutes: 1, is_active: false };
    // @ts-expect-error Tenant is never writable through input.
    const tenant: UpdateServiceInput = { business_id: 'foreign' };
    // @ts-expect-error Audit fields are excluded.
    const audit: UpdateServiceInput = { updated_at: 'now' };
    // @ts-expect-error No per-service buffer.
    const buffer: UpdateServiceInput = { buffer_minutes: 10 };
    void missing; void money; void duration; void name; void active; void tenant; void audit; void buffer;
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const getSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : getSource(file, ...args);
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
