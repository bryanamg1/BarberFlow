const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./helpers/agenda.cjs');
const { agendaViewPeriod } = load('utils/agendaViewPeriod');

test('BF155 day uses the same anchor and exact business-local day boundaries', () => {
  assert.deepEqual(agendaViewPeriod('2026-10-02', 'day', 'America/Argentina/Buenos_Aires').range, {
    from: '2026-10-02T03:00:00.000Z',
    to: '2026-10-03T03:00:00.000Z',
  });
});
test('BF155 week containing Sunday starts on prior Monday and may cross month', () => {
  const p = agendaViewPeriod('2026-10-04', 'week', 'UTC');
  assert.equal(p.days[0].date, '2026-09-28');
  assert.equal(p.days[6].date, '2026-10-04');
});
test('BF155 Monday anchor remains Monday, not a previous week', () => {
  assert.equal(agendaViewPeriod('2026-10-05', 'week', 'UTC').days[0].date, '2026-10-05');
});
test('BF155 month uses anchor month, including leap year and final day', () => {
  const p = agendaViewPeriod('2028-02-29', 'month', 'UTC');
  assert.equal(p.days.length, 29);
  assert.equal(p.range.to, '2028-03-01T00:00:00.000Z');
});
test('BF155 week/year rollover reuses shared civil helpers', () => {
  assert.equal(agendaViewPeriod('2027-01-01', 'week', 'UTC').days[0].date, '2026-12-28');
});
test('BF155 active range preserves DST changes without fixed-day arithmetic', () => {
  assert.deepEqual(agendaViewPeriod('2026-03-08', 'week', 'America/New_York').range, {
    from: '2026-03-02T05:00:00.000Z',
    to: '2026-03-09T04:00:00.000Z',
  });
});
test('BF155 malformed anchor rejected even for month, invalid zone never uses device fallback', () => {
  assert.throws(() => agendaViewPeriod('2026-02-30', 'month', 'UTC'));
  assert.throws(() => agendaViewPeriod('2026-10-02', 'day', 'bad/zone'));
});
