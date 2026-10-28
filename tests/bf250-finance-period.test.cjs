const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./helpers/agenda.cjs');
const { FINANCE_PERIODS, DEFAULT_FINANCE_PERIOD, financePeriodBounds } = load(
  '../analytics/utils/financePeriod',
);
test('BF250 exact five periods and TODAY default, no CUSTOM', () => {
  assert.deepEqual(FINANCE_PERIODS, ['TODAY', 'WEEK', 'MONTH', 'YEAR', 'ALL_TIME']);
  assert.equal(DEFAULT_FINANCE_PERIOD, 'TODAY');
});
for (const [period, timezone, instant, from, to] of [
  [
    'TODAY',
    'America/Argentina/Buenos_Aires',
    '2027-01-01T01:00Z',
    '2026-12-31T03:00:00.000Z',
    '2027-01-01T03:00:00.000Z',
  ],
  [
    'TODAY',
    'Asia/Tokyo',
    '2027-01-01T01:00Z',
    '2026-12-31T15:00:00.000Z',
    '2027-01-01T15:00:00.000Z',
  ],
  ['WEEK', 'UTC', '2026-10-25T23:30Z', '2026-10-19T00:00:00.000Z', '2026-10-26T00:00:00.000Z'],
  ['WEEK', 'UTC', '2026-10-26T00:00Z', '2026-10-26T00:00:00.000Z', '2026-11-02T00:00:00.000Z'],
  [
    'MONTH',
    'America/Argentina/Buenos_Aires',
    '2027-01-01T01:00Z',
    '2026-12-01T03:00:00.000Z',
    '2027-01-01T03:00:00.000Z',
  ],
  ['MONTH', 'UTC', '2028-02-29T12:00Z', '2028-02-01T00:00:00.000Z', '2028-03-01T00:00:00.000Z'],
  [
    'YEAR',
    'America/Argentina/Buenos_Aires',
    '2027-01-01T01:00Z',
    '2026-01-01T03:00:00.000Z',
    '2027-01-01T03:00:00.000Z',
  ],
  [
    'TODAY',
    'America/New_York',
    '2026-03-08T12:00Z',
    '2026-03-08T05:00:00.000Z',
    '2026-03-09T04:00:00.000Z',
  ],
  [
    'TODAY',
    'America/New_York',
    '2026-11-01T12:00Z',
    '2026-11-01T04:00:00.000Z',
    '2026-11-02T05:00:00.000Z',
  ],
  [
    'TODAY',
    'America/Sao_Paulo',
    '2018-11-04T12:00Z',
    '2018-11-04T03:00:00.000Z',
    '2018-11-05T02:00:00.000Z',
  ],
  [
    'WEEK',
    'America/New_York',
    '2026-03-08T12:00Z',
    '2026-03-02T05:00:00.000Z',
    '2026-03-09T04:00:00.000Z',
  ],
  [
    'MONTH',
    'America/New_York',
    '2026-03-08T12:00Z',
    '2026-03-01T05:00:00.000Z',
    '2026-04-01T04:00:00.000Z',
  ],
])
  test(`BF250 ${period} ${timezone} ${instant}`, () =>
    assert.deepEqual(financePeriodBounds(period, timezone, Date.parse(instant)), { from, to }));
test('BF250 ALL_TIME has no fabricated boundaries', () =>
  assert.deepEqual(financePeriodBounds('ALL_TIME', 'UTC', 0), { from: null, to: null }));
test('BF250 business calendar ignores host timezone', () => {
  const original = process.env.TZ;
  try {
    let expected;
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      const bounds = financePeriodBounds(
        'WEEK',
        'America/New_York',
        Date.parse('2026-11-01T12:00Z'),
      );
      if (expected) assert.deepEqual(bounds, expected);
      expected = bounds;
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
test('BF250 invalid clock, zone or period never silently falls back', () => {
  assert.throws(() => financePeriodBounds('TODAY', 'UTC', NaN));
  assert.throws(() => financePeriodBounds('TODAY', 'invalid/timezone', 0));
  assert.throws(() => financePeriodBounds('CUSTOM', 'UTC', 0));
});
