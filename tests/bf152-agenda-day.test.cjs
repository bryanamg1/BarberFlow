const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load, row } = require('./helpers/agenda.cjs');
const { agendaPeriod, shiftCivilDate, groupAgenda, agendaMonth, agendaWeek } =
  load('utils/agendaCalendar');
const day = (date = '2026-10-02', zone = 'UTC') =>
  agendaPeriod(date, shiftCivilDate(date, 1), zone);
const entries = (values, date, zone) => groupAgenda(day(date, zone), values, 'b')[0];

test('BF152 exactly one business civil day, including timezone offset and date rollover', () => {
  const p = day('2026-12-31', 'America/Argentina/Buenos_Aires');
  assert.equal(p.days.length, 1);
  assert.deepEqual(p.range, { from: '2026-12-31T03:00:00.000Z', to: '2027-01-01T03:00:00.000Z' });
});
test('BF152 single-day and empty data remain distinct successful groups', () => {
  assert.deepEqual(entries([]), []);
  assert.equal(entries([row('a', '2026-10-02T10:00:00Z', '2026-10-02T11:00:00Z')]).length, 1);
});
test('BF152 crossing midnight belongs to both relevant days with continuation only on second', () => {
  const a = row('a', '2026-10-01T23:30:00Z', '2026-10-02T00:30:00Z');
  assert.equal(entries([a], '2026-10-01')[0].continued, false);
  assert.equal(entries([a], '2026-10-02')[0].continued, true);
});
test('BF152 exact midnight end excluded; midnight start included', () => {
  const values = [
    row('end', '2026-10-01T22:00:00Z', '2026-10-02T00:00:00Z'),
    row('start', '2026-10-02T00:00:00Z', '2026-10-02T01:00:00Z'),
  ];
  assert.deepEqual(
    entries(values).map((x) => x.appointment.id),
    ['start'],
  );
});
test('BF152 submillisecond end after midnight still intersects', () => {
  assert.equal(
    entries([row('a', '2026-10-01T22:00:00Z', '2026-10-02T00:00:00.000001Z')]).length,
    1,
  );
});
test('BF152 long appointment appears exactly once, retains frozen original and real timestamps', () => {
  const a = Object.freeze(row('a', '2026-09-29T22:00:00Z', '2026-10-06T01:00:00Z'));
  const values = entries([a, a]);
  assert.equal(values.length, 1);
  assert.equal(values[0].appointment, a);
  assert.equal(values[0].continued, true);
});
test('BF152 today start with future end retains its original start presentation', () => {
  const a = row('a', '2026-10-02T23:00:00Z', '2026-10-04T01:00:00Z');
  assert.deepEqual(entries([a]), [{ appointment: a, continued: false }]);
});
test('BF152 ordering is real start then ID, not backend order', () => {
  const values = [
    row('z', '2026-10-02T10:00:00Z', '2026-10-02T11:00:00Z'),
    row('a', '2026-10-02T10:00:00Z', '2026-10-02T11:00:00Z'),
    row('early', '2026-10-01T23:00:00Z', '2026-10-02T01:00:00Z'),
  ];
  assert.deepEqual(
    entries(values).map((x) => x.appointment.id),
    ['early', 'a', 'z'],
  );
});
test('BF152 business day differs from UTC date without rewriting row', () => {
  const a = row('a', '2026-10-02T01:00:00Z', '2026-10-02T02:00:00Z');
  assert.equal(entries([a], '2026-10-01', 'America/Argentina/Buenos_Aires').length, 1);
  assert.deepEqual(entries([a], '2026-10-02', 'America/Argentina/Buenos_Aires'), []);
});
test('BF152 spring and fall DST day ranges are 23 and 25 hours, not fixed UTC offsets', () => {
  for (const [date, from, to] of [
    ['2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
  ])
    assert.deepEqual(day(date, 'America/New_York').range, { from, to });
});
test('BF152 same-day segments match month/week projections exactly', () => {
  const values = [row('a', '2026-10-01T23:00:00Z', '2026-10-03T00:00:00Z')];
  const month = agendaMonth('2026-10', 'UTC'),
    week = agendaWeek('2026-09-28', 'UTC');
  for (const p of [month, week])
    assert.deepEqual(
      groupAgenda(p, values, 'b')[p.days.findIndex((x) => x.date === '2026-10-02')],
      entries(values),
    );
});
test('BF152 invalid civil dates or zone reject without a guessed fallback', () => {
  assert.throws(() => day('2026-02-30'));
  assert.throws(() => day('2026-10-02', 'bad/zone'));
});
test('BF152 unrelated business rows excluded and terminal statuses preserved', () => {
  const a = row('a', '2026-10-02T10:00:00Z', '2026-10-02T11:00:00Z', { status: 'CANCELLED' });
  assert.deepEqual(
    entries([a, { ...a, id: 'foreign', business_id: 'other' }]).map((x) => x.appointment.status),
    ['CANCELLED'],
  );
});
