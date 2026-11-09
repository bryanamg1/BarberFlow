const assert = require('node:assert/strict');
const { test } = require('node:test');
const native = require('../scripts/e2e/android.cjs');
const { webSpec } = require('../scripts/e2e/web.cjs');
const purchase = require('../scripts/e2e/purchase.cjs');

test('BF307 selects only its purchase spec and the approved native branch', () => {
  const branch = 'bryan/test/bf307-purchase-e2e';
  native.verifyBranch(branch, 'purchase');
  assert.throws(() => native.verifyBranch(branch, 'checkout'));
  assert.throws(() => native.verifyBranch('develop', 'purchase'));
  const filter = new RegExp(webSpec('purchase'));
  assert.ok(filter.test('C:\\repo\\purchase.spec.cjs'));
  assert.equal(filter.test('not-purchase.spec.cjs'), false);
  assert.equal(filter.test('checkout.spec.cjs'), false);
});

test('BF307 fixture and replay payload IDs are deterministic and isolated by tenant', () => {
  const a = purchase.fixture();
  const b = purchase.fixture('b');
  assert.deepEqual(a, purchase.fixture('a'));
  assert.notEqual(a.businessId, b.businessId);
  assert.notEqual(a.category, b.category);
  assert.equal(
    new Set([...a.products, ...b.products].flatMap(({ id, movement }) => [id, movement])).size,
    8,
  );
  assert.equal(a.products[0].opening, 10);
  assert.equal(a.products[0].cost, '4.03');
  assert.deepEqual(purchase.payload(), purchase.payload('a', 'control'));
  assert.notEqual(
    purchase.payload('a', 'invalid').p_operation_id,
    purchase.payload().p_operation_id,
  );
  assert.equal(purchase.payload('b').p_items[0].productId, b.products[0].id);
});
