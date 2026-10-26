const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./helpers/agenda.cjs');
const { canManageAppointment, persistedAppointmentMinutes } = load('utils/appointmentEditing');
const scope = { businessId: 'b', userId: 'u', membershipId: 'm', role: 'OWNER' };
const row = {
  business_id: 'b',
  barber_member_id: 'm',
  status: 'PENDING',
  start_at: '2026-10-01T09:00:00Z',
  end_at: '2026-10-01T09:45:00Z',
};
for (const status of ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) {
  test(`BF157A ${status} action eligibility for OWNER and assigned BARBER follows D01`, () => {
    const allowed = ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(status);
    assert.equal(canManageAppointment({ ...row, status }, scope), allowed);
    assert.equal(canManageAppointment({ ...row, status }, { ...scope, role: 'BARBER' }), allowed);
    assert.equal(
      canManageAppointment(
        { ...row, status, barber_member_id: 'other' },
        { ...scope, role: 'BARBER' },
      ),
      false,
    );
  });
}
test('BF157A requires same business and active caller context', () => {
  assert.equal(canManageAppointment(row, null), false);
  assert.equal(canManageAppointment(row, { ...scope, businessId: 'other' }), false);
});
test('BF157A reschedule duration is persisted actual time, including a previous override', () => {
  assert.equal(persistedAppointmentMinutes(row), 45);
  assert.equal(
    persistedAppointmentMinutes({
      ...row,
      start_at: '2026-11-01T01:30:00-04:00',
      end_at: '2026-11-01T01:30:00-05:00',
    }),
    60,
  );
});
test('BF157A invalid/fractional/nonpositive persisted duration is unavailable, never a fabricated default', () => {
  for (const end_at of ['invalid', row.start_at, '2026-10-01T08:00:00Z', '2026-10-01T09:00:30Z'])
    assert.equal(persistedAppointmentMinutes({ ...row, end_at }), null);
});
