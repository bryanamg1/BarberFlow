/* global __dirname */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createClient } = require('@supabase/supabase-js');
const { QueryClient } = require('@tanstack/react-query');
const fs = require('node:fs'),
  path = require('node:path');
const { load, id, b, at, data, response } = require('./helpers/bf196.cjs');
const columns =
  'id,business_id,client_id,appointment_id,operation_id,status,subtotal,discount,total,sold_at,created_by,created_at,updated_at';
function corrected() {
  const d = data();
  d.sale.status = 'VOIDED';
  return {
    ...d,
    correction: {
      id: id(70),
      business_id: b,
      sale_id: d.sale.id,
      operation_id: id(71),
      reason: '  Motivo original  ',
      created_by: id(5),
      created_at: at,
    },
    stockMovements: [
      {
        id: id(72),
        business_id: b,
        product_id: id(3),
        type: 'RETURN',
        quantity_delta: 1,
        unit_cost: 0.1,
        reference_type: 'SALE_VOID',
        reference_id: id(70),
        notes: null,
        occurred_at: at,
        created_by: id(5),
        created_at: at,
      },
    ],
  };
}
function sdkRepo(payload) {
  const requests = [];
  const sdk = createClient('https://fixture.example.test', 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: new URL(url), init });
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  return {
    repository: load('repositories/salesRepository', { '@/lib/supabase/client': { supabase: sdk } })
      .salesRepository,
    requests,
  };
}
for (const status of [undefined, 'DRAFT', 'COMPLETED', 'VOIDED'])
  test(`BF198A exact RLS history request status=${status}`, async () => {
    const row = data().sale,
      f = sdkRepo([row, { ...row, id: id(40) }, { ...row, id: id(41) }]);
    const result = await f.repository.listHistory({ businessId: b, page: 3, pageSize: 2, status });
    assert.deepEqual(result.data, {
      items: [row, { ...row, id: id(40) }],
      page: 3,
      pageSize: 2,
      hasNextPage: true,
    });
    const { url, init } = f.requests[0];
    assert.equal(f.requests.length, 1);
    assert.equal(init.method, 'GET');
    assert.equal(url.pathname, '/rest/v1/sales');
    assert.equal(url.searchParams.get('select').replace(/\s/g, ''), columns);
    assert.equal(url.searchParams.get('business_id'), `eq.${b}`);
    assert.equal(url.searchParams.get('status'), status ? `eq.${status}` : null);
    assert.equal(url.searchParams.get('order'), 'sold_at.desc.nullslast,id.desc');
    assert.equal(url.searchParams.get('offset'), '4');
    assert.equal(url.searchParams.get('limit'), '3');
    assert.equal(url.searchParams.get('count'), null);
  });
for (const count of [0, 1, 2])
  test(`BF198A history ${count} rows without sentinel`, async () => {
    const rows = Array.from({ length: count }, (_, i) => ({ ...data().sale, id: id(40 + i) }));
    const f = sdkRepo(rows),
      result = await f.repository.listHistory({ businessId: b, page: 1, pageSize: 2 });
    assert.deepEqual(result.data, { items: rows, page: 1, pageSize: 2, hasNextPage: false });
  });
for (const operation of ['getCorrectionDetail', 'voidSale'])
  test(`BF198A ${operation} SDK RPC exact wire contract`, async () => {
    const full = corrected(),
      payload =
        operation === 'voidSale'
          ? full
          : { correction: full.correction, stockMovements: full.stockMovements };
    const f = sdkRepo(payload),
      input = { saleId: id(4), operationId: id(71), reason: '  Motivo original  ' };
    const result = await f.repository[operation](b, operation === 'voidSale' ? input : id(4));
    assert.deepEqual(result.data, payload);
    assert.equal(f.requests.length, 1);
    assert.equal(
      f.requests[0].url.pathname,
      '/rest/v1/rpc/' + (operation === 'voidSale' ? 'void_sale' : 'get_sale_correction_detail'),
    );
    assert.deepEqual(
      JSON.parse(f.requests[0].init.body),
      operation === 'voidSale'
        ? { p_business_id: b, p_operation_id: id(71), p_sale_id: id(4), p_reason: input.reason }
        : { p_business_id: b, p_sale_id: id(4) },
    );
  });
function service(method, result, reject = false) {
  let calls = [];
  const salesService = load('services/salesService', {
    '../repositories/salesRepository': {
      salesRepository: {
        [method]: async (...args) => {
          calls.push(args);
          if (reject) throw new Error('private SQL');
          return result;
        },
      },
    },
  }).salesService;
  return { service: salesService, calls };
}
const input = () => ({ saleId: id(4), operationId: id(71), reason: '  Motivo original  ' });
test('BF198A history defaults and max100 preserve exact page/order, not a current business selector', async () => {
  const page = { items: [data().sale], page: 1, pageSize: 25, hasNextPage: false };
  const f = service('listHistory', response(page));
  assert.deepEqual(await f.service.listHistory({ businessId: b }), { data: page, error: null });
  assert.deepEqual(f.calls[0], [{ businessId: b, page: 1, pageSize: 25, status: undefined }]);
  const normalize = load('services/salesService', {
    '../repositories/salesRepository': { salesRepository: {} },
  }).normalizeSaleHistory;
  assert.deepEqual(normalize({ pageSize: 100 }), { page: 1, pageSize: 100, status: undefined });
});
for (const params of [
  { businessId: '' },
  { businessId: b, page: 0 },
  { businessId: b, page: 1.1 },
  { businessId: b, pageSize: 101 },
  { businessId: b, pageSize: 0 },
  { businessId: b, status: 'PAID' },
  { businessId: b, page: Number.MAX_SAFE_INTEGER },
])
  test('BF198A invalid history parameters never reach SDK', async () => {
    const f = service('listHistory', response(null));
    assert.equal((await f.service.listHistory(params)).error.code, 'INVALID_INPUT');
    assert.equal(f.calls.length, 0);
  });
for (const status of ['DRAFT', 'COMPLETED', 'VOIDED'])
  test(`BF198A history accepts ${status} snapshots unchanged`, async () => {
    const row = { ...data().sale, status },
      page = { items: [row], page: 1, pageSize: 25, hasNextPage: false };
    const f = service('listHistory', response(page));
    assert.deepEqual((await f.service.listHistory({ businessId: b })).data, page);
  });
test('BF198A correction and void preserve historical text, independent operation ID and no current catalog', async () => {
  const full = corrected(),
    audit = { correction: full.correction, stockMovements: full.stockMovements };
  assert.deepEqual(
    await service('getCorrectionDetail', response(audit)).service.getCorrectionDetail(b, id(4)),
    { data: audit, error: null },
  );
  const f = service('voidSale', response(full));
  assert.deepEqual(await f.service.voidSale(b, input()), { data: full, error: null });
  assert.deepEqual(f.calls[0], [b, input()]);
  assert.notEqual(full.sale.operation_id, full.correction.operation_id);
});
for (const reason of ['', ' ', '\t\n', '\u00a0'])
  test(`BF198A UI reason validation rejects ${JSON.stringify(reason)} without write`, async () => {
    const f = service('voidSale', response(corrected()));
    assert.equal((await f.service.voidSale(b, { ...input(), reason })).error.code, 'INVALID_INPUT');
    assert.equal(f.calls.length, 0);
  });
for (const [status, code, details, expected] of [
  [0, '', '', 'NETWORK_ERROR'],
  [403, '42501', '', 'ACCESS_DENIED'],
  [400, '22023', '', 'INVALID_INPUT'],
  [404, 'PT404', 'NOT_FOUND', 'NOT_FOUND'],
  [409, 'PT409', 'INVALID_STATUS', 'INVALID_STATUS'],
  [409, 'PT409', 'CONFLICT', 'CONFLICT'],
  [409, 'PT409', 'INCOMPLETE_HISTORY', 'INCOMPLETE_HISTORY'],
  [409, '40001', '', 'CONFLICT'],
  [500, 'XX000', 'INVALID_STATUS', 'UNKNOWN_ERROR'],
])
  test(`BF198A safe correction error ${code}/${details}`, async () => {
    const f = service('voidSale', response(null, { code, details, message: 'secret SQL' }, status));
    const result = await f.service.voidSale(b, input());
    assert.equal(result.error.code, expected);
    assert(!JSON.stringify(result).includes('secret'));
  });
for (const method of ['getCorrectionDetail', 'voidSale', 'listHistory'])
  test(`BF198A ${method} rejection is safe`, async () => {
    const f = service(method, null, true),
      result =
        method === 'listHistory'
          ? await f.service[method]({ businessId: b })
          : await f.service[method](b, method === 'voidSale' ? input() : id(4));
    assert.equal(result.error.code, 'UNKNOWN_ERROR');
    assert(!JSON.stringify(result).includes('private'));
  });
for (const change of [
  (d) => {
    d.correction = null;
  },
  (d) => {
    d.correction.business_id = id(99);
  },
  (d) => {
    d.correction.sale_id = id(99);
  },
  (d) => {
    d.stockMovements[0].reference_id = id(99);
  },
  (d) => {
    d.stockMovements[0].type = 'SALE';
  },
  (d) => {
    d.stockMovements[0].business_id = id(99);
  },
])
  test('BF198A malformed correction cannot expose foreign/partial audit', async () => {
    const full = corrected();
    change(full);
    const f = service(
      'getCorrectionDetail',
      response({ correction: full.correction, stockMovements: full.stockMovements }),
    );
    assert.equal((await f.service.getCorrectionDetail(b, id(4))).error.code, 'INCOMPLETE_HISTORY');
  });
const { saleRestitution } = load('services/saleCorrection');
test('BF198A restitution preserves duplicate historical line multiplicity', () => {
  const d = corrected();
  d.items.push({ ...d.items[1], id: id(80) });
  d.stockMovements.push({ ...d.stockMovements[0], id: id(81) });
  assert.equal(saleRestitution(d, d.items).length, 2);
  assert(
    saleRestitution(d, d.items).every(
      (row) => row.name === 'Producto histórico' && row.quantity === 1,
    ),
  );
});
for (const mode of ['missing', 'extra', 'different quantity', 'ambiguous name'])
  test(`BF198A restitution ${mode} fails safely`, () => {
    const d = corrected();
    if (mode === 'missing') d.stockMovements = [];
    if (mode === 'extra') d.stockMovements.push({ ...d.stockMovements[0], id: id(81) });
    if (mode === 'different quantity') d.stockMovements[0].quantity_delta = 5;
    if (mode === 'ambiguous name') {
      d.items.push({ ...d.items[1], id: id(80), item_name_snapshot: 'Otro nombre' });
      d.stockMovements.push({ ...d.stockMovements[0], id: id(81) });
    }
    assert.equal(saleRestitution(d, d.items), null);
  });
const deps = Object.fromEntries(
  ['appointments', 'clients', 'inventory', 'products', 'analytics'].map((feature) => [
    `@/features/${feature}/constants/${feature}Keys`,
    load(`../${feature}/constants/${feature}Keys`),
  ]),
);
const { invalidateSaleCorrectionQueries } = load('utils/invalidateCheckoutQueries', deps);
const { salesKeys } = load('constants/salesKeys');
const { appointmentsKeys, clientsKeys, inventoryKeys, productsKeys, analyticsKeys } = Object.assign(
  {},
  ...Object.values(deps),
);
const scope = { businessId: b, userId: id(5), membershipId: id(9), role: 'OWNER' };
test('BF198A correction policy invalidates exact canonical consumers and preserves expenses/appointments/other contexts', async () => {
  const c = new QueryClient(),
    d = corrected();
  d.sale.client_id = id(85);
  d.sale.appointment_id = id(86);
  const affected = [
    salesKeys.detail(scope, id(4)),
    salesKeys.history(scope, { page: 1, pageSize: 25 }),
    salesKeys.history(scope, { page: 2, status: 'VOIDED' }),
    salesKeys.correction(scope, id(4)),
    productsKeys.list(scope, { page: 1 }),
    productsKeys.detail(scope, id(3)),
    inventoryKeys.productStock(b, id(3)),
    inventoryKeys.stockMovements(b, id(3), {}),
    inventoryKeys.productStockBatch(scope, [id(3)]),
    inventoryKeys.lowStockAlerts(scope, 1, 25),
    clientsKeys.stats(b, id(85), id(5), 'OWNER'),
    ...['summary', 'revenue', 'services', 'products'].map((resource) =>
      analyticsKeys.resource(
        resource,
        { businessId: b, userId: id(5), membershipId: id(9), timezone: 'UTC' },
        { from: at, to: at },
      ),
    ),
  ];
  const untouched = [
    salesKeys.history({ ...scope, businessId: id(90) }, {}),
    salesKeys.history({ ...scope, userId: id(90) }, {}),
    salesKeys.history({ ...scope, membershipId: id(90) }, {}),
    salesKeys.history({ ...scope, role: 'BARBER' }, {}),
    salesKeys.detail(scope, id(99)),
    salesKeys.correction(scope, id(99)),
    productsKeys.detail(scope, id(99)),
    inventoryKeys.productStockBatch(scope, [id(99)]),
    inventoryKeys.productStock(id(99), id(3)),
    inventoryKeys.lowStockAlerts({ ...scope, userId: id(99) }, 1, 25),
    analyticsKeys.resource('expenses', scope, null),
    analyticsKeys.resource('summary', { ...scope, userId: id(99) }, null),
    appointmentsKeys.detail(scope, id(86)),
    ['expenses', b],
    clientsKeys.stats(b, id(99), id(5), 'OWNER'),
  ];
  [...affected, ...untouched].forEach((key) => c.setQueryData(key, { fixture: true }));
  await invalidateSaleCorrectionQueries({
    scope,
    sale: d.sale,
    correctionResult: d,
    queryClient: c,
  });
  affected.forEach((key) =>
    assert.equal(c.getQueryState(key).isInvalidated, true, JSON.stringify(key)),
  );
  untouched.forEach((key) =>
    assert.equal(c.getQueryState(key).isInvalidated, false, JSON.stringify(key)),
  );
  c.clear();
});
for (const mode of ['stale', 'BARBER', 'foreign sale', 'sync throw', 'async reject'])
  test(`BF198A cache ${mode} never fabricates checkout or repeats writer`, async () => {
    const c = new QueryClient(),
      d = corrected(),
      calls = [];
    c.invalidateQueries = (filters) => {
      calls.push(filters);
      if (mode === 'sync throw') throw Error('refresh');
      return mode === 'async reject' ? Promise.reject(Error('refresh')) : Promise.resolve();
    };
    if (mode === 'foreign sale') d.sale.business_id = id(99);
    await invalidateSaleCorrectionQueries({
      scope: { ...scope, role: mode === 'BARBER' ? 'BARBER' : 'OWNER' },
      sale: d.sale,
      correctionResult: d,
      queryClient: c,
      isCurrent: () => mode !== 'stale',
    });
    assert.equal(calls.length, ['stale', 'BARBER', 'foreign sale'].includes(mode) ? 0 : 4);
    c.clear();
  });
test('BF198A key factories preserve root and isolate role/page/status/sale', () => {
  const key = salesKeys.history(scope, { page: 1, pageSize: 25 });
  for (const field of ['businessId', 'userId', 'membershipId', 'role'])
    assert.notDeepEqual(
      key,
      salesKeys.history({ ...scope, [field]: id(99) }, { page: 1, pageSize: 25 }),
    );
  assert.notDeepEqual(key, salesKeys.history(scope, { page: 2, pageSize: 25 }));
  assert.notDeepEqual(key, salesKeys.history(scope, { page: 1, pageSize: 25, status: 'VOIDED' }));
  assert.deepEqual(salesKeys.correction(scope, id(4)).slice(0, 2), salesKeys.byBusiness(b));
});
test('BF198A UI has no Supabase/private/SQL/backend writes or navigation tab edits', () => {
  for (const file of [
    'screens/SaleHistoryScreen.tsx',
    'screens/SaleDetailScreen.tsx',
    'components/SaleVoidAction.tsx',
    'components/SaleCorrectionContent.tsx',
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '../src/features/sales', file), 'utf8');
    assert(!/supabase|\.rpc\(|\.from\(|service.role|private\./.test(source));
  }
});
