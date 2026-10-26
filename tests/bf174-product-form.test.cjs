/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
function load(file) {
  const filename = path.resolve(__dirname, '../src/features/products', file + '.ts');
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) =>
      name === 'zod'
        ? require(name)
        : load(
            path.relative(
              path.resolve(__dirname, '../src/features/products'),
              path.resolve(path.dirname(filename), name),
            ),
          ),
    mod,
    mod.exports,
  );
  return mod.exports;
}
const {
  productFormSchema: schema,
  productFormValues,
  productDirtyInput,
} = load('components/productForm.schema');
const valid = () => ({
  name: '  Cera  ',
  sale_price: '0.29',
  default_purchase_cost: '0.00',
  minimum_stock: '0',
});
test('BF174 exact create DTO preserves name, cents and optional absence; no stock/image/audit', () => {
  assert.deepEqual(
    schema.parse({
      ...valid(),
      id: 'foreign',
      business_id: 'foreign',
      stock: 999,
      image: 'url',
      is_active: false,
    }),
    { name: '  Cera  ', sale_price: 0.29, default_purchase_cost: 0, minimum_stock: 0 },
  );
});
for (const field of ['sale_price', 'default_purchase_cost']) {
  test(`BF174 ${field} accepts zero and exact maximum`, () => {
    for (const value of ['0', '0.00', '0.29', '9999999999.99'])
      assert(schema.safeParse({ ...valid(), [field]: value }).success);
  });
  test(`BF174 ${field} rejects blank/sign/comma/prefix/exponent/extra precision/overflow/nonfinite`, () => {
    for (const value of [
      '',
      ' ',
      '-1',
      '1,20',
      '1x',
      '1e2',
      '1.001',
      '10000000000',
      'Infinity',
      'NaN',
    ])
      assert.equal(schema.safeParse({ ...valid(), [field]: value }).success, false, value);
  });
}
test('BF174 mandatory name/cost; no trim or arbitrary name constraint', () => {
  assert.equal(schema.safeParse({ ...valid(), name: '   ' }).success, false);
  assert.equal(schema.safeParse({ ...valid(), default_purchase_cost: '' }).success, false);
  assert.equal(schema.parse({ ...valid(), name: '\t' }).name, '\t');
});
test('BF174 nullable text/category preserve null, empty and original text without normalization', () => {
  for (const v of [undefined, null, '', '  original  ']) {
    const parsed = schema.parse({ ...valid(), description: v, sku: v });
    assert.equal(parsed.description, v);
    assert.equal(parsed.sku, v);
  }
  assert.equal(schema.parse({ ...valid(), category_id: null }).category_id, null);
  assert.equal(schema.parse({ ...valid(), category_id: ' cat ' }).category_id, ' cat ');
  assert.equal(schema.safeParse({ ...valid(), category_id: '' }).success, false);
});
test('BF174 minimum stock is existing int4 threshold, not stock balance', () => {
  assert(schema.safeParse({ ...valid(), minimum_stock: '2147483647' }).success);
  for (const value of ['', '-1', '1.1', '2147483648'])
    assert.equal(schema.safeParse({ ...valid(), minimum_stock: value }).success, false);
});
test('BF174 edit mapping sends dirty fields only, keeps untouched nulls/threshold absent', () => {
  const input = schema.parse({ ...valid(), description: null, sku: null, category_id: null });
  assert.deepEqual(productDirtyInput(input, { name: true }), { name: '  Cera  ' });
  assert.deepEqual(
    productDirtyInput(
      { ...input, description: '', sku: '', category_id: null },
      { description: true, sku: true, category_id: true },
    ),
    { description: '', sku: '', category_id: null },
  );
  assert.throws(() => productDirtyInput(input, {}));
});
test('BF174 initial defaults use existing stock minimum, never unknown cost as zero', () => {
  assert.deepEqual(productFormValues(), {
    name: '',
    sale_price: '',
    default_purchase_cost: '',
    minimum_stock: '0',
  });
  const row = { ...schema.parse(valid()), description: null, sku: '', category_id: null };
  assert.deepEqual(productFormValues(row), {
    name: '  Cera  ',
    sale_price: '0.29',
    default_purchase_cost: '0',
    minimum_stock: '0',
    description: null,
    sku: '',
    category_id: null,
  });
});
