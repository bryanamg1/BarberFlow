const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, cents, verify } = require('../scripts/e2e/checkout.cjs');
const { id } = require('../scripts/e2e/local.cjs');
const { webSpec } = require('../scripts/e2e/web.cjs');
const { verifyBranch } = require('../scripts/e2e/android.cjs');

test('BF306 harness: native branch extension preserves task/mode boundaries', () => {
  verifyBranch('bryan/test/bf306-checkout-e2e', 'prepare');
  verifyBranch('bryan/test/bf306-checkout-e2e', 'checkout');
  verifyBranch('bryan/test/bf305-login-session-e2e', 'auth');
  assert.throws(() => verifyBranch('develop', 'checkout'));
  assert.throws(() => verifyBranch('bryan/test/bf306-checkout-e2e', 'auth'));
  assert.throws(() => verifyBranch('bryan/test/bf305-login-session-e2e', 'checkout'));
});

test('BF306 harness: exact checkout selection never selects session/auth specs', () => {
  const filter = new RegExp(webSpec('checkout'));
  assert.ok(filter.test('C:\\repo\\checkout.spec.cjs'));
  for (const file of ['session.spec.cjs', 'auth-session.spec.cjs', 'not-checkout.spec.cjs'])
    assert.equal(filter.test(file), false);
  assert.ok(new RegExp(webSpec('web')).test('session.spec.cjs'));
  assert.ok(new RegExp(webSpec('auth')).test('auth-session.spec.cjs'));
});

test('BF306 harness: deterministic domain fixtures remain separated across tenants', () => {
  assert.deepEqual(fixture(), fixture('a'));
  for (const key of [
    'serviceId',
    'productId',
    'movementId',
    'appointmentId',
    'appointmentItemId',
  ]) {
    assert.match(fixture()[key], /^[a-f0-9-]{36}$/);
    assert.notEqual(fixture()[key], fixture('b')[key]);
  }
  assert.throws(() => fixture('remote'));
});

test('BF306 harness: cent assertions reject floats and retain decimal precision', () => {
  assert.equal(cents('9999999999.99'), 999999999999n);
  assert.equal(cents('0.01'), 1n);
  for (const value of ['1.001', 'NaN', '-1.00', '1', 1.01]) assert.throws(() => cents(value));
});

function persisted() {
  const f = fixture();
  return {
    sales: [
      {
        id: 'sale',
        business_id: id('tenant-a'),
        created_by: id('owner-a'),
        status: 'COMPLETED',
        sold_at: 'now',
        created_at: 'now',
        updated_at: 'now',
        subtotal: '10.02',
        discount: '0.00',
        total: '10.02',
        client_id: null,
        appointment_id: null,
      },
    ],
    items: [
      {
        id: 'item',
        sale_id: 'sale',
        item_type: 'PRODUCT',
        quantity: 1,
        unit_price_snapshot: '10.02',
        line_total: '10.02',
        unit_cost_snapshot: '4.03',
        item_name_snapshot: 'BF306 Product A',
        product_id: f.productId,
        service_id: null,
      },
    ],
    payments: [
      {
        id: 'payment',
        sale_id: 'sale',
        business_id: id('tenant-a'),
        amount: '10.02',
        payment_method: 'CASH',
        created_by: id('owner-a'),
        paid_at: 'now',
      },
    ],
    movements: [
      {
        id: f.movementId,
        type: 'ADJUSTMENT',
        quantity_delta: 20,
        occurred_at: '2026-01-01T00:00:00+00:00',
      },
      {
        id: 'debit',
        type: 'SALE',
        quantity_delta: -1,
        unit_cost: '4.03',
        reference_id: 'sale',
        product_id: f.productId,
      },
    ],
    appointment: { status: 'CONFIRMED' },
    appointmentItems: [
      { service_name_snapshot: 'BF306 Historical service', unit_price_snapshot: 12 },
    ],
  };
}
const expected = {
  gross: '10.02',
  net: '10.02',
  items: [{ type: 'PRODUCT', quantity: 1, price: '10.02' }],
};

test('BF306 harness: persistence oracle accepts a coherent exact-cent product transaction', () => {
  assert.equal(verify(persisted(), expected), 'sale');
});

for (const [name, corrupt] of [
  ['duplicate sale', (s) => s.sales.push({ ...s.sales[0] })],
  [
    'missing payment',
    (s) => {
      s.payments = [];
    },
  ],
  [
    'wrong payment amount',
    (s) => {
      s.payments[0].amount = '10.01';
    },
  ],
  [
    'wrong stock debit',
    (s) => {
      s.movements[1].quantity_delta = -2;
    },
  ],
  [
    'mutated opening ledger',
    (s) => {
      s.movements[0].quantity_delta = 21;
    },
  ],
  [
    'wrong historical cost',
    (s) => {
      s.items[0].unit_cost_snapshot = '4.04';
    },
  ],
  [
    'missing appointment completion',
    (s) => {
      s.sales[0].client_id = id('client-a');
      s.sales[0].appointment_id = fixture().appointmentId;
    },
  ],
])
  test(`BF306 harness: oracle detects ${name}`, () => {
    const actual = persisted();
    corrupt(actual);
    assert.throws(() =>
      verify(actual, {
        ...expected,
        ...(name === 'missing appointment completion' ? { linked: true } : {}),
      }),
    );
  });
