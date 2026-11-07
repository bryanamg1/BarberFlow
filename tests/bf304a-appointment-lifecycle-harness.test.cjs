const assert = require('node:assert/strict');
const { test } = require('node:test');
const { verifyBranch } = require('../scripts/e2e/android.cjs');
const { webSpec } = require('../scripts/e2e/web.cjs');
const { accounts, id } = require('../scripts/e2e/local.cjs');
const { accountGuard } = require('./e2e/helpers/environment.cjs');
const { assertAppointment, fixtures } = require('../scripts/e2e/appointment-lifecycle.cjs');

test('BF304A runner accepts only the intended native branch and exact Web spec', () => {
  const branch = 'bryan/test/bf304a-client-service-appointment-e2e';
  verifyBranch(branch, 'prepare');
  verifyBranch(branch, 'appointment-lifecycle');
  assert.throws(() => verifyBranch('develop', 'appointment-lifecycle'));
  assert.throws(() => verifyBranch(branch, 'insufficient-stock'));
  const filter = new RegExp(webSpec('appointment-lifecycle'));
  assert.ok(filter.test('C:\\repo\\appointment-lifecycle.spec.cjs'));
  assert.equal(filter.test('not-appointment-lifecycle.spec.cjs'), false);
  assert.equal(filter.test('checkout.spec.cjs'), false);
});

test('BF304A BARBER fixture is opt-in, assigned to tenant A and constrained to a synthetic email', () => {
  assert.deepEqual(Object.keys(accounts()), ['a', 'b']);
  const users = accounts({ withBarber: true });
  assert.equal(users.barber.businessId, users.a.businessId);
  assert.notEqual(users.barber.businessId, users.b.businessId);
  assert.notEqual(users.barber.userId, users.a.userId);
  assert.notEqual(users.barber.memberId, users.a.memberId);
  assert.equal(users.barber.userId, accounts({ withBarber: true }).barber.userId);
  accountGuard(users.barber.email);
  assert.throws(() => accountGuard('bf304a.barber-b@example.test'));
});

const expected = {
  client_id: id('client-a'),
  barber_member_id: id('bf304a-barber-membership-a'),
  start_at: '2030-05-06T12:00:00+00:00',
  end_at: '2030-05-06T12:30:00+00:00',
  status: 'PENDING',
  service: fixtures.service,
  name: 'BF304A Servicio',
  price: '12.50',
};
const persisted = {
  ...expected,
  id: fixtures.assigned,
  business_id: id('tenant-a'),
  created_at: 'created',
  updated_at: 'updated',
  items: [
    {
      appointment_id: fixtures.assigned,
      service_id: fixtures.service,
      service_name_snapshot: expected.name,
      duration_minutes_snapshot: 30,
      quantity: 1,
      unit_price_snapshot: '12.50',
      line_total: '12.50',
    },
  ],
};

test('BF304A persistence oracle detects changed client, schedule, and historical price', () => {
  assertAppointment(persisted, expected);
  assert.throws(() => assertAppointment({ ...persisted, client_id: id('client-b') }, expected));
  assert.throws(() =>
    assertAppointment({ ...persisted, start_at: '2030-05-06T09:00:00+00:00' }, expected),
  );
  assert.throws(() =>
    assertAppointment(
      { ...persisted, items: [{ ...persisted.items[0], unit_price_snapshot: '12.51' }] },
      expected,
    ),
  );
});
