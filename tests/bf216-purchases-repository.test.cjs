const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createClient } = require('@supabase/supabase-js');
const { load, b, input, data, response } = require('./helpers/bf216.cjs');

test('BF216 repository has exactly one operation and preserves SDK envelope', async () => {
  const result = response();
  const calls = [];
  const { purchasesRepository: repo } = load('repositories/purchasesRepository', {
    '@/lib/supabase/client': {
      supabase: {
        rpc: (...args) => {
          calls.push(args);
          return Promise.resolve(result);
        },
      },
    },
  });
  assert.deepEqual(Object.keys(repo), ['completePurchase']);
  assert.strictEqual(await repo.completePurchase(b, input), result);
  assert.deepEqual(calls, [
    [
      'complete_purchase',
      {
        p_business_id: b,
        p_operation_id: input.operationId,
        p_supplier: input.supplierName,
        p_expense_category_id: input.expenseCategoryId,
        p_payment_method: input.paymentMethod,
        p_purchased_at: input.purchasedAt,
        p_notes: null,
        p_items: input.items,
      },
    ],
  ]);
});
test('BF216 repository retains null/empty/original notes and duplicate input lines', async () => {
  for (const notes of [undefined, null, '', '  original\n ']) {
    let args;
    const repo = load('repositories/purchasesRepository', {
      '@/lib/supabase/client': {
        supabase: {
          rpc: (_name, value) => {
            args = value;
            return Promise.resolve(response());
          },
        },
      },
    }).purchasesRepository;
    await repo.completePurchase(b, { ...input, notes, items: [...input.items, ...input.items] });
    assert.equal(args.p_notes, notes ?? null);
    assert.deepEqual(args.p_items, [...input.items, ...input.items]);
  }
});
test('BF216 real SDK serializes one RPC request with no followup or privileged credential', async () => {
  const requests = [];
  const expected = data();
  const sdk = createClient('https://fixture.example.test', 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify(expected), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const repo = load('repositories/purchasesRepository', {
    '@/lib/supabase/client': { supabase: sdk },
  }).purchasesRepository;
  const result = await repo.completePurchase(b, input);
  assert.deepEqual(result.data, expected);
  assert.equal(result.status, 200);
  assert.equal(result.error, null);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://fixture.example.test/rest/v1/rpc/complete_purchase');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(Object.keys(JSON.parse(requests[0].init.body)).length, 8);
  assert.deepEqual(JSON.parse(requests[0].init.body).p_items, input.items);
});
test('BF216 repository preserves SDK errors/status and unexpected rejection', async () => {
  const original = response(
    null,
    { code: '42501', details: 'fixture', message: 'private fixture' },
    403,
  );
  let reject = false;
  const failure = new Error('fixture rejection');
  const repo = load('repositories/purchasesRepository', {
    '@/lib/supabase/client': {
      supabase: { rpc: () => (reject ? Promise.reject(failure) : Promise.resolve(original)) },
    },
  }).purchasesRepository;
  assert.strictEqual(await repo.completePurchase(b, input), original);
  reject = true;
  await assert.rejects(repo.completePurchase(b, input), (error) => error === failure);
});
