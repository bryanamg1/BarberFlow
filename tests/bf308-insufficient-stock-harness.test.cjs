const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertLedger, rejected } = require('../scripts/e2e/insufficient-stock.cjs');
const { verifyBranch } = require('../scripts/e2e/android.cjs');
const { webSpec } = require('../scripts/e2e/web.cjs');

test('BF308 mode selects only the approved Web spec and native branch', () => {
  const filter = new RegExp(webSpec('insufficient-stock'));
  assert.ok(filter.test('C:\\repo\\insufficient-stock.spec.cjs'));
  for (const file of ['checkout.spec.cjs', 'session.spec.cjs', 'not-insufficient-stock.spec.cjs']) {
    assert.equal(filter.test(file), false);
  }
  const branch = 'bryan/test/bf308-insufficient-stock-e2e';
  verifyBranch(branch, 'prepare');
  verifyBranch(branch, 'insufficient-stock');
  assert.throws(() => verifyBranch(branch, 'checkout'));
  assert.throws(() => verifyBranch('develop', 'insufficient-stock'));
  assert.throws(() => verifyBranch('bryan/test/bf306-checkout-e2e', 'insufficient-stock'));
});

const movement = (sequence, quantity_delta) => ({
  id: String(sequence),
  created_at: `2026-01-01T00:00:0${sequence}Z`,
  quantity_delta,
});
const before = {
  sales: [],
  items: [],
  payments: [],
  movements: [movement(0, 1)],
  appointment: { status: 'CONFIRMED' },
};

test('BF308 ledger oracle detects an oversell even if replenishment leaves a nonnegative total', () => {
  assertLedger([movement(3, -1), movement(0, 1), movement(1, -1), movement(2, 1)], 0);
  assert.throws(
    () => assertLedger([movement(2, -1), movement(0, 1), movement(1, -1), movement(3, 1)], 0),
    /ledger went negative/,
  );
});

for (const field of ['sales', 'items', 'payments', 'movements', 'appointment']) {
  test(`BF308 reject oracle detects a partial ${field} effect`, () => {
    rejected(before, structuredClone(before), 1);
    const actual = {
      ...before,
      [field]:
        field === 'appointment' ? { status: 'COMPLETED' } : [...before[field], { id: 'partial' }],
    };
    assert.throws(() => rejected(before, actual, 1), /changed persisted state/);
  });
}
