/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/purchases/schemas/purchase.schema.ts');
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
const schema = schemaModule.exports.completePurchaseSchema;
const line = { productId: 'product-original', quantity: 1, unitCost: '0.29' };
const minimal = {
  operationId: 'operation-original',
  supplierName: 'Proveedor',
  expenseCategoryId: 'category-original',
  paymentMethod: 'CASH',
  purchasedAt: '2026-01-01T00:00:00Z',
  items: [line],
};
const invalid = (value, field) => {
  const result = schema.safeParse(value);
  assert.equal(result.success, false);
  if (field) assert(result.error.issues.some((issue) => issue.path.includes(field)));
};

test('BF210 exposes only the completion input schema', () => {
  assert.deepEqual(Object.keys(schemaModule.exports), ['completePurchaseSchema']);
});
test('BF210 minimal input has no manufactured defaults or server-owned fields', () => {
  assert.deepEqual(schema.parse(minimal), minimal);
  assert.equal(Object.hasOwn(schema.parse(minimal), 'notes'), false);
});
test('BF210 full input preserves supplier, notes, IDs and zoned timestamp text', () => {
  const input = {
    ...minimal,
    operationId: ' operation-original ',
    supplierName: '  Proveedor  ',
    expenseCategoryId: ' category-original ',
    notes: '  Nota\noriginal  ',
    purchasedAt: '2020-02-29T10:30:00.123456-03:00',
    items: [{ ...line, productId: ' product-original ' }],
  };
  assert.deepEqual(schema.parse(input), input);
});
test('BF210 missing required fields and nulls fail without fallback', () => {
  for (const field of Object.keys(minimal)) {
    const missing = { ...minimal };
    delete missing[field];
    invalid(missing, field);
    invalid({ ...minimal, [field]: null }, field);
  }
});
test('BF210 supplier follows SQL space trimming only for validation', () => {
  for (const supplierName of ['', '   ', 1, null])
    invalid({ ...minimal, supplierName }, 'supplierName');
  assert.equal(schema.parse({ ...minimal, supplierName: '\t' }).supplierName, '\t');
});
test('BF210 identifiers reject blank/wrong types without UUID rules or rewriting', () => {
  for (const field of ['operationId', 'expenseCategoryId']) {
    for (const value of ['', ' \n\t ', 1]) invalid({ ...minimal, [field]: value }, field);
  }
  for (const productId of ['', '\t ', null, 1])
    invalid({ ...minimal, items: [{ ...line, productId }] }, 'productId');
});
test('BF210 notes distinguish absence, undefined, null, empty and original text', () => {
  for (const notes of [undefined, null, '', '  original  ']) {
    assert.equal(schema.parse({ ...minimal, notes }).notes, notes);
  }
  for (const notes of [1, false, {}]) invalid({ ...minimal, notes }, 'notes');
});
test('BF210 accepts exactly the five HD006 methods', () => {
  for (const paymentMethod of [
    'CASH',
    'BANK_TRANSFER',
    'DEBIT_CARD',
    'CREDIT_CARD',
    'DIGITAL_WALLET',
  ]) {
    assert.equal(schema.parse({ ...minimal, paymentMethod }).paymentMethod, paymentMethod);
  }
  for (const paymentMethod of ['TRANSFER', 'DEBIT', 'CREDIT', 'OTHER', 'STRIPE', 'cash', '', 1]) {
    invalid({ ...minimal, paymentMethod }, 'paymentMethod');
  }
});
test('BF210 requires a real zoned instant, without inventing past/future restrictions', () => {
  for (const purchasedAt of ['2020-02-29T10:30:00.123456Z', '2100-01-01T00:00:00+03:00']) {
    assert.equal(schema.parse({ ...minimal, purchasedAt }).purchasedAt, purchasedAt);
  }
  for (const purchasedAt of [
    '2026-02-29T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-01-01',
    '2026-01-01T00:00:00',
    '2026-01-01T24:00:00Z',
    new Date(),
    0,
  ]) {
    invalid({ ...minimal, purchasedAt }, 'purchasedAt');
  }
});
test('BF210 requires at least one item, and quantity/cost have no defaults', () => {
  invalid({ ...minimal, items: [] }, 'items');
  for (const missing of [
    { productId: 'p', quantity: 1 },
    { productId: 'p', unitCost: '1.00' },
  ]) {
    invalid({ ...minimal, items: [missing] });
  }
});
test('BF210 preserves duplicate lines/order and adds no item-count cap', () => {
  const items = [{ ...line, quantity: 2 }, { ...line }, { ...line, productId: 'other' }];
  assert.deepEqual(schema.parse({ ...minimal, items }).items, items);
  assert.equal(
    schema.parse({ ...minimal, items: Array.from({ length: 150 }, () => ({ ...line })) }).items
      .length,
    150,
  );
});
test('BF210 duplicate product costs must agree, with exact decimal comparison', () => {
  const items = [
    { ...line, unitCost: '1.00' },
    { ...line, unitCost: '01.00' },
  ];
  assert.deepEqual(schema.parse({ ...minimal, items }).items, items);
  invalid({ ...minimal, items: [line, { ...line, unitCost: '0.30' }] }, 'unitCost');
  invalid({ ...minimal, items: [{ ...line, unitCost: '0.00' }, line] }, 'unitCost');
});
test('BF210 quantity follows positive int4 boundaries without coercion', () => {
  for (const quantity of [1, 2147483647]) {
    assert.equal(
      schema.parse({ ...minimal, items: [{ ...line, quantity, unitCost: '0.00' }] }).items[0]
        .quantity,
      quantity,
    );
  }
  for (const quantity of [0, -1, 1.5, 2147483648, '1', NaN, Infinity, null]) {
    invalid({ ...minimal, items: [{ ...line, quantity }] }, 'quantity');
  }
});
test('BF210 unit costs are exact two-decimal strings, including zero and DB maximum', () => {
  for (const unitCost of ['0.00', '0.29', '1.01', '9999999999.99']) {
    assert.equal(
      schema.parse({ ...minimal, items: [{ ...line, unitCost }] }).items[0].unitCost,
      unitCost,
    );
  }
});
test('BF210 rejects floats, nonfinite values, excess scale and ambiguous money syntax', () => {
  for (const unitCost of [
    0,
    0.29,
    NaN,
    Infinity,
    -Infinity,
    'NaN',
    'Infinity',
    '-0.01',
    '+1.00',
    '1',
    '1.0',
    '1.000',
    '1e2',
    '1,00',
    ' 1.00',
    '1.00 ',
    '10000000000.00',
    null,
    undefined,
  ]) {
    assert.doesNotThrow(() => invalid({ ...minimal, items: [{ ...line, unitCost }] }, 'unitCost'));
  }
});
test('BF210 exact line arithmetic rejects DB overflow without exposing a calculated total', () => {
  invalid({ ...minimal, items: [{ ...line, quantity: 2, unitCost: '5000000000.00' }] }, 'unitCost');
  const parsed = schema.parse({ ...minimal, items: [{ ...line, quantity: 3, unitCost: '0.29' }] });
  assert.deepEqual(parsed.items[0], { ...line, quantity: 3 });
  assert.equal(Object.hasOwn(parsed.items[0], 'line_total'), false);
});
test('BF210 total arithmetic rejects overflow across individually valid lines', () => {
  invalid(
    {
      ...minimal,
      items: [
        { ...line, unitCost: '5000000000.00' },
        { ...line, productId: 'other', unitCost: '5000000000.00' },
      ],
    },
    'items',
  );
  assert(
    schema.safeParse({
      ...minimal,
      items: [
        { ...line, unitCost: '9999999999.98' },
        { ...line, productId: 'other', unitCost: '0.01' },
      ],
    }).success,
  );
});
test('BF210 zero-cost purchases are valid and do not require a made-up minimum total', () => {
  assert(
    schema.safeParse({ ...minimal, items: [{ ...line, quantity: 2147483647, unitCost: '0.00' }] })
      .success,
  );
});
test('BF210 strips tenant, identity, audit, status, stock and total injection', () => {
  const input = {
    ...minimal,
    id: 'forged',
    business_id: 'foreign',
    businessId: 'foreign',
    created_by: 'foreign',
    created_at: 'forged',
    updated_at: 'forged',
    status: 'COMPLETED',
    total: '0.00',
    supplier_id: 'forged',
    stock: 999,
    voided_at: 'forged',
  };
  assert.deepEqual(schema.parse(input), minimal);
});
test('BF210 strips item snapshots, prices, audit and ledger fields without mutating input', () => {
  const original = {
    ...line,
    id: 'forged',
    product_name_snapshot: 'forged',
    unit_cost_snapshot: 0,
    line_total: 0,
    sale_price: 0,
    current_stock: 999,
    quantity_delta: 99,
    created_at: 'forged',
  };
  const input = { ...minimal, items: [original] };
  assert.deepEqual(schema.parse(input), minimal);
  assert.equal(input.items[0].current_stock, 999);
});
test('BF210 persisted row types match every actual DB column and nullability', () => {
  const source = ts.createSourceFile(
    'purchase.types.ts',
    fs.readFileSync(path.join(root, 'src/features/purchases/types/purchase.types.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const [typeName, migration] of [
    ['PurchaseRow', '20261007004520_purchases.sql'],
    ['PurchaseItemRow', '20261007164042_purchase_items.sql'],
  ]) {
    const members = source.statements.find(
      (node) => ts.isTypeAliasDeclaration(node) && node.name.text === typeName,
    ).type.members;
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8');
    const columns = [
      ...sql.matchAll(/^  (\w+) (uuid|text|timestamptz|integer|numeric\(12,2\))([^\n]*),?$/gm),
    ];
    assert.deepEqual(
      members.map((m) => m.name.getText(source)),
      columns.map((c) => c[1]),
    );
    for (const [index, column] of columns.entries()) {
      const base =
        column[1] === 'status'
          ? 'PurchaseStatus'
          : /^(integer|numeric)/.test(column[2])
            ? 'number'
            : 'string';
      assert.equal(members[index].questionToken, undefined);
      assert.equal(
        members[index].type.getText(source),
        base + (column[3].includes('NOT NULL') ? '' : ' | null'),
      );
    }
  }
});
test('BF210 inferred input and row contracts are enforced by TypeScript', () => {
  const virtualFile = path.join(root, 'tests/__bf210_contract__.ts');
  const source = `
    import type { CompletePurchaseInput,CompletePurchaseItemInput } from '@/features/purchases/schemas/purchase.schema';
    import type { PurchaseRow,PurchaseItemRow,PurchaseStatus } from '@/features/purchases/types/purchase.types';
    type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true> = T;
    export type Keys = Assert<Equal<keyof CompletePurchaseInput,'operationId'|'supplierName'|'expenseCategoryId'|'paymentMethod'|'purchasedAt'|'notes'|'items'>>;
    export type Item = Assert<Equal<CompletePurchaseInput['items'][number],CompletePurchaseItemInput>>;
    export type Cost = Assert<Equal<CompletePurchaseItemInput['unitCost'],string>>;
    export type Method = Assert<Equal<CompletePurchaseInput['paymentMethod'],'CASH'|'BANK_TRANSFER'|'DEBIT_CARD'|'CREDIT_CARD'|'DIGITAL_WALLET'>>;
    export type Status = Assert<Equal<PurchaseStatus,'DRAFT'|'COMPLETED'|'VOIDED'>>;
    export type NullableTime = Assert<Equal<PurchaseRow['purchased_at'],string|null>>;
    export type Notes = Assert<Equal<CompletePurchaseInput['notes'],string|null|undefined>>;
    export type RowRequired = Assert<Equal<PurchaseRow,Required<PurchaseRow>>>;
    export type RowCost = Assert<Equal<PurchaseItemRow['unit_cost_snapshot'],number>>;
    export type Id = Assert<Equal<PurchaseItemRow['product_id'],string>>;
    // @ts-expect-error Input money is never a JS float.
    const float: CompletePurchaseItemInput = {productId:'p',quantity:1,unitCost:0.29};
    // @ts-expect-error Supplier is required, not nullable.
    const missingSupplier: CompletePurchaseInput = {operationId:'o',supplierName:null,expenseCategoryId:'c',paymentMethod:'CASH',purchasedAt:'date',items:[]};
    // @ts-expect-error Caller cannot send tenant or derived total.
    const tenant: CompletePurchaseInput = {operationId:'o',supplierName:'s',expenseCategoryId:'c',paymentMethod:'CASH',purchasedAt:'date',items:[],business_id:'b',total:1};
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
