/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../src/features/services');
function load(relative) {
  const file = path.resolve(root, relative + '.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    (name) => {
      if (name === 'zod') return require('zod');
      assert(name.startsWith('.'));
      return load(path.relative(root, path.resolve(path.dirname(file), name)));
    },
    module,
    module.exports,
  );
  return module.exports;
}
const schema = load('components/serviceCreateForm.schema').serviceCreateFormSchema;
const valid = { name: '  Corte clásico  ', price: '1.01', duration_minutes: '30' };

for (const [text, number] of [
  ['0', 0],
  ['0.00', 0],
  ['0.29', 0.29],
  ['1.01', 1.01],
  ['12.50', 12.5],
  ['9999999999.99', 9999999999.99],
])
  test(`BF134 price text ${text} maps explicitly to exact domain number`, () => {
    assert.deepEqual(schema.parse({ ...valid, price: text }), {
      name: valid.name,
      price: number,
      duration_minutes: 30,
    });
  });
test('BF134 rejects invalid price syntax without prefix parsing, locale parsing, or rounding', () => {
  for (const price of [
    '',
    ' ',
    '-1',
    '+1',
    '1.001',
    '1.000',
    '1.01x',
    '1,01',
    '1,000.00',
    'ARS 1',
    '1e2',
    'NaN',
    'Infinity',
    '.29',
    '1.',
    1,
    null,
  ]) {
    const result = schema.safeParse({ ...valid, price });
    assert.equal(result.success, false, String(price));
    assert(result.error.issues.some((issue) => issue.path[0] === 'price'));
  }
});
test('BF134 domain rejects out-of-range/overflow price after text mapping', () => {
  for (const price of ['10000000000', '9'.repeat(400)])
    assert.equal(schema.safeParse({ ...valid, price }).success, false);
});
for (const [text, number] of [
  ['1', 1],
  ['17', 17],
  ['30', 30],
  ['2147483647', 2147483647],
])
  test(`BF134 duration ${text} maps to integer without a step restriction`, () => {
    assert.equal(schema.parse({ ...valid, duration_minutes: text }).duration_minutes, number);
  });
test('BF134 duration rejects blank, fractional, prefix, zero, negative and out of int4 range', () => {
  for (const duration_minutes of [
    '',
    ' ',
    '0',
    '-1',
    '1.1',
    '1.0',
    '30min',
    '1e2',
    '2147483648',
    '9'.repeat(400),
    null,
  ])
    assert.equal(
      schema.safeParse({ ...valid, duration_minutes }).success,
      false,
      String(duration_minutes),
    );
});
test('BF134 name validation reuses unchanged domain behavior and preserves original text', () => {
  for (const name of ['', ' ', '    '])
    assert.equal(schema.safeParse({ ...valid, name }).success, false);
  assert.equal(schema.parse(valid).name, valid.name);
});
test('BF134 untouched description remains absent, defined empty/text preserved without trim', () => {
  assert.equal(Object.hasOwn(schema.parse(valid), 'description'), false);
  for (const description of ['', '  texto\n original  '])
    assert.equal(schema.parse({ ...valid, description }).description, description);
});
test('BF134 adapter strips management/audit fields and keeps domain schema pure', () => {
  assert.deepEqual(
    schema.parse({
      ...valid,
      id: 'x',
      business_id: 'other',
      is_active: false,
      created_at: 'x',
      updated_at: 'x',
    }),
    { name: valid.name, price: 1.01, duration_minutes: 30 },
  );
  const domain = load('schemas/service.schema').createServiceSchema;
  assert.equal(
    domain.safeParse(valid).success,
    false,
    'Domain schema still rejects numeric strings',
  );
});
test('BF134 route is thin; UI only create hook, no SDK/edit/archive/cache writes', () => {
  const form = fs.readFileSync(path.join(root, 'components/ServiceForm.tsx'), 'utf8');
  const screen = fs.readFileSync(path.join(root, 'screens/ServiceCreateScreen.tsx'), 'utf8');
  assert.match(form, /useCreateService\(\)/);
  assert.match(form, /zodResolver\(serviceCreateFormSchema\)/);
  assert.match(screen, /key=\{business.data.business.id\}/);
  assert.match(screen, /role === 'OWNER'/);
  assert.doesNotMatch(
    form + screen,
    /servicesService|supabase|useUpdateService|useServiceDetail|setQueryData|is_active|parseFloat|z\.coerce|toFixed/,
  );
  assert.match(screen, /params: \{ id: created.id \}/);
  const route = fs.readFileSync(path.resolve(root, '../../app/(app)/services/new.tsx'), 'utf8');
  assert.match(route, /export \{ ServiceCreateScreen as default \}/);
  assert.equal(fs.existsSync(path.resolve(root, '../../app/(app)/services/[id]/index.tsx')), false);
});
