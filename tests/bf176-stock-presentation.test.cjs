/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
function load(file) {
  const filename = path.resolve(__dirname, '../src', file + '.ts');
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) =>
      load(
        path.relative(
          path.resolve(__dirname, '../src'),
          path.resolve(path.dirname(filename), name),
        ),
      ),
    module,
    module.exports,
  );
  return module.exports;
}
const { productStockPresentation: present } = load(
  'features/products/components/productStockPresentation',
);
for (const [stock, minimum, label, tone] of [
  [{ status: 'success', value: '0' }, 3, 'Stock: 0 · Sin stock', 'danger'],
  [{ status: 'success', value: '3' }, 3, 'Stock: 3 · Stock bajo', 'warning'],
  [{ status: 'success', value: '4' }, 3, 'Stock: 4 · Normal', 'success'],
  [
    { status: 'success', value: '9007199254740993' },
    3,
    'Stock: 9007199254740993 · Normal',
    'success',
  ],
  [{ status: 'pending' }, 3, 'Cargando stock…', 'neutral'],
  [{ status: 'unavailable' }, 3, 'Stock no disponible', 'neutral'],
  [
    { status: 'error', error: { code: 'UNKNOWN_ERROR', message: 'private' } },
    3,
    'Error al cargar stock',
    'danger',
  ],
  [{ status: 'success', value: '-1' }, 3, 'Stock no disponible', 'neutral'],
])
  test(label + ' ' + JSON.stringify(stock), () =>
    assert.deepEqual(present(stock, minimum), { label, tone }),
  );
