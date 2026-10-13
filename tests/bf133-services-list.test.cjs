/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../src');
const file = path.join(root, 'utils/formatMoney.ts');
const moduleExports = { exports: {} };
vm.runInThisContext(
  `(function(module,exports){${ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText}\n})`,
)(moduleExports, moduleExports.exports);
const { formatMoney, formatCatalogPrice } = moduleExports.exports;

for (const [amount, cents] of [
  [0, '0,00'],
  [0.29, '0,29'],
  [1.01, '1,01'],
  [12.5, '12,50'],
  [9999999999.99, '9.999.999.999,99'],
]) {
  test(`BF133 catalog ${amount} preserves cents without rounding`, () => {
    assert.equal(formatCatalogPrice(amount, 'ARS'), `ARS ${cents}`);
  });
}
test('BF133 shared formatter preserves huge decimal-string money', () => {
  assert.equal(
    formatMoney('900719925474099312345.29', 'USD'),
    'USD 900.719.925.474.099.312.345,29',
  );
});
test('BF133 invalid catalog values do not round or coerce', () => {
  for (const value of [-1, NaN, Infinity, 0.001, 1.999, 10000000000])
    assert.equal(formatCatalogPrice(value, 'ARS'), 'Importe no disponible');
  assert.equal(formatCatalogPrice(1, 'INVALID'), 'Importe no disponible');
});
test('BF133 UI depends only on list hook and presentation context; no downstream operations', () => {
  const source = fs.readFileSync(
    path.join(root, 'features/services/screens/ServicesScreen.tsx'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /servicesService|supabase|useUpdateService|useCreateService|useServiceDetail|SearchInput|\.sort\(|\.filter\(|setItems|\.from\(|delete\(/,
  );
  assert.match(source, /import type \{ ServiceRow \}/);
  assert.match(source, /useServiceList\(params\)/);
  const route = fs.readFileSync(path.join(root, 'app/(app)/services/index.tsx'), 'utf8');
  assert.match(route, /export \{ ServicesScreen as default \}/);
  assert.equal(fs.existsSync(path.join(root, 'app/(app)/services/[id]/index.tsx')), false);
});
