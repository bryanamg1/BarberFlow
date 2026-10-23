const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load, row } = require('./helpers/agenda.cjs');
const { agendaWeek, agendaMonth, groupAgenda } = load('utils/agendaCalendar');
const week = () => agendaWeek('2026-09-28', 'UTC');
const rows = (period, values) =>
  groupAgenda(period, values, 'b').flatMap((group, i) =>
    group.map((s) => [period.days[i].date, s.appointment.id, s.continued]),
  );
test('BF151 Monday inclusive to next Monday exclusive contains exactly seven civil days across months', () => {
  const p = week();
  assert.equal(p.days.length, 7);
  assert.equal(p.days[0].date, '2026-09-28');
  assert.equal(p.days[6].date, '2026-10-04');
  assert.deepEqual(p.range, { from: '2026-09-28T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' });
});
test('BF151 week crosses a year without resetting, duplicating or omitting civil dates', () => {
  const p = agendaWeek('2026-12-28', 'UTC');
  assert.equal(p.days[6].date, '2027-01-03');
  assert.equal(p.range.to, '2027-01-04T00:00:00.000Z');
});
test('BF151 non-Monday/invalid start is rejected instead of guessing a week preference', () => {
  for (const start of ['2026-09-29', '2026-09-27', 'invalid'])
    assert.throws(() => agendaWeek(start, 'UTC'));
});
test('BF151 single-day appointment appears once', () => {
  assert.deepEqual(rows(week(), [row('a', '2026-09-28T10:00:00Z', '2026-09-28T10:30:00Z')]), [
    ['2026-09-28', 'a', false],
  ]);
});
test('BF151 cross-midnight is represented twice with continuation on the second day', () => {
  assert.deepEqual(rows(week(), [row('a', '2026-09-28T23:30:00Z', '2026-09-29T00:30:00Z')]), [
    ['2026-09-28', 'a', false],
    ['2026-09-29', 'a', true],
  ]);
});
test('BF151 before-week start is still visible Monday as continuation', () => {
  assert.deepEqual(rows(week(), [row('a', '2026-09-27T23:30:00Z', '2026-09-28T00:30:00Z')]), [
    ['2026-09-28', 'a', true],
  ]);
});
test('BF151 after-week end preserves the Sunday representation without adding an eighth day', () => {
  assert.deepEqual(rows(week(), [row('a', '2026-10-04T23:30:00Z', '2026-10-05T00:30:00Z')]), [
    ['2026-10-04', 'a', false],
  ]);
});
test('BF151 exact-midnight end excludes the following day including the next week', () => {
  assert.deepEqual(rows(week(), [row('a', '2026-10-04T23:30:00Z', '2026-10-05T00:00:00Z')]), [
    ['2026-10-04', 'a', false],
  ]);
  assert.deepEqual(
    rows(agendaWeek('2026-10-05', 'UTC'), [
      row('a', '2026-10-04T23:30:00Z', '2026-10-05T00:00:00Z'),
    ]),
    [],
  );
});
test('BF151 long historical interval appears once per intersected visible day, original row unchanged', () => {
  const a = Object.freeze(row('a', '2026-09-27T23:30:00Z', '2026-10-06T00:30:00Z'));
  const groups = groupAgenda(week(), [a, a], 'b');
  assert.equal(groups.length, 7);
  assert(groups.every((g) => g.length === 1 && g[0].continued && g[0].appointment === a));
});
test('BF151 exact instant then ID sorting is stable independently of backend order', () => {
  const values = [
    row('z', '2026-09-28T10:00:00.000002Z', '2026-09-28T11:00:00Z'),
    row('b', '2026-09-28T10:00:00.000001Z', '2026-09-28T11:00:00Z'),
    row('a', '2026-09-28T10:00:00.000001Z', '2026-09-28T11:00:00Z'),
  ];
  assert.deepEqual(
    groupAgenda(week(), values, 'b')[0].map((s) => s.appointment.id),
    ['a', 'b', 'z'],
  );
});
test('BF151 week range uses business zone across DST, not seven fixed 24-hour periods', () => {
  assert.deepEqual(agendaWeek('2026-03-02', 'America/New_York').range, {
    from: '2026-03-02T05:00:00.000Z',
    to: '2026-03-09T04:00:00.000Z',
  });
});
test('BF151 UTC Monday early morning still belongs to prior business Sunday and is outside that week', () => {
  const p = agendaWeek('2026-10-05', 'America/Argentina/Buenos_Aires');
  assert.deepEqual(rows(p, [row('a', '2026-10-05T01:00:00Z', '2026-10-05T02:00:00Z')]), []);
});
test('BF151 repeated DST hour keeps both real instants ordered on the same civil day', () => {
  const p = agendaWeek('2026-10-26', 'America/New_York');
  assert.deepEqual(
    rows(p, [
      row('late', '2026-11-01T06:30:00Z', '2026-11-01T06:45:00Z'),
      row('early', '2026-11-01T05:30:00Z', '2026-11-01T05:45:00Z'),
    ]),
    [
      ['2026-11-01', 'early', false],
      ['2026-11-01', 'late', false],
    ],
  );
});
test('BF151 month and week share identical D23 segments for the same visible dates', () => {
  const a = row('a', '2026-10-05T23:30:00Z', '2026-10-08T00:30:00Z');
  assert.deepEqual(
    rows(agendaWeek('2026-10-05', 'UTC'), [a]),
    rows(agendaMonth('2026-10', 'UTC'), [a]),
  );
});
