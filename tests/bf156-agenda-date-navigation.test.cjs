const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./helpers/agenda.cjs');
const { shiftAgendaDate } = load('utils/agendaDateNavigation');
const { agendaViewPeriod } = load('utils/agendaViewPeriod');
const { businessCivilDate } = load('utils/agendaCalendar');
for (const [date, view, direction, expected] of [
  ['2026-10-23', 'day', -1, '2026-10-22'],
  ['2026-10-23', 'day', 1, '2026-10-24'],
  ['2026-10-23', 'week', -1, '2026-10-16'],
  ['2026-10-23', 'week', 1, '2026-10-30'],
  ['2026-10-23', 'month', -1, '2026-09-23'],
  ['2026-10-23', 'month', 1, '2026-11-23'],
  ['2027-01-01', 'day', -1, '2026-12-31'],
  ['2026-12-31', 'day', 1, '2027-01-01'],
  ['2027-01-31', 'month', -1, '2026-12-31'],
  ['2026-12-31', 'month', 1, '2027-01-31'],
  ['2026-01-31', 'month', 1, '2026-02-28'],
  ['2028-01-31', 'month', 1, '2028-02-29'],
  ['2028-03-31', 'month', -1, '2028-02-29'],
  ['2026-05-31', 'month', -1, '2026-04-30'],
  ['2028-02-29', 'month', 1, '2028-03-29'],
  ['2026-03-08', 'day', 1, '2026-03-09'],
])
  test(`BF156 ${date} ${view} ${direction} → ${expected}`, () =>
    assert.equal(shiftAgendaDate(date, view, direction), expected));
test('BF156 civil navigation preserves actual DST business bounds, not UTC24h', () => {
  const date = shiftAgendaDate('2026-03-07', 'day', 1);
  const p = agendaViewPeriod(date, 'day', 'America/New_York');
  assert.deepEqual(p.range, { from: '2026-03-08T05:00:00.000Z', to: '2026-03-09T04:00:00.000Z' });
  assert.equal(
    agendaViewPeriod(shiftAgendaDate(date, 'week', 1), 'week', 'America/New_York').days[0].date,
    '2026-03-09',
  );
});
test('BF156 Today uses requested business zone even across civil/year boundary', () => {
  assert.equal(
    businessCivilDate(Date.parse('2027-01-01T01:00:00Z'), 'America/Argentina/Buenos_Aires'),
    '2026-12-31',
  );
  assert.equal(businessCivilDate(Date.parse('2027-01-01T01:00:00Z'), 'Asia/Tokyo'), '2027-01-01');
});
test('BF156 malformed or out-of-domain date has no silent normalization', () => {
  assert.throws(() => shiftAgendaDate('2026-02-30', 'month', 1));
  assert.throws(() => shiftAgendaDate('0001-01-01', 'month', -1));
  assert.throws(() => shiftAgendaDate('9999-12-31', 'day', 1));
});
