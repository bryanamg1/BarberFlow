/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../src/features/purchases');
function load(file, dependencies = {}) {
  const filename = path.resolve(root, file + '.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name in dependencies) return dependencies[name];
      if (name === 'zod') return require('zod');
      assert(name.startsWith('.'), `Unexpected dependency ${name}`);
      return load(path.relative(root, path.resolve(path.dirname(filename), name)), dependencies);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const b = uuid(216);
const input = {
  operationId: uuid(1),
  supplierName: '  Supplier  ',
  expenseCategoryId: uuid(2),
  paymentMethod: 'BANK_TRANSFER',
  purchasedAt: '2026-01-01T01:30:00Z',
  items: [{ productId: uuid(3), quantity: 3, unitCost: '0.29' }],
};
const at = '2026-10-18T01:00:00+00:00';
const data = () => ({
  purchase: {
    id: uuid(4),
    business_id: b,
    operation_id: uuid(1),
    supplier: 'Original supplier',
    status: 'COMPLETED',
    total: 0.87,
    purchased_at: '2026-01-01T01:30:00+00:00',
    notes: null,
    created_by: uuid(5),
    created_at: at,
    updated_at: at,
  },
  items: [
    {
      id: uuid(6),
      purchase_id: uuid(4),
      product_id: uuid(3),
      product_name_snapshot: 'Original product',
      quantity: 3,
      unit_cost_snapshot: 0.29,
      line_total: 0.87,
      created_at: at,
    },
  ],
  expense: {
    id: uuid(7),
    business_id: b,
    category_id: uuid(2),
    source_type: 'PURCHASE',
    purchase_id: uuid(4),
    description: 'Compra de productos',
    amount: 0.87,
    payment_method: 'BANK_TRANSFER',
    expense_date: '2025-12-31',
    receipt_path: null,
    notes: null,
    created_by: uuid(5),
    created_at: at,
    updated_at: at,
  },
});
const response = (value = data(), error = null, status = 200) => ({
  data: value,
  error,
  status,
  statusText: 'fixture',
  count: null,
});
module.exports = { load, b, input, data, response, uuid };
