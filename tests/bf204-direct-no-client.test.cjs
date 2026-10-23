/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createClient } = require('@supabase/supabase-js');
const { load, id, b, input, data } = require('./helpers/bf196.cjs');

function transport(value = data(), status = 200) {
  const requests = [];
  const sdk = createClient('https://fixture.example.test', 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
        return new Response(JSON.stringify(value), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  return {
    requests,
    service: load('services/checkoutService', { '@/lib/supabase/client': { supabase: sdk } })
      .checkoutService,
  };
}

for (const clientId of [null, id(60)]) {
  test(`BF204 actual service/repository/SDK direct transport preserves ${clientId === null ? 'explicit NULL' : 'real client'} without rewriting result`, async () => {
    const value = input(),
      result = data();
    value.clientId = clientId;
    result.sale.client_id = clientId;
    const f = transport(result);
    const response = await f.service.complete(b, value);
    assert.equal(response.error, null);
    assert.deepEqual(response.data, result);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, 'https://fixture.example.test/rest/v1/rpc/complete_checkout');
    assert.equal(f.requests[0].method, 'POST');
    assert.deepEqual(f.requests[0].body, {
      p_business_id: b,
      p_operation_id: value.operationId,
      p_appointment_id: null,
      p_client_id: clientId,
      p_discount_amount: value.discountAmount,
      p_payment_method: value.paymentMethod,
      p_items: value.items,
    });
  });
}

test('BF204 linked checkout retains explicit appointment/client references and the same response shape', async () => {
  const value = input(),
    result = data();
  value.appointmentId = result.sale.appointment_id = id(9);
  value.clientId = result.sale.client_id = id(60);
  const f = transport(result);
  const response = await f.service.complete(b, value);
  assert.deepEqual(response.data, result);
  assert.equal(f.requests[0].body.p_appointment_id, id(9));
  assert.equal(f.requests[0].body.p_client_id, id(60));
});

for (const invalid of ['', '   ', undefined]) {
  test(`BF204 ${String(invalid)} client is not silently normalized to a valid anonymous sale`, async () => {
    const value = input();
    value.clientId = invalid;
    const f = transport();
    const response = await f.service.complete(b, value);
    assert.equal(response.error.code, 'INVALID_INPUT');
    assert.equal(response.data, null);
    assert.equal(f.requests.length, 0);
  });
}

for (const [status, code, expected] of [
  [400, '22023', 'INVALID_INPUT'],
  [403, '42501', 'ACCESS_DENIED'],
]) {
  test(`BF204 backend ${expected} for an invalid/foreign client or caller remains a safe error`, async () => {
    const value = input();
    value.clientId = id(60);
    const f = transport(
      { code, message: 'private tenant detail', details: 'private detail', hint: null },
      status,
    );
    const result = await f.service.complete(b, value);
    assert.equal(result.error.code, expected);
    assert.equal(result.data, null);
    assert(!JSON.stringify(result).includes('private'));
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].body.p_client_id, id(60));
  });
}

test('BF204 real BF188 SQL accepts absent client while retaining tenant/appointment/OWNER guards', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20261022181656_complete_checkout.sql'),
    'utf8',
  );
  assert.match(sql, /p_appointment_id uuid,\s*p_client_id uuid,/);
  assert.match(
    sql,
    /IF p_client_id IS NOT NULL AND NOT EXISTS\(SELECT 1 FROM public\.clients c\s*WHERE c\.id=p_client_id AND c\.business_id=p_business_id\)/,
  );
  assert.match(
    sql,
    /IF p_client_id IS NOT NULL AND p_client_id IS DISTINCT FROM appointment_client/,
  );
  assert.match(sql, /public\.has_business_role\(p_business_id,ARRAY\['OWNER'\]\)/);
  assert.match(
    sql,
    /IF p_appointment_id IS NOT NULL THEN\s*PERFORM private\.complete_checkout_appointment/,
  );
});

test('BF204 captured direct NULL remains immutable across retry, with no synthetic client or new key', () => {
  const store = load('store/checkoutDraftStore').checkoutDraftStore;
  const scope = { businessId: b, userId: id(5), membershipId: id(8) };
  const state = () => store.getState();
  state().setScope(scope);
  state().startDraft(scope, id(1));
  state().addLine(
    scope,
    id(1),
    { lineId: 'p', itemId: id(3), itemType: 'PRODUCT', quantity: 1 },
    b,
  );
  state().patchDraft(scope, id(1), { paymentMethod: 'CASH' });
  const capture = state().captureIntent(scope, id(1));
  assert.equal(capture.input.clientId, null);
  assert.equal(capture.input.appointmentId, null);
  assert(Object.isFrozen(capture.input));
  assert.equal(state().startDraft(scope, id(2), { clientId: id(60) }), false);
  state().settleCapture(capture, 'uncertain');
  assert.equal(state().retryCapture(capture), true);
  assert.equal(state().submission.capture, capture);
  assert.equal(capture.input.operationId, id(1));
  assert.equal(capture.input.clientId, null);
});
