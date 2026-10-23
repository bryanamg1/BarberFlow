/* global __dirname */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const root = path.resolve(__dirname, '../../src/features/sales');
function load(file, dependencies = {}, cache = new Map()) {
  const filename = path.resolve(root, file + '.ts');
  if (cache.has(filename)) return cache.get(filename);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name in dependencies) return dependencies[name];
      if (['zod', 'zustand/vanilla'].includes(name)) return require(name);
      assert(name.startsWith('.'), 'Unexpected dependency ' + name);
      return load(
        path.relative(root, path.resolve(path.dirname(filename), name)),
        dependencies,
        cache,
      );
    },
    mod,
    mod.exports,
  );
  cache.set(filename, mod.exports);
  return mod.exports;
}
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  b = id(196),
  at = '2026-10-23T12:00:00+00:00';
const input = () => ({
  operationId: id(1),
  appointmentId: null,
  clientId: null,
  discountAmount: '0.10',
  paymentMethod: 'BANK_TRANSFER',
  items: [
    { itemType: 'SERVICE', itemId: id(2), quantity: 2, unitPriceOverride: '0.29' },
    { itemType: 'PRODUCT', itemId: id(3), quantity: 1 },
  ],
});
const data = () => ({
  sale: {
    id: id(4),
    business_id: b,
    client_id: null,
    appointment_id: null,
    operation_id: id(1),
    status: 'COMPLETED',
    subtotal: 0.89,
    discount: 0.1,
    total: 0.79,
    sold_at: at,
    created_by: id(5),
    created_at: at,
    updated_at: at,
  },
  items: [
    {
      id: id(6),
      sale_id: id(4),
      item_type: 'SERVICE',
      service_id: id(2),
      product_id: null,
      item_name_snapshot: 'Corte histórico',
      unit_price_snapshot: 0.29,
      quantity: 2,
      line_total: 0.58,
      unit_cost_snapshot: null,
      created_at: at,
    },
    {
      id: id(7),
      sale_id: id(4),
      item_type: 'PRODUCT',
      service_id: null,
      product_id: id(3),
      item_name_snapshot: 'Producto histórico',
      unit_price_snapshot: 0.31,
      quantity: 1,
      line_total: 0.31,
      unit_cost_snapshot: 0.1,
      created_at: at,
    },
  ],
  payments: [
    {
      id: id(8),
      business_id: b,
      sale_id: id(4),
      payment_method: 'BANK_TRANSFER',
      amount: 0.79,
      notes: null,
      paid_at: at,
      created_by: id(5),
      created_at: at,
    },
  ],
});
const response = (value = data(), error = null, status = 200) => ({
  data: value,
  error,
  status,
  statusText: 'fixture',
  count: null,
});
module.exports = { load, id, b, at, input, data, response };
