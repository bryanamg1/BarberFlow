const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createClient } = require('@supabase/supabase-js');
const { load, uuid, b, data, response } = require('./helpers/bf216.cjs');
const schema = load('schemas/purchaseRead.schema');
function detail() {
  const d = data();
  return {
    purchase: {
      id: d.purchase.id,
      supplier: d.purchase.supplier,
      total: d.purchase.total,
      purchased_at: null,
      status: 'COMPLETED',
      notes: '  original  ',
    },
    items: [
      {
        id: uuid(6),
        product_name_snapshot: 'Archived original',
        quantity: 3,
        unit_cost_snapshot: 0.29,
        line_total: 0.87,
      },
    ],
    expense: {
      amount: 0.87,
      expense_date: '2025-12-31',
      payment_method: 'BANK_TRANSFER',
      category_name: 'Archived category',
    },
    voidInfo: { status: 'not_applicable' },
  };
}
function service(result) {
  const calls = [];
  return {
    calls,
    value: load('services/purchasesService', {
      '../repositories/purchasesRepository': {
        purchasesRepository: {
          listByBusiness: (...args) => {
            calls.push(args);
            return result();
          },
          getById: (...args) => {
            calls.push(args);
            return result();
          },
        },
      },
    }).purchasesService,
  };
}
test('BF216B real SDK list transport uses only five fields/tenant/order/nulls-last/inclusive sentinel/no count or extra filters', async () => {
  const requests = [];
  const sdk = createClient('https://fixture.example.test', 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: new URL(url), init });
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    },
  });
  const repo = load('repositories/purchasesRepository', {
    '@/lib/supabase/client': { supabase: sdk },
  }).purchasesRepository;
  await repo.listByBusiness(b, { page: 2, pageSize: 25 });
  assert.equal(requests.length, 1);
  const q = requests[0].url.searchParams;
  assert.deepEqual([...q.keys()].sort(), ['business_id', 'limit', 'offset', 'order', 'select']);
  assert.equal(q.get('select'), 'id,supplier,total,purchased_at,status');
  assert.equal(q.get('business_id'), `eq.${b}`);
  assert.equal(q.get('order'), 'purchased_at.desc.nullslast,id.desc');
  assert.equal(q.get('offset'), '25');
  assert.equal(q.get('limit'), '26');
});
test('BF216B detail transport makes one RPC with exact args and preserves SDK envelope/rejection', async () => {
  const expected = response(detail());
  const calls = [];
  const repo = load('repositories/purchasesRepository', {
    '@/lib/supabase/client': {
      supabase: {
        rpc: (...args) => {
          calls.push(args);
          return Promise.resolve(expected);
        },
      },
    },
  }).purchasesRepository;
  assert.equal(await repo.getById(b, uuid(4)), expected);
  assert.deepEqual(calls, [['get_purchase_detail', { p_business_id: b, p_purchase_id: uuid(4) }]]);
  const cause = new Error('private');
  const rejected = load('repositories/purchasesRepository', {
    '@/lib/supabase/client': { supabase: { rpc: () => Promise.reject(cause) } },
  }).purchasesRepository;
  await assert.rejects(rejected.getById(b, uuid(4)), (e) => e === cause);
});
test('BF216B list defaults/page/sentinel and empty result are successful', async () => {
  const rows = Array.from({ length: 26 }, (_, i) => ({
    id: uuid(i + 1),
    supplier: 'Historical',
    total: 0,
    purchased_at: null,
    status: i % 2 ? 'VOIDED' : 'COMPLETED',
  }));
  const s = service(() => response(rows));
  const result = await s.value.listByBusiness(b);
  assert.deepEqual(s.calls, [[b, { page: 1, pageSize: 25 }]]);
  assert.equal(result.error, null);
  assert.equal(result.data.items.length, 25);
  assert.equal(result.data.hasNextPage, true);
  const empty = await service(() => response([])).value.listByBusiness(b, {
    page: 3,
    pageSize: 100,
  });
  assert.deepEqual(empty.data, { items: [], page: 3, pageSize: 100, hasNextPage: false });
});
for (const params of [
  { page: 0 },
  { page: -1 },
  { page: 1.5 },
  { page: '1' },
  { page: null },
  { pageSize: 0 },
  { pageSize: 101 },
  { pageSize: 1.5 },
  { pageSize: null },
  null,
  [],
  { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
])
  test(`BF216B invalid pagination never sends ${JSON.stringify(params)}`, async () => {
    const s = service(() => {
      throw Error('must not send');
    });
    assert.equal((await s.value.listByBusiness(b, params)).error.code, 'INVALID_INPUT');
    assert.equal(s.calls.length, 0);
  });
test('BF216B malformed IDs never send; missing/foreign detail has neutral NOT_FOUND', async () => {
  const s = service(() => response(null));
  assert.equal((await s.value.getById('', uuid(4))).error.code, 'INVALID_INPUT');
  assert.equal((await s.value.getById(b, 'wrong')).error.code, 'INVALID_INPUT');
  assert.equal(s.calls.length, 0);
  assert.deepEqual((await s.value.getById(b, uuid(4))).error, {
    code: 'NOT_FOUND',
    message: 'Compra no disponible.',
  });
});
test('BF216B reads preserve nullable dates/notes and original strings, archived catalog history', async () => {
  const d = detail();
  const r = await service(() => response(d)).value.getById(b, uuid(4));
  assert.deepEqual(r.data, d);
  assert.equal(r.error, null);
});
for (const [status, code, expected] of [
  [0, 'X', 'NETWORK_ERROR'],
  [401, 'X', 'ACCESS_DENIED'],
  [403, 'X', 'ACCESS_DENIED'],
  [400, '42501', 'ACCESS_DENIED'],
  [500, 'X', 'UNKNOWN_ERROR'],
])
  test(`BF216B read safe error ${status}/${code}`, async () => {
    const s = service(() => response(null, { code, message: 'private SQL cause' }, status));
    const r = await s.value.getById(b, uuid(4));
    assert.equal(r.error.code, expected);
    assert.ok(!r.error.message.includes('private'));
    assert.equal(s.calls.length, 1);
  });
test('BF216B thrown SDK failure is safe/never auto retries', async () => {
  const s = service(() => Promise.reject(new Error('private')));
  assert.equal((await s.value.getById(b, uuid(4))).error.code, 'UNKNOWN_ERROR');
  assert.equal(s.calls.length, 1);
});
for (const mutate of [
  (d) => {
    d.purchase.operation_id = uuid(1);
  },
  (d) => {
    d.purchase.id = uuid(80);
  },
  (d) => {
    d.items[0].operation_id = 'hidden';
  },
  (d) => {
    d.purchase.status = 'VOIDED';
  },
  (d) => {
    d.voidInfo = {
      status: 'available',
      reason: 'x',
      created_at: '2026-01-01T00:00:00Z',
      stockCompensation: [],
    };
  },
])
  test('BF216B rejects leaked or inconsistent read success', async () => {
    const d = detail();
    mutate(d);
    assert.equal(
      (await service(() => response(d)).value.getById(b, uuid(4))).error.code,
      'UNKNOWN_ERROR',
    );
  });
test('BF216B verified summary preserves duplicated identities and rejects mismatched/duplicate line mapping', () => {
  const d = detail();
  d.purchase.status = 'VOIDED';
  d.items.push({ ...d.items[0], id: uuid(7) });
  d.voidInfo = {
    status: 'available',
    reason: '  exact  ',
    created_at: '2026-01-01T00:00:00Z',
    stockCompensation: d.items.map((i) => ({
      purchase_item_id: i.id,
      quantity_delta: -i.quantity,
    })),
  };
  assert.equal(schema.purchaseDetailSchema.safeParse(d).success, true);
  d.voidInfo.stockCompensation[1].purchase_item_id = uuid(6);
  assert.equal(schema.purchaseDetailSchema.safeParse(d).success, false);
  d.voidInfo = { status: 'unavailable' };
  assert.equal(schema.purchaseDetailSchema.safeParse(d).success, true);
});
test('BF216B real keys partition business/user/membership/pagination/purchase', () => {
  const { purchasesKeys: k } = load('constants/purchasesKeys');
  const scope = { businessId: b, userId: uuid(1), membershipId: uuid(2) };
  assert.deepEqual(k.byBusiness(b), ['purchases', b]);
  assert.deepEqual(k.list(scope, { page: 1, pageSize: 25 }), [
    'purchases',
    b,
    'list',
    scope,
    { page: 1, pageSize: 25 },
  ]);
  assert.deepEqual(k.detail(scope, uuid(4)), ['purchases', b, 'detail', scope, uuid(4)]);
  assert.notDeepEqual(
    k.detail(scope, uuid(4)),
    k.detail({ ...scope, membershipId: uuid(3) }, uuid(4)),
  );
});
