/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../src/features/inventory');
function load(file, dependencies = {}) {
  const filename = path.resolve(root, file + '.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(
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
const b = '00000000-0000-4000-8000-000000000224';
const p = '00000000-0000-4000-8000-000000000225';
const op = 'ABCDEF00-0000-0000-0000-000000000226';
const input = { operationId: op, productId: p, quantityDelta: -2, reason: 'LOSS' };
const row = Object.freeze({
  id: op,
  business_id: b,
  product_id: p,
  type: 'LOSS',
  quantity_delta: -2,
  unit_cost: null,
  reference_type: 'STOCK_ADJUSTMENT',
  reference_id: op,
  notes: ' Original\n ',
  occurred_at: '2026-01-01T00:00:00Z',
  created_by: op,
  created_at: '2026-01-01T00:00:00Z',
});
const response = (data = row, error = null, status = 200) => ({
  data,
  error,
  status,
  statusText: '',
  count: null,
});
const schema = load('schemas/stockAdjustment.schema').adjustStockSchema;

test('LOSS/ADJUSTMENT preserve UUID case, signed int32 boundaries and optional notes', () => {
  for (const [reason, quantityDelta] of [
    ['LOSS', -1],
    ['LOSS', -2147483648],
    ['ADJUSTMENT', -2147483648],
    ['ADJUSTMENT', 2147483647],
  ]) {
    for (const notes of [undefined, null, '', ' Original\n ']) {
      const value = { ...input, reason, quantityDelta, ...(notes === undefined ? {} : { notes }) };
      assert.deepEqual(schema.parse(value), value);
    }
  }
  assert.equal(schema.parse({ ...input, notes: undefined }).notes, undefined);
});
for (const patch of [
  { reason: 'SALE' },
  { reason: 'loss' },
  { reason: ' LOSS ' },
  { reason: 'LOSS', quantityDelta: 1 },
  { quantityDelta: 0 },
  { quantityDelta: -0 },
  { quantityDelta: 1.5 },
  { quantityDelta: '1' },
  { quantityDelta: NaN },
  { quantityDelta: Infinity },
  { quantityDelta: -Infinity },
  { quantityDelta: 2147483648 },
  { quantityDelta: -2147483649 },
  { operationId: 'not-a-uuid' },
  { operationId: op + '\n' },
  { productId: ' ' + p },
  { productId: null },
  { operationId: undefined },
  { notes: 5 },
])
  test(`schema rejects ${JSON.stringify(patch)}`, () =>
    assert.equal(schema.safeParse({ ...input, ...patch }).success, false));
test('schema strips unknown, tenant, stock and server fields', () => {
  assert.deepEqual(
    schema.parse({
      ...input,
      businessId: b,
      created_by: op,
      unit_cost: 9,
      type: 'PURCHASE',
      reference_id: op,
      created_at: 'x',
      current_stock: 9,
      extra: true,
    }),
    input,
  );
});
function repo(client) {
  return load('repositories/inventoryRepository', { '@/lib/supabase/client': { supabase: client } })
    .inventoryRepository;
}
test('repository uses exactly one adjust_stock RPC, exact six args and original SDK envelope', async () => {
  for (const notes of [undefined, null, '', ' Original\n ']) {
    const calls = [],
      result = response();
    const api = repo({
      rpc: (name, args) => {
        calls.push([name, args]);
        return Promise.resolve(result);
      },
    });
    assert.equal(await api.adjustStock(b, { ...input, notes }), result);
    assert.deepEqual(calls, [
      [
        'adjust_stock',
        {
          p_business_id: b,
          p_operation_id: op,
          p_product_id: p,
          p_quantity_delta: -2,
          p_reason: 'LOSS',
          p_notes: notes ?? null,
        },
      ],
    ]);
    assert.equal(Object.keys(result.data).length, 12);
  }
});
test('repository preserves structured errors and unexpected rejection', async () => {
  const result = response(null, { code: 'PT409', details: 'INSUFFICIENT_STOCK' }, 409);
  assert.equal(await repo({ rpc: () => Promise.resolve(result) }).adjustStock(b, input), result);
  const error = new Error('private');
  await assert.rejects(
    async () => await repo({ rpc: () => Promise.reject(error) }).adjustStock(b, input),
    (value) => value === error,
  );
});
test('real SDK HTTP serialization sends six RPC args without DML or .single()', async () => {
  const calls = [];
  const sdk = createClient('https://fixture.example.test', 'fixture', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        calls.push([
          String(url),
          init.method,
          JSON.parse(init.body),
          new Headers(init.headers).get('accept'),
        ]);
        return new Response(JSON.stringify(row), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const result = await repo(sdk).adjustStock(b, input);
  assert.deepEqual(result.data, row);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0][0]).pathname, '/rest/v1/rpc/adjust_stock');
  assert.equal(calls[0][1], 'POST');
  assert.equal(calls[0][2].p_notes, null);
  assert.equal(Object.keys(calls[0][2]).length, 6);
  assert(!calls[0][3]?.includes('object+json'));
});
function service(result = response(), rejection) {
  const calls = [];
  const operation =
    (name) =>
    (...args) => {
      calls.push([name, ...args]);
      return rejection ? Promise.reject(rejection) : Promise.resolve(result);
    };
  return {
    calls,
    api: load('services/inventoryService', {
      '../repositories/inventoryRepository': {
        inventoryRepository: {
          adjustStock: operation('adjustStock'),
          getProductStock: operation('getProductStock'),
        },
      },
    }).inventoryService,
  };
}
test('service validates before SDK, strips server fields and keeps business separate', async () => {
  const h = service();
  for (const value of [{ ...input, quantityDelta: 0 }, { ...input, operationId: 'x' }, null])
    assert.equal((await h.api.adjustStock(b, value)).error.code, 'INVALID_INPUT');
  assert.equal((await h.api.adjustStock('bad', input)).error.code, 'INVALID_INPUT');
  assert.equal(h.calls.length, 0);
  const result = await h.api.adjustStock(b, { ...input, businessId: 'other', unit_cost: 9 });
  assert.equal(result.data, row);
  assert.deepEqual(h.calls, [['adjustStock', b, input]]);
});
test('service replay preserves original server row even with another requested product/payload', async () => {
  const h = service();
  const changed = {
    ...input,
    productId: op,
    quantityDelta: 7,
    reason: 'ADJUSTMENT',
    notes: 'changed',
  };
  assert.equal((await h.api.adjustStock(b, changed)).data, row);
  assert.deepEqual(h.calls, [['adjustStock', b, changed]]);
});
for (const [status, code, details, expected] of [
  [0, '42501', '', 'NETWORK_ERROR'],
  [401, '22023', '', 'INVENTORY_ACCESS_DENIED'],
  [403, 'x', '', 'INVENTORY_ACCESS_DENIED'],
  [400, '42501', '', 'INVENTORY_ACCESS_DENIED'],
  [400, '22023', '', 'INVALID_INPUT'],
  [400, '22P02', '', 'INVALID_INPUT'],
  [400, '22003', '', 'INVALID_INPUT'],
  [400, 'P0002', '', 'NOT_FOUND'],
  [409, 'PT409', 'INSUFFICIENT_STOCK', 'INSUFFICIENT_STOCK'],
  [409, 'PT409', 'other', 'UNKNOWN_ERROR'],
  [409, '23505', '', 'UNKNOWN_ERROR'],
  [409, '40001', '', 'UNKNOWN_ERROR'],
  [409, 'x', 'INSUFFICIENT_STOCK', 'UNKNOWN_ERROR'],
])
  test(`safe mapping ${status}/${code}/${details}`, async () => {
    const h = service(
      response(null, { code, details, message: 'private token', hint: 'private' }, status),
    );
    for (const result of [await h.api.adjustStock(b, input), await h.api.getProductStock(b, [p])]) {
      assert.equal(result.error.code, expected);
      assert.equal(result.data, null);
      assert.deepEqual(Object.keys(result.error), ['code', 'message']);
      assert(!JSON.stringify(result).includes('private'));
    }
  });
test('null/undefined success or unexpected rejection is UNKNOWN_ERROR, never fake success', async () => {
  for (const value of [null, undefined]) {
    const h = service({ data: value, error: null, status: 200 });
    assert.equal((await h.api.adjustStock(b, input)).error.code, 'UNKNOWN_ERROR');
    assert.equal((await h.api.getProductStock(b, [p])).error.code, 'UNKNOWN_ERROR');
  }
  assert.equal(
    (await service(null, new Error('private')).api.adjustStock(b, input)).error.code,
    'UNKNOWN_ERROR',
  );
});
test('stock read preserves bigint string, empty results and request order/duplicates', async () => {
  for (const rows of [[], [{ product_id: p, current_stock: '9007199254740993' }]]) {
    const h = service(response(rows));
    assert.equal((await h.api.getProductStock(b, [p, op, p])).data, rows);
    assert.deepEqual(h.calls, [['getProductStock', b, [p, op, p]]]);
  }
  const h = service(response([]));
  assert.deepEqual(await h.api.getProductStock(b, []), { data: [], error: null });
  assert.deepEqual(h.calls, [['getProductStock', b, []]]);
});
test('stock read rejects invalid UUID inputs before SDK', async () => {
  const h = service();
  for (const ids of [['bad'], [null], null, [p, undefined], new Array(1)])
    assert.equal((await h.api.getProductStock(b, ids)).error.code, 'INVALID_INPUT');
  assert.equal((await h.api.getProductStock('bad', [p])).error.code, 'INVALID_INPUT');
  assert.equal(h.calls.length, 0);
});
