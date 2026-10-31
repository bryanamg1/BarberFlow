/* global __dirname */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { test } = require('node:test'),
  { createClient } = require('@supabase/supabase-js');
const { load, id, b, data, response } = require('./helpers/bf196.cjs');
const detail = () => {
  const value = data();
  return { ...value.sale, sale_items: value.items, payments: value.payments };
};
test('BF197 actual SDK single relational normal-RLS query has exact13/11/9 fields and both filters', async () => {
  const requests = [],
    value = detail();
  const sdk = createClient('https://fixture.example.test', 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: new URL(url), init });
        return new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const repo = load('repositories/salesRepository', {
    '@/lib/supabase/client': { supabase: sdk },
  }).salesRepository;
  const result = await repo.getById(b, id(4));
  assert.deepEqual(result.data, value);
  assert.equal(requests.length, 1);
  const { url, init } = requests[0];
  assert.equal(init.method, 'GET');
  assert.equal(url.pathname, '/rest/v1/sales');
  assert.equal(url.searchParams.get('business_id'), 'eq.' + b);
  assert.equal(url.searchParams.get('id'), 'eq.' + id(4));
  assert.equal(
    url.searchParams.get('select').replace(/\s/g, ''),
    'id,business_id,client_id,appointment_id,operation_id,status,subtotal,discount,total,sold_at,created_by,created_at,updated_at,sale_items(id,sale_id,item_type,service_id,product_id,item_name_snapshot,unit_price_snapshot,quantity,line_total,unit_cost_snapshot,created_at),payments(id,business_id,sale_id,payment_method,amount,notes,paid_at,created_by,created_at)',
  );
  assert(!url.searchParams.has('order'));
  assert(!url.searchParams.has('limit'));
  assert(!url.search.includes('!inner'));
});
test('BF197 repository preserves SDK envelope/error and rejection', async () => {
  const expected = response(null, { code: '42501', message: 'raw' }, 403),
    reason = new Error('raw');
  function repo(reject) {
    const builder = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle() {
        return this;
      },
      overrideTypes() {
        return reject ? Promise.reject(reason) : Promise.resolve(expected);
      },
    };
    return load('repositories/salesRepository', {
      '@/lib/supabase/client': { supabase: { from: () => builder } },
    }).salesRepository;
  }
  assert.equal(await repo(false).getById(b, id(4)), expected);
  await assert.rejects(repo(true).getById(b, id(4)), (e) => e === reason);
});
function service(result = response(detail()), reject = false) {
  let calls = 0;
  return {
    service: load('services/salesService', {
      '../repositories/salesRepository': {
        salesRepository: {
          getById: async () => {
            calls++;
            if (reject) throw new Error('private');
            return result;
          },
        },
      },
    }).salesService,
    calls: () => calls,
  };
}
test('BF197 persisted snapshots, amounts, nullability and original text preserved without catalog reads', async () => {
  const value = detail();
  value.client_id = id(11);
  value.appointment_id = id(9);
  value.sale_items[0].item_name_snapshot = '  Historia original  ';
  value.payments[0].notes = '  Nota original  ';
  const result = await service(response(value)).service.getById(b, id(4));
  assert.deepEqual(result.data, value);
  assert.equal(result.error, null);
  assert.equal(Object.keys(result.data).length, 15);
});
test('BF197 invisible/missing header becomes NOT_FOUND, not fabricated empty sale', async () => {
  const result = await service(response(null)).service.getById(b, id(4));
  assert.equal(result.error.code, 'NOT_FOUND');
  assert.equal(result.data, null);
});
test('BF197 blank IDs fail before repository', async () => {
  const f = service();
  assert.equal((await f.service.getById('', id(4))).error.code, 'INVALID_INPUT');
  assert.equal((await f.service.getById(b, '  ')).error.code, 'INVALID_INPUT');
  assert.equal(f.calls(), 0);
});
for (const status of ['DRAFT', 'COMPLETED', 'VOIDED'])
  test(`BF197 ${status} header remains read-only with visible children`, async () => {
    const value = detail();
    value.status = status;
    if (status === 'DRAFT') value.sold_at = null;
    assert.equal((await service(response(value)).service.getById(b, id(4))).data.status, status);
  });
for (const mode of ['empty', 'multiple'])
  test(`BF197 ${mode} payments are preserved without debt/financial inference`, async () => {
    const value = detail();
    value.payments =
      mode === 'empty'
        ? []
        : [...value.payments, { ...value.payments[0], id: id(81), amount: 0.1 }];
    const result = await service(response(value)).service.getById(b, id(4));
    assert.deepEqual(result.data.payments, value.payments);
    assert.equal(result.data.total, 0.79);
  });
for (const mutate of [
  (v) => {
    v.business_id = id(99);
  },
  (v) => {
    v.id = id(99);
  },
  (v) => {
    v.sale_items[0].sale_id = id(99);
  },
  (v) => {
    v.payments[0].business_id = id(99);
  },
  (v) => {
    v.payments[0].sale_id = id(99);
  },
  (v) => {
    v.total = NaN;
  },
  (v) => {
    v.private_audit = { reason: 'secret' };
  },
])
  test('BF197 inconsistent or unapproved projection rejected without data exposure', async () => {
    const value = detail();
    mutate(value);
    const result = await service(response(value)).service.getById(b, id(4));
    assert.equal(result.data, null);
    assert.equal(result.error.code, 'UNKNOWN_ERROR');
    assert(!JSON.stringify(result).includes('secret'));
  });
for (const [status, code, expected] of [
  [0, '', 'NETWORK_ERROR'],
  [401, 'PGRST301', 'ACCESS_DENIED'],
  [403, '42501', 'ACCESS_DENIED'],
  [400, '42501', 'ACCESS_DENIED'],
  [500, 'XX000', 'UNKNOWN_ERROR'],
])
  test(`BF197 safe read error${status}/${code}`, async () => {
    const result = await service(
      response(null, { code, message: 'secret SQL' }, status),
    ).service.getById(b, id(4));
    assert.equal(result.error.code, expected);
    assert(!JSON.stringify(result).includes('secret'));
  });
test('BF197 unexpected rejection is safe, no raw error', async () => {
  const result = await service(null, true).service.getById(b, id(4));
  assert.equal(result.error.code, 'UNKNOWN_ERROR');
  assert(!JSON.stringify(result).includes('private'));
});
test('BF197 detail key scopes user/business/membership/sale with a precise invalidation prefix', () => {
  const { salesKeys } = load('constants/salesKeys'),
    scope = { userId: id(5), businessId: b, membershipId: id(8) };
  const key = salesKeys.detail(scope, id(4));
  assert.deepEqual(key.slice(0, 2), salesKeys.byBusiness(b));
  for (const field of ['userId', 'businessId', 'membershipId'])
    assert.notDeepEqual(salesKeys.detail({ ...scope, [field]: id(99) }, id(4)), key);
  assert.notDeepEqual(salesKeys.detail(scope, id(90)), key);
});
test('BF197 reader has no current catalog, audit, correction or privileged call', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/features/sales/repositories/salesRepository.ts'),
    'utf8',
  );
  // BF198A extends this repository with approved RPC adapters. The BF197 reader remains normal RLS.
  const reader = source.slice(
    source.indexOf('  getById('),
    source.indexOf('  getCorrectionDetail('),
  );
  assert(!/\.rpc\(|\.insert\(|\.update\(|service.role|audit|products\(|services\(/.test(reader));
  assert(source.includes('.maybeSingle()'));
});
