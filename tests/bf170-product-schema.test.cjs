/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const zod = require('zod');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/products/schemas/product.schema.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const schemaModule = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
  (name) => {
    assert.equal(name, 'zod');
    return zod;
  },
  schemaModule,
  schemaModule.exports,
);
const { createProductSchema: create, updateProductSchema: update } = schemaModule.exports;
const minimal = { name: 'Cera mate', sale_price: 12000, default_purchase_cost: 6500 };

test('BF170 exposes only two runtime schemas, with the approved minimum-stock default', () => {
  assert.deepEqual(Object.keys(schemaModule.exports).sort(), [
    'createProductSchema',
    'updateProductSchema',
  ]);
  assert.deepEqual(create.parse(minimal), { ...minimal, minimum_stock: 0 });
  assert.deepEqual(create.parse({ ...minimal, minimum_stock: undefined }), {
    ...minimal,
    minimum_stock: 0,
  });
  assert.equal(Object.hasOwn(create.parse(minimal), 'category_id'), false);
  assert.equal(Object.hasOwn(create.parse(minimal), 'is_active'), false);
});

test('BF170 complete create preserves values including uncategorized and optional metadata', () => {
  const input = {
    ...minimal,
    category_id: 'category-id',
    description: '  Original  ',
    sku: ' BF-CAB-001 ',
    minimum_stock: 3,
  };
  assert.deepEqual(create.parse(input), input);
  assert.deepEqual(update.parse(input), input);
  assert.equal(create.parse({ ...minimal, category_id: null }).category_id, null);
});

for (const field of ['name', 'sale_price', 'default_purchase_cost']) {
  test(`BF170 ${field} is required, non-nullable and has no invented default`, () => {
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

test('BF170 name validation matches SQL spaces without trim, normalization or length limits', () => {
  for (const name of ['', ' ', '    ', null, 1, true, {}, [], new String('A')]) {
    assert.equal(create.safeParse({ ...minimal, name }).success, false);
    assert.equal(update.safeParse({ name }).success, false);
  }
  for (const name of [
    '  Cera  ',
    '\t\n',
    '\u00a0',
    ' \t ',
    '李',
    'e\u0301',
    '<text>',
    'A'.repeat(5000),
  ]) {
    assert.equal(create.parse({ ...minimal, name }).name, name);
    assert.deepEqual(update.parse({ name }), { name });
  }
});

test('BF170 category is optional/nullable and usable IDs are preserved without UUID/tenant guessing', () => {
  for (const category_id of [
    undefined,
    null,
    'category-id',
    '  original-id  ',
    '00000000-0000-0000-0000-000000000000',
  ]) {
    assert.equal(create.parse({ ...minimal, category_id }).category_id, category_id);
    if (category_id !== undefined) assert.deepEqual(update.parse({ category_id }), { category_id });
  }
  for (const category_id of ['', '   ', '\t\n', 0, false, {}, []]) {
    assert.equal(create.safeParse({ ...minimal, category_id }).success, false);
    assert.equal(update.safeParse({ category_id }).success, false);
  }
});

for (const field of ['description', 'sku']) {
  test(`BF170 ${field} distinguishes omitted, undefined, null, empty and original free text`, () => {
    assert.equal(Object.hasOwn(create.parse(minimal), field), false);
    for (const value of [undefined, null, '', '  ', '\t\n', '<b>Texto</b>', 'X'.repeat(5000)]) {
      const parsed = create.parse({ ...minimal, [field]: value });
      assert.equal(parsed[field], value);
      assert.equal(Object.hasOwn(parsed, field), true);
      if (value !== undefined)
        assert.deepEqual(update.parse({ [field]: value }), { [field]: value });
    }
    for (const value of [0, false, {}, [], new String('A')]) {
      assert.equal(create.safeParse({ ...minimal, [field]: value }).success, false);
      assert.equal(update.safeParse({ [field]: value }).success, false);
    }
  });
}

for (const field of ['sale_price', 'default_purchase_cost']) {
  test(`BF170 ${field} accepts zero, cents and exact numeric(12,2) bounds`, () => {
    for (const value of [
      0, -0, 0.01, 0.29, 1.01, 1.15, 1.1, 19.99, 10000, 9_999_999_999.98, 9_999_999_999.99,
    ]) {
      assert.equal(create.parse({ ...minimal, [field]: value })[field], value);
      assert.deepEqual(update.parse({ [field]: value }), { [field]: value });
    }
  });
  test(`BF170 ${field} rejects negatives/nonfinite/overflow/extra precision and never coerces or rounds`, () => {
    for (const value of [
      -0.01,
      -1,
      NaN,
      Infinity,
      -Infinity,
      10_000_000_000,
      9_999_999_999.999,
      0.001,
      1.001,
      1.999,
      0.1 + 0.2,
      1e-7,
      Number.MIN_VALUE,
      0.29000000000000004,
      '1.01',
      true,
      null,
      {},
      [],
      1n,
      new Number(1),
    ]) {
      assert.equal(create.safeParse({ ...minimal, [field]: value }).success, false, String(value));
      assert.equal(update.safeParse({ [field]: value }).success, false, String(value));
    }
  });
}

test('BF170 representative hundredths validate without binary modulo artifacts for either money field', () => {
  for (let cents = 0; cents < 10000; cents++) {
    const value = cents / 100;
    const parsed = create.parse({ ...minimal, sale_price: value, default_purchase_cost: value });
    assert.equal(parsed.sale_price, value);
    assert.equal(parsed.default_purchase_cost, value);
  }
});

test('BF170 minimum_stock is a nonnegative int4 threshold, not current inventory', () => {
  for (const minimum_stock of [0, -0, 1, 3, 2_147_483_647]) {
    assert.equal(create.parse({ ...minimal, minimum_stock }).minimum_stock, minimum_stock);
    assert.deepEqual(update.parse({ minimum_stock }), { minimum_stock });
  }
  for (const minimum_stock of [
    -1,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    2_147_483_648,
    Number.MAX_SAFE_INTEGER,
    '3',
    true,
    null,
    {},
    [],
    1n,
  ]) {
    assert.equal(create.safeParse({ ...minimal, minimum_stock }).success, false);
    assert.equal(update.safeParse({ minimum_stock }).success, false);
  }
});

test('BF170 partial updates never inject the create default or reset an untouched threshold', () => {
  for (const input of [
    { name: 'Changed' },
    { description: null },
    { sku: '' },
    { category_id: null },
    { is_active: false },
  ]) {
    assert.deepEqual(update.parse(input), input);
    assert.equal(Object.hasOwn(update.parse(input), 'minimum_stock'), false);
  }
  assert.deepEqual(update.parse({ name: 'Changed', minimum_stock: undefined }), {
    name: 'Changed',
    minimum_stock: undefined,
  });
});

test('BF170 update requires at least one recognized defined field after stripping', () => {
  for (const input of [
    {},
    { name: undefined },
    { minimum_stock: undefined },
    { category_id: undefined },
    { description: undefined },
    { sku: undefined },
    { is_active: undefined },
    { unknown: 1 },
    { id: 'id', business_id: 'foreign', updated_at: 'now' },
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

test('BF170 is_active belongs only to update and accepts only actual booleans', () => {
  for (const is_active of [true, false, 'true', 'false', 1, 0, null, {}, []]) {
    assert.equal(Object.hasOwn(create.parse({ ...minimal, is_active }), 'is_active'), false);
  }
  for (const is_active of [true, false])
    assert.deepEqual(update.parse({ is_active }), { is_active });
  for (const is_active of ['true', 'false', 1, 0, null, {}, []])
    assert.equal(update.safeParse({ is_active }).success, false);
});

test('BF170 strips identity/tenant/audit/stock/currency/snapshots and unknown fields without mutating input', () => {
  const extra = {
    id: 'id',
    business_id: 'foreign',
    created_at: 'now',
    updated_at: 'now',
    created_by: 'user',
    current_stock: 99,
    stock: 99,
    quantity_on_hand: 99,
    available_stock: 99,
    quantity: 99,
    unit_cost_snapshot: 9,
    unit_price_snapshot: 9,
    currency_code: 'ARS',
    role: 'OWNER',
    barcode: 'code',
    unit: 'unit',
    unknown: true,
  };
  const input = Object.freeze({ ...minimal, ...extra });
  assert.deepEqual(create.parse(input), { ...minimal, minimum_stock: 0 });
  assert.deepEqual(update.parse(input), minimal);
  assert.equal(update.safeParse(extra).success, false);
  assert.equal(input.business_id, 'foreign');
});

test('BF170 repeated SKU/name inputs succeed because schemas introduce no uniqueness/state', () => {
  const input = { ...minimal, sku: 'BF-CAB-001' };
  assert.deepEqual(create.parse(input), create.parse(input));
  assert.deepEqual(update.parse({ name: input.name, sku: input.sku }), {
    name: input.name,
    sku: input.sku,
  });
});

test('BF170 object boundaries reject nonobjects; error messages do not echo rejected values', () => {
  for (const input of [undefined, null, 'product', 1, false, []]) {
    assert.equal(create.safeParse(input).success, false);
    assert.equal(update.safeParse(input).success, false);
  }
  const sensitive = 'synthetic-private-payload';
  const result = create.safeParse({
    name: { sensitive },
    sale_price: sensitive,
    default_purchase_cost: sensitive,
  });
  assert.equal(result.success, false);
  assert(result.error.issues.every((issue) => /Ingresa/.test(issue.message)));
  assert(!JSON.stringify(result.error.issues).includes(sensitive));
});

test('BF170 inferred input types and exact nullable ProductRow exclude all server/stock input fields', () => {
  const virtualFile = path.join(root, 'tests/__bf170_type_contract__.ts');
  const source = `
    import { z } from 'zod';
    import { createProductSchema,updateProductSchema,type CreateProductInput,type UpdateProductInput } from '@/features/products/schemas/product.schema';
    import type { ProductRow } from '@/features/products/types/product.types';
    type Equal<A,B>=(<T>()=>T extends A?1:2)extends(<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true>=T;
    type ExpectedCreate={name:string;category_id?:string|null;description?:string|null;sku?:string|null;sale_price:number;default_purchase_cost:number;minimum_stock:number};
    type ExpectedUpdate=Partial<ExpectedCreate>&{is_active?:boolean};
    type ExpectedRow={id:string;business_id:string;category_id:string|null;name:string;description:string|null;sku:string|null;sale_price:number;default_purchase_cost:number;minimum_stock:number;is_active:boolean;created_at:string;updated_at:string};
    export type Create=Assert<Equal<CreateProductInput,ExpectedCreate>>;
    export type Update=Assert<Equal<UpdateProductInput,{[K in keyof ExpectedUpdate]:ExpectedUpdate[K]}>>;
    export type Row=Assert<Equal<ProductRow,ExpectedRow>>;
    export type InferCreate=Assert<Equal<CreateProductInput,z.infer<typeof createProductSchema>>>;
    export type InferUpdate=Assert<Equal<UpdateProductInput,z.infer<typeof updateProductSchema>>>;
    const validRow:ProductRow={id:'id',business_id:'business',category_id:null,name:'Cera',description:null,sku:null,sale_price:0,default_purchase_cost:0,minimum_stock:0,is_active:false,created_at:'instant',updated_at:'instant'};
    const rawCreate:z.input<typeof createProductSchema>={name:'Cera',sale_price:0,default_purchase_cost:0};
    // @ts-expect-error Purchase cost cannot be omitted.
    const noCost:CreateProductInput={name:'Cera',sale_price:0,minimum_stock:0};
    // @ts-expect-error Money is numeric, never a coerced string.
    const money:UpdateProductInput={sale_price:'1.01'};
    // @ts-expect-error Threshold is numeric, never a coerced string.
    const threshold:UpdateProductInput={minimum_stock:'3'};
    // @ts-expect-error Archive status is not a create field.
    const active:CreateProductInput={name:'Cera',sale_price:0,default_purchase_cost:0,minimum_stock:0,is_active:false};
    // @ts-expect-error Tenant is outside the public write allowlist.
    const tenant:UpdateProductInput={business_id:'foreign'};
    // @ts-expect-error Audit is outside the public write allowlist.
    const audit:UpdateProductInput={updated_at:'now'};
    // @ts-expect-error Inventory is derived, not a product input.
    const stock:UpdateProductInput={current_stock:9};
    // @ts-expect-error ProductRow contains no derived inventory column.
    const stockRow:ProductRow={...validRow,current_stock:9};
    // @ts-expect-error ProductRow fields are persisted, category is nullable rather than optional.
    const missingCategory:ProductRow={id:'id',business_id:'business',name:'Cera',description:null,sku:null,sale_price:0,default_purchase_cost:0,minimum_stock:0,is_active:true,created_at:'instant',updated_at:'instant'};
    void validRow;void rawCreate;void noCost;void money;void threshold;void active;void tenant;void audit;void stock;void stockRow;void missingCategory;
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
