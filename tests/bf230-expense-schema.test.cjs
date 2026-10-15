/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/expenses/schemas/expense.schema.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const schemaModule = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
  (name) => {
    assert.equal(name, 'zod');
    return require('zod');
  },
  schemaModule,
  schemaModule.exports,
);
const { createManualExpenseSchema: create, updateManualExpenseSchema: update } =
  schemaModule.exports;
const minimal = {
  category_id: 'category-original',
  description: '',
  amount: '0.00',
  payment_method: 'CASH',
  expense_date: '2026-01-01',
};
const invalid = (schema, input, field) => {
  const result = schema.safeParse(input);
  assert.equal(result.success, false, `Unexpected success for ${field ?? 'input'}`);
  if (field) assert(result.error.issues.some((issue) => issue.path.includes(field)));
};
const managed = {
  id: 'forged',
  business_id: 'foreign',
  source_type: 'PURCHASE',
  purchase_id: 'foreign',
  created_by: 'foreign',
  created_at: 'forged',
  updated_at: 'forged',
  status: 'VOIDED',
  current_stock: 999,
  signed_url: 'forged',
  unknown: true,
};

test('BF230 exposes only the two approved manual input schemas', () => {
  assert.deepEqual(Object.keys(schemaModule.exports), [
    'createManualExpenseSchema',
    'updateManualExpenseSchema',
  ]);
});
test('BF230 minimal create preserves zero/empty description and invents no defaults', () => {
  assert.deepEqual(create.parse(minimal), minimal);
  assert.equal(Object.hasOwn(create.parse(minimal), 'notes'), false);
  assert.equal(Object.hasOwn(create.parse(minimal), 'receipt_path'), false);
});
test('BF230 full create preserves original strings without trim or decimal normalization', () => {
  const input = {
    ...minimal,
    category_id: ' category ',
    description: '  Texto\noriginal  ',
    amount: '0001.2',
    notes: '  Nota  ',
    receipt_path: ' arbitrary/original path ',
  };
  assert.deepEqual(create.parse(input), input);
});
test('BF230 required fields reject omission, undefined and null', () => {
  for (const field of Object.keys(minimal)) {
    const missing = { ...minimal };
    delete missing[field];
    invalid(create, missing, field);
    for (const value of [undefined, null]) invalid(create, { ...minimal, [field]: value }, field);
  }
});
test('BF230 category is usable text, preserving IDs without existence or UUID validation', () => {
  for (const category_id of ['', ' \t\n ', 1, false, {}])
    invalid(create, { ...minimal, category_id }, 'category_id');
  for (const category_id of ['not-a-uuid', ' archived-or-missing-category '])
    assert.equal(create.parse({ ...minimal, category_id }).category_id, category_id);
});
test('BF230 description accepts empty/whitespace per DB and rejects non-text', () => {
  for (const description of ['', '   ', '\t', '  Original  '])
    assert.equal(create.parse({ ...minimal, description }).description, description);
  for (const description of [1, false, {}])
    invalid(create, { ...minimal, description }, 'description');
});
test('BF230 notes and receipt preserve absence, undefined, null, empty and original text', () => {
  for (const field of ['notes', 'receipt_path']) {
    for (const value of [undefined, null, '', '  original\ntext  ']) {
      assert.equal(create.parse({ ...minimal, [field]: value })[field], value);
      assert.deepEqual(update.parse({ [field]: value === undefined ? null : value }), {
        [field]: value === undefined ? null : value,
      });
    }
    for (const value of [1, false, {}]) invalid(create, { ...minimal, [field]: value }, field);
  }
});
test('BF230 money accepts zero, up to two decimals, leading zeros and exact DB maximum', () => {
  for (const amount of [
    '0',
    '0.0',
    '0.00',
    '0.29',
    '1',
    '1.2',
    '1.23',
    '0001.20',
    '9999999999',
    '9999999999.9',
    '9999999999.99',
  ]) {
    assert.equal(create.parse({ ...minimal, amount }).amount, amount);
    assert.deepEqual(update.parse({ amount }), { amount });
  }
});
test('BF230 money rejects overflow without floating point rounding', () => {
  for (const amount of ['10000000000', '10000000000.00', '99999999999.99', '9999999999.999'])
    invalid(create, { ...minimal, amount }, 'amount');
});
test('BF230 money rejects negatives, excess scale, ambiguous syntax and coercion', () => {
  for (const amount of [
    -1,
    0,
    0.29,
    NaN,
    Infinity,
    -Infinity,
    'NaN',
    'Infinity',
    '-0.01',
    '-0',
    '+1',
    '1.000',
    '0.001',
    '1e2',
    '1,00',
    '.50',
    '1.',
    ' 1.00',
    '1.00 ',
    '',
    '0x10',
    {},
    [],
  ]) {
    assert.doesNotThrow(() => invalid(create, { ...minimal, amount }, 'amount'));
    assert.doesNotThrow(() => invalid(update, { amount }, 'amount'));
  }
});
test('BF230 accepts exactly the five HD006 input methods', () => {
  for (const payment_method of [
    'CASH',
    'BANK_TRANSFER',
    'DEBIT_CARD',
    'CREDIT_CARD',
    'DIGITAL_WALLET',
  ]) {
    assert.equal(create.parse({ ...minimal, payment_method }).payment_method, payment_method);
    assert.deepEqual(update.parse({ payment_method }), { payment_method });
  }
});
test('BF230 rejects legacy payment aliases instead of translating them', () => {
  for (const payment_method of [
    'TRANSFER',
    'DEBIT',
    'CREDIT',
    'OTHER',
    'CARD',
    'MERCADOPAGO',
    'cash',
    '',
    1,
  ]) {
    invalid(create, { ...minimal, payment_method }, 'payment_method');
    invalid(update, { payment_method }, 'payment_method');
  }
});
test('BF230 civil dates preserve leap years and approved year boundaries', () => {
  for (const expense_date of [
    '0001-01-01',
    '9999-12-31',
    '2000-02-29',
    '2024-02-29',
    '1900-02-28',
    '2026-12-31',
  ]) {
    assert.equal(create.parse({ ...minimal, expense_date }).expense_date, expense_date);
    assert.deepEqual(update.parse({ expense_date }), { expense_date });
  }
});
test('BF230 rejects nonexistent civil dates, year zero and timestamps', () => {
  for (const expense_date of [
    '0000-01-01',
    '10000-01-01',
    '1900-02-29',
    '2100-02-29',
    '2023-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-01-32',
    '2026-1-1',
    '2026-01-01T00:00:00Z',
    ' 2026-01-01',
    new Date('2026-01-01T00:00:00Z'),
    0,
  ])
    invalid(create, { ...minimal, expense_date }, 'expense_date');
});
test('BF230 update accepts each editable field separately with no absent defaults', () => {
  for (const [field, value] of Object.entries({ ...minimal, notes: null, receipt_path: null }))
    assert.deepEqual(update.parse({ [field]: value }), { [field]: value });
});
test('BF230 update rejects empty, unknown/server-only and undefined-only payloads', () => {
  for (const input of [
    {},
    managed,
    { description: undefined },
    { notes: undefined, receipt_path: undefined },
    { amount: undefined, ...managed },
  ])
    invalid(update, input);
});
test('BF230 create strips server-owned/unknown fields without mutating the caller', () => {
  const input = { ...minimal, ...managed };
  assert.deepEqual(create.parse(input), minimal);
  assert.equal(input.source_type, 'PURCHASE');
  assert.equal(input.business_id, 'foreign');
});
test('BF230 update strips server-owned/unknown fields and preserves nullable edits', () => {
  assert.deepEqual(update.parse({ ...managed, notes: null, description: '' }), {
    description: '',
    notes: null,
  });
});
test('BF230 row matches all 14 real DB columns and nullability, including raw payment text', () => {
  const source = ts.createSourceFile(
    'expense.types.ts',
    fs.readFileSync(path.join(root, 'src/features/expenses/types/expense.types.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const members = source.statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === 'ExpenseRow',
  ).type.members;
  const sql = fs.readFileSync(
    path.join(root, 'supabase/migrations/20261007172019_expenses.sql'),
    'utf8',
  );
  const columns = [
    ...sql.matchAll(/^  (\w+) (uuid|text|timestamptz|date|numeric\(12,2\))([^\n]*),?$/gm),
  ];
  assert.equal(columns.length, 14);
  assert.deepEqual(
    members.map((m) => m.name.getText(source)),
    columns.map((c) => c[1]),
  );
  for (const [index, column] of columns.entries()) {
    const base =
      column[1] === 'source_type'
        ? "'MANUAL' | 'PURCHASE'"
        : column[1] === 'amount'
          ? 'number'
          : 'string';
    assert.equal(members[index].questionToken, undefined);
    assert.equal(
      members[index].type.getText(source),
      base + (column[3].includes('NOT NULL') ? '' : ' | null'),
    );
  }
});
test('BF230 inferred inputs and SDK row contracts compile without widening money or methods', () => {
  const virtualFile = path.join(root, 'tests/__bf230_contract__.ts');
  const source = `
    import type { CreateManualExpenseInput as Create, UpdateManualExpenseInput as Update } from '@/features/expenses/schemas/expense.schema';
    import type { ExpenseRow } from '@/features/expenses/types/expense.types';
    type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true> = T;
    export type Keys = Assert<Equal<keyof Create,'category_id'|'description'|'amount'|'payment_method'|'expense_date'|'receipt_path'|'notes'>>;
    export type PartialUpdate = Assert<Equal<Update,Partial<Create>>>;
    export type Money = Assert<Equal<Create['amount'],string>>;
    export type Method = Assert<Equal<Create['payment_method'],'CASH'|'BANK_TRANSFER'|'DEBIT_CARD'|'CREDIT_CARD'|'DIGITAL_WALLET'>>;
    export type Notes = Assert<Equal<Create['notes'],string|null|undefined>>;
    export type Receipt = Assert<Equal<Create['receipt_path'],string|null|undefined>>;
    export type RowAmount = Assert<Equal<ExpenseRow['amount'],number>>;
    export type RowMethod = Assert<Equal<ExpenseRow['payment_method'],string>>;
    export type RowSource = Assert<Equal<ExpenseRow['source_type'],'MANUAL'|'PURCHASE'>>;
    export type RowPurchase = Assert<Equal<ExpenseRow['purchase_id'],string|null>>;
    export type RequiredRow = Assert<Equal<ExpenseRow,Required<ExpenseRow>>>;
    const valid: Create = {category_id:'c',description:'',amount:'0.00',payment_method:'CASH',expense_date:'2026-01-01'};
    // @ts-expect-error No JS floats in input money.
    const float: Create = {...valid,amount:0.29};
    // @ts-expect-error Legacy enum is not application input.
    const legacy: Create = {...valid,payment_method:'TRANSFER'};
    // @ts-expect-error Caller cannot supply tenant or source.
    const tenant: Create = {...valid,business_id:'foreign',source_type:'PURCHASE'};
    // @ts-expect-error Mandatory fields remain required.
    const missing: Create = {category_id:'c'};
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
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
