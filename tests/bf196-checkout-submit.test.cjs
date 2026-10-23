/* global __dirname */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { test } = require('node:test'),
  { createClient } = require('@supabase/supabase-js');
const { load, id, b, input, data, response } = require('./helpers/bf196.cjs');
test('BF196 actual SDK sends one exact seven-argument complete_checkout request from capture values', async () => {
  const requests = [],
    value = input();
  value.appointmentId = id(9);
  value.clientId = id(10);
  value.items.push({ ...value.items[1], lineId: 'local-only', availability: 'not-wire' });
  const sdk = createClient('https://fixture.example.test', 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify(data()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const repo = load('repositories/checkoutRepository', {
    '@/lib/supabase/client': { supabase: sdk },
  }).checkoutRepository;
  const result = await repo.complete(b, value);
  assert.deepEqual(result.data, data());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://fixture.example.test/rest/v1/rpc/complete_checkout');
  assert.equal(requests[0].init.method, 'POST');
  const body = JSON.parse(requests[0].init.body);
  assert.deepEqual(
    Object.keys(body).sort(),
    [
      'p_business_id',
      'p_operation_id',
      'p_appointment_id',
      'p_client_id',
      'p_discount_amount',
      'p_payment_method',
      'p_items',
    ].sort(),
  );
  assert.equal(body.p_business_id, b);
  assert.equal(body.p_operation_id, value.operationId);
  assert.equal(body.p_appointment_id, id(9));
  assert.equal(body.p_client_id, id(10));
  assert.equal(body.p_discount_amount, '0.10');
  assert.equal(body.p_payment_method, 'BANK_TRANSFER');
  assert.deepEqual(body.p_items, [
    value.items[0],
    { itemType: 'PRODUCT', itemId: id(3), quantity: 1 },
    { itemType: 'PRODUCT', itemId: id(3), quantity: 1 },
  ]);
});
test('BF196 direct-sale nulls and zero-total selected method remain exact; no local metadata', async () => {
  let args;
  const expected = response();
  const repo = load('repositories/checkoutRepository', {
    '@/lib/supabase/client': {
      supabase: {
        rpc: (name, value) => {
          args = { name, value };
          return Promise.resolve(expected);
        },
      },
    },
  }).checkoutRepository;
  const original = input();
  original.discountAmount = '0.89';
  original.paymentMethod = 'CASH';
  Object.freeze(original.items);
  Object.freeze(original);
  assert.equal(await repo.complete(b, original), expected);
  assert.equal(args.value.p_appointment_id, null);
  assert.equal(args.value.p_client_id, null);
  assert.equal(args.value.p_discount_amount, '0.89');
  assert.equal(args.value.p_payment_method, 'CASH');
  assert(!JSON.stringify(args.value).includes('lineId'));
});
test('BF196 repository retains SDK rejection and envelope', async () => {
  const error = { code: '42501', message: 'raw private' },
    expected = response(null, error, 403);
  const repo = load('repositories/checkoutRepository', {
    '@/lib/supabase/client': { supabase: { rpc: () => Promise.resolve(expected) } },
  }).checkoutRepository;
  assert.equal(await repo.complete(b, input()), expected);
  const reason = new Error('private');
  const rejecting = load('repositories/checkoutRepository', {
    '@/lib/supabase/client': { supabase: { rpc: () => Promise.reject(reason) } },
  }).checkoutRepository;
  await assert.rejects(rejecting.complete(b, input()), (e) => e === reason);
});
test('BF196 RPC argument names/items shape agree with actual SQL; no privileged writes', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20261022181656_complete_checkout.sql'),
    'utf8',
  );
  assert.match(
    sql,
    /public\.complete_checkout\(\s*p_business_id uuid,\s*p_operation_id uuid,\s*p_appointment_id uuid,\s*p_client_id uuid,\s*p_discount_amount numeric,\s*p_payment_method text,\s*p_items jsonb/,
  );
  for (const property of ['itemType', 'itemId', 'quantity', 'unitPriceOverride'])
    assert(sql.includes(`'${property}'`));
  const source = fs.readFileSync(
    path.join(__dirname, '../src/features/sales/repositories/checkoutRepository.ts'),
    'utf8',
  );
  assert(!/\.from\(|\.insert\(|service.role|process\.env/.test(source));
});
function service(result = response(), reject = false) {
  let calls = 0;
  const complete = async () => {
    calls++;
    if (reject) throw new Error('secret');
    return result;
  };
  return {
    service: load('services/checkoutService', {
      '../repositories/checkoutRepository': { checkoutRepository: { complete } },
    }).checkoutService,
    calls: () => calls,
  };
}
test('BF196 service accepts persisted success, preserves original response and does not recompute catalog', async () => {
  const value = data(),
    f = service(response(value)),
    result = await f.service.complete(b, input());
  assert.equal(result.data, value);
  assert.equal(result.error, null);
  assert.equal(f.calls(), 1);
});
test('BF196 replay may return historical different items/creator/VOIDED and remains success', async () => {
  const value = data();
  value.sale.status = 'VOIDED';
  value.sale.created_by = id(99);
  value.items[0].item_name_snapshot = 'Historical original';
  const f = service(response(value));
  assert.equal(
    (
      await f.service.complete(b, {
        ...input(),
        items: [{ itemType: 'SERVICE', itemId: id(50), quantity: 1 }],
      })
    ).data,
    value,
  );
});
test('BF196 confirmed zero total accepts zero payments; input still requires explicit method', async () => {
  const value = data();
  value.sale.discount = value.sale.subtotal;
  value.sale.total = 0;
  value.payments = [];
  const f = service(response(value));
  assert.equal((await f.service.complete(b, { ...input(), discountAmount: '0.89' })).data, value);
});
for (const patch of [
  { items: [] },
  { discountAmount: '-1.00' },
  { discountAmount: 'NaN' },
  { paymentMethod: undefined },
  { paymentMethod: 'TRANSFER' },
  { operationId: '' },
  { items: [{ itemType: 'SERVICE', itemId: id(2), quantity: 0 }] },
])
  test(`BF196 invalid input ${JSON.stringify(patch)} rejected before RPC`, async () => {
    const f = service(),
      result = await f.service.complete(b, { ...input(), ...patch });
    assert.equal(result.error.code, 'INVALID_INPUT');
    assert.equal(f.calls(), 0);
  });
for (const change of [
  (v) => {
    v.sale.business_id = id(99);
  },
  (v) => {
    v.sale.operation_id = id(99);
  },
  (v) => {
    v.items[0].sale_id = id(99);
  },
  (v) => {
    v.payments[0].business_id = id(99);
  },
  (v) => {
    v.payments = [];
  },
  (v) => {
    v.items = [];
  },
  (v) => {
    v.sale.status = 'DRAFT';
  },
])
  test('BF196 incoherent/malformed success stays unknown/uncertain, not false confirmation', async () => {
    const value = data();
    change(value);
    const result = await service(response(value)).service.complete(b, input());
    assert.equal(result.error.code, 'UNKNOWN_ERROR');
    assert.equal(result.data, null);
  });
for (const [status, code, details, expected] of [
  [401, 'PGRST301', null, 'UNAUTHORIZED'],
  [403, '42501', null, 'ACCESS_DENIED'],
  [400, '22023', 'INVALID_CHECKOUT', 'INVALID_INPUT'],
  [409, 'PT409', 'INVALID_APPOINTMENT_STATUS', 'INVALID_APPOINTMENT_STATUS'],
  [409, 'PT409', 'INSUFFICIENT_STOCK', 'INSUFFICIENT_STOCK'],
  [409, '23505', null, 'CONFLICT'],
  [500, '40001', null, 'RETRYABLE_ERROR'],
  [500, '40P01', null, 'RETRYABLE_ERROR'],
  [0, '', null, 'NETWORK_ERROR'],
  [500, 'XX000', null, 'UNKNOWN_ERROR'],
])
  test(`BF196 safe fixed mapping ${code}/${details}`, async () => {
    const result = await service(
      response(null, { code, details, message: 'SQL internal secret' }, status),
    ).service.complete(b, input());
    assert.equal(result.error.code, expected);
    assert(!JSON.stringify(result).includes('secret'));
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message']);
  });
test('BF196 unexpected transport rejection is conservative unknown, never a definitive rollback', async () => {
  const result = await service(null, true).service.complete(b, input());
  assert.equal(result.error.code, 'UNKNOWN_ERROR');
  const { uncertainCheckoutError } = load('services/checkoutErrors');
  assert(uncertainCheckoutError(result.error));
  assert(!JSON.stringify(result).includes('secret'));
});
