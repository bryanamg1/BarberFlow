const assert = require('node:assert/strict');
const checkout = require('./checkout.cjs');
const local = require('./local.cjs');

const options = { openingStock: 1 };
const seed = (users) => checkout.seed(users, options);
const reset = (users) => checkout.reset(users, options);

function baseline() {
  for (const tenant of ['a', 'b']) {
    const { sales, items, payments, movements, appointment } = checkout.snapshot(tenant);
    assert.deepEqual([sales.length, items.length, payments.length], [0, 0, 0]);
    assert.deepEqual(
      movements.map(({ id, product_id, type, quantity_delta }) => [
        id,
        product_id,
        type,
        quantity_delta,
      ]),
      [[checkout.fixture(tenant).movementId, checkout.fixture(tenant).productId, 'ADJUSTMENT', 1]],
    );
    assert.equal(appointment.status, 'CONFIRMED');
    assert.equal(checkout.stock(tenant), '1');
  }
}

function assertLedger(movements, expected) {
  const ordered = [...movements].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  let balance = 0;
  for (const entry of ordered) {
    balance += entry.quantity_delta;
    assert.ok(balance >= 0, 'BF308 product ledger went negative');
  }
  assert.equal(balance, expected);
}

function rejected(before, after, stock) {
  assert.deepEqual(after, before, 'Rejected checkout changed persisted state');
  assertLedger(after.movements, stock);
}

function soldOne(before, after, operationId) {
  assertLedger(before.movements, 1);
  const delta = (field) => {
    const known = new Set(before[field].map(({ id }) => id));
    assert.deepEqual(
      after[field].filter(({ id }) => known.has(id)),
      before[field],
    );
    return after[field].filter(({ id }) => !known.has(id));
  };
  const newMovements = delta('movements');
  assert.equal(newMovements.length, 1);
  const changes = {
    ...after,
    sales: delta('sales'),
    items: delta('items'),
    payments: delta('payments'),
    movements: [
      before.movements.find(({ id }) => id === checkout.fixture().movementId),
      ...newMovements,
    ],
  };
  const saleId = checkout.verify(changes, {
    ...options,
    gross: '10.02',
    net: '10.02',
    items: [{ type: 'PRODUCT', quantity: 1, price: '10.02' }],
  });
  if (operationId !== undefined) assert.equal(changes.sales[0].operation_id, operationId);
  assert.deepEqual(after.appointment, before.appointment);
  assert.deepEqual(after.appointmentItems, before.appointmentItems);
  assertLedger(after.movements, 0);
  return saleId;
}

function adjustNative(delta, phase) {
  assert.ok((delta === 1 && phase === 'prepare') || (delta === -1 && phase === 'stale'));
  const operation = local.id(`bf308-android-${phase}`);
  const business = local.id('tenant-a');
  const owner = local.id('owner-a');
  const product = checkout.fixture().productId;
  const result = local.sql(`BEGIN;
    SET LOCAL request.jwt.claims = '{"sub":"${owner}","role":"authenticated"}';
    SET LOCAL ROLE authenticated;
    SELECT public.adjust_stock('${business}','${operation}','${product}',${delta},'ADJUSTMENT',NULL)->>'quantity_delta';
    COMMIT;`);
  assert.equal(result, String(delta));
}

module.exports = { seed, reset, baseline, rejected, soldOne, assertLedger, adjustNative };
