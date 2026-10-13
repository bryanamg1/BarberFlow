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
const edit = load('components/serviceCreateForm.schema').serviceEditFormSchema;
const valid = { name: '  Corte  ', description: '', price: '0.29', duration_minutes: '17' };
test('BF135 edit adapter maps safe visual values to unchanged update domain rules', () => {
  assert.deepEqual(edit.parse(valid), {
    name: valid.name,
    description: '',
    price: 0.29,
    duration_minutes: 17,
  });
  assert.equal(edit.parse({ ...valid, price: '0' }).price, 0);
  assert.equal(
    edit.parse({ ...valid, price: '9999999999.99', duration_minutes: '2147483647' })
      .duration_minutes,
    2147483647,
  );
});
test('BF135 edit adapter rejects lossy parsing, blank required values and domain overflows', () => {
  for (const patch of [
    { name: '   ' },
    { price: '' },
    { price: '1.001' },
    { price: '1,01' },
    { price: '1x' },
    { price: '10000000000' },
    { duration_minutes: '1.5' },
    { duration_minutes: '0' },
    { duration_minutes: '2147483648' },
  ])
    assert.equal(edit.safeParse({ ...valid, ...patch }).success, false);
});
test('BF135 adapter preserves strings and excludes hidden/audit/status fields from normal edit', () => {
  assert.deepEqual(
    edit.parse({
      ...valid,
      description: '  Texto\noriginal  ',
      business_id: 'other',
      is_active: false,
      id: 'x',
      updated_at: 'x',
    }),
    { name: valid.name, description: '  Texto\noriginal  ', price: 0.29, duration_minutes: 17 },
  );
});
test('BF135 uses existing hooks and overlay; no deletion, direct data access, extra detail or cache writes', () => {
  const screen = fs.readFileSync(path.join(root, 'screens/ServiceEditScreen.tsx'), 'utf8');
  const form = fs.readFileSync(path.join(root, 'components/ServiceEditForm.tsx'), 'utf8');
  const route = fs.readFileSync(
    path.resolve(root, '../../app/(app)/services/[id]/edit.tsx'),
    'utf8',
  );
  assert.match(screen, /useServiceDetail\(serviceId\)/);
  assert.match(form, /useUpdateService\(\)/);
  assert.match(form, /<Modal/);
  assert.match(route, /typeof id === 'string' && id.trim\(\).length > 0 \? id : null/);
  assert.doesNotMatch(
    screen + form,
    /servicesService|supabase|\.delete\(|window.confirm|setQueryData|useArchiveService|useRestoreService/,
  );
  assert.doesNotMatch(form, /router\./);
  assert.equal(fs.existsSync(path.resolve(root, '../../app/(app)/services/[id]/index.tsx')), false);
});
