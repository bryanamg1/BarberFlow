const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./helpers/agenda.cjs');
const { orderAppointmentSlots, matchingAppointmentSlot, appointmentSlotLabel } =
  load('utils/appointmentSlots');
const slot = (start_at, end_at, available = true) => ({ start_at, end_at, available });
const a = slot('2026-10-23T09:00:00Z', '2026-10-23T09:30:00Z');
const b = slot('2026-10-23T10:00:00Z', '2026-10-23T10:30:00Z', false);
test('BF164 orders exact server slots without mutating the query cache or generating new slots', () => {
  const source = Object.freeze([Object.freeze(b), Object.freeze(a)]);
  const sorted = orderAppointmentSlots(source);
  assert.deepEqual(sorted, [a, b]);
  assert.deepEqual(source, [b, a]);
  assert.equal(sorted[0], a);
});
test('BF164 ordering compares instants, not offset spelling or device timezone', () => {
  const offset = slot('2026-10-23T08:00:00-03:00', '2026-10-23T08:30:00-03:00');
  assert.deepEqual(orderAppointmentSlots([offset, b, a]), [a, b, offset]);
});
test('BF164 submillisecond precision retained during ordering', () => {
  const first = slot('2026-10-23T09:00:00.000001Z', '2026-10-23T09:30:00Z');
  const second = slot('2026-10-23T09:00:00.000002Z', '2026-10-23T09:30:00Z');
  assert.deepEqual(orderAppointmentSlots([second, first]), [first, second]);
});
test('BF164 tied start is ordered by real endpoint, without changing duration', () => {
  const longer = { ...a, end_at: '2026-10-23T09:45:00Z' };
  assert.deepEqual(orderAppointmentSlots([longer, a]), [a, longer]);
});
test('BF164 [] stays empty; all unavailable stays unavailable, never fabricated availability', () => {
  assert.deepEqual(orderAppointmentSlots([]), []);
  assert.equal(orderAppointmentSlots([b])[0].available, false);
});
test('BF164 selected value must match an available full server interval', () => {
  assert.equal(matchingAppointmentSlot([a, b], { ...a }), a);
  assert.equal(matchingAppointmentSlot([a, b], b), null);
  assert.equal(matchingAppointmentSlot([a], { ...a, end_at: '2026-10-23T09:45:00Z' }), null);
  assert.equal(matchingAppointmentSlot([a], { ...a, available: false }), null);
  assert.equal(matchingAppointmentSlot([], a), null);
  assert.equal(matchingAppointmentSlot([a], null), null);
});
test('BF164 no implicit UTC rewrite to make a value appear server-confirmed', () => {
  assert.equal(matchingAppointmentSlot([a], { ...a, start_at: '2026-10-23T06:00:00-03:00' }), null);
});
for (const row of [
  slot('bad', a.end_at),
  slot(a.start_at, a.start_at),
  slot(a.end_at, a.start_at),
  { ...a, available: null },
])
  test(`BF164 malformed response rejected ${JSON.stringify(row)}`, () =>
    assert.throws(() => orderAppointmentSlots([row])));
test('BF164 explicit business zone changes civil label without rewriting source instants', () => {
  const midnight = slot('2026-10-02T02:30:00Z', '2026-10-02T04:30:00Z');
  const label = appointmentSlotLabel(midnight, 'America/Argentina/Buenos_Aires');
  assert.match(label, /01\/10\/2026.*23:30:00.*02\/10\/2026.*01:30:00/);
  assert.equal(midnight.start_at, '2026-10-02T02:30:00Z');
});
test('BF164 DST fold produces two distinguishable labels and ascending UTC instances', () => {
  const early = slot('2026-11-01T05:00:00Z', '2026-11-01T05:30:00Z');
  const late = slot('2026-11-01T06:00:00Z', '2026-11-01T06:30:00Z');
  assert.deepEqual(orderAppointmentSlots([late, early]), [early, late]);
  const first = appointmentSlotLabel(early, 'America/New_York'),
    second = appointmentSlotLabel(late, 'America/New_York');
  assert.match(first, /01:00:00.*GMT-4/);
  assert.match(second, /01:00:00.*GMT-5/);
  assert.notEqual(first, second);
});
test('BF164 DST gap uses actual returned instants without generating nonexistent civil times', () => {
  const value = slot('2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z');
  assert.match(appointmentSlotLabel(value, 'America/New_York'), /01:30:00.*03:30:00/);
});
test('BF164 no invented future-only filter or current-clock restriction', () => {
  const old = slot('2000-01-01T09:00:00Z', '2000-01-01T09:30:00Z');
  assert.deepEqual(orderAppointmentSlots([old]), [old]);
  assert.equal(matchingAppointmentSlot([old], old), old);
});
test('BF164 invalid timezone is explicit, never a device fallback', () =>
  assert.throws(() => appointmentSlotLabel(a, 'bad/zone')));
