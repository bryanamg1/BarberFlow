const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./helpers/agenda.cjs');
const { financeRevenueGeometry: geometry } = load('../analytics/utils/financeRevenueGeometry');
const point = (date, service_revenue, product_revenue, total_revenue) => ({
  date,
  service_revenue,
  product_revenue,
  total_revenue,
});
test('BF252 exact daily projection, unchanged strings/order and linear ratios from authoritative maximum', () => {
  const first = Object.freeze(point('2026-10-01', '25.00', '75.00', '100.00'));
  const second = Object.freeze(point('2026-10-02', '100.00', '100.00', '200.00'));
  const result = geometry(Object.freeze([first, second]));
  assert.equal(result.maxTotal, '200.00');
  assert.deepEqual(
    result.points.map((p) => [p.serviceRatio, p.productRatio]),
    [
      [0.125, 0.375],
      [0.5, 0.5],
    ],
  );
  assert.equal(result.points[0].point, first);
  assert.deepEqual(Object.keys(first), [
    'date',
    'service_revenue',
    'product_revenue',
    'total_revenue',
  ]);
  assert.equal(result.points[0].compactDateLabel, '01/10');
  assert.match(result.points[0].dateLabel, /1 de octubre de 2026/);
});
test('BF252 zero day retained; all-zero maximum has no fabricated revenue height', () => {
  const zero = point('2026-10-01', '0.00', '0.00', '0.00'),
    r = geometry([zero]);
  assert.equal(r.maxTotal, '0.00');
  assert.equal(r.points.length, 1);
  assert.equal(r.points[0].serviceRatio, 0);
  assert.equal(r.points[0].productRatio, 0);
  assert.equal(
    geometry([zero, point('2026-10-02', '1.00', '0.00', '1.00')]).points[0].serviceRatio,
    0,
  );
});
test('BF252 success empty does not manufacture dates', () =>
  assert.deepEqual(geometry([]), { maxTotal: '0.00', points: [] }));
test('BF252 service-only/product-only days map separate stack segments', () => {
  const r = geometry([
    point('2026-10-01', '2.00', '0.00', '2.00'),
    point('2026-10-02', '0.00', '1.00', '1.00'),
  ]);
  assert.deepEqual(
    r.points.map((p) => [p.serviceRatio, p.productRatio]),
    [
      [1, 0],
      [0, 0.5],
    ],
  );
});
test('BF252 amounts beyond Number.MAX_VALUE retain exact data and finite proportional geometry', () => {
  const total = '1' + '0'.repeat(400) + '.00',
    service = '25' + '0'.repeat(398) + '.00',
    product = '75' + '0'.repeat(398) + '.00';
  assert.equal(Number.isFinite(Number(total)), false);
  const r = geometry([point('2026-10-01', service, product, total)]);
  assert.equal(r.maxTotal, total);
  assert.equal(r.points[0].point.service_revenue, service);
  assert.equal(r.points[0].serviceRatio, 0.25);
  assert.equal(r.points[0].productRatio, 0.75);
});
test('BF252 subpixel positive revenue has no invented minimum while exact amount remains', () => {
  const r = geometry([
    point('2026-10-01', '0.01', '0.00', '0.01'),
    point('2026-10-02', '9999999999.99', '0.00', '9999999999.99'),
  ]);
  assert.equal(r.points[0].point.total_revenue, '0.01');
  assert.equal(r.points[0].serviceRatio, 0);
});
for (const [name, rows] of [
  ['invalid civil day', [point('2026-02-30', '1.00', '0.00', '1.00')]],
  ['year zero', [point('0000-01-01', '1.00', '0.00', '1.00')]],
  ['timestamp instead of civil date', [point('2026-10-01T00:00:00Z', '1.00', '0.00', '1.00')]],
  ['negative money', [point('2026-10-01', '-1.00', '2.00', '1.00')]],
  ['NaN', [point('2026-10-01', 'NaN', '0.00', '0.00')]],
  ['missing total', [point('2026-10-01', '1.00', '0.00', undefined)]],
  ['fraction precision', [point('2026-10-01', '1.001', '0.00', '1.00')]],
  ['number instead of text', [point('2026-10-01', 1, '0.00', '1.00')]],
  ['inconsistent total', [point('2026-10-01', '1.00', '2.00', '4.00')]],
  [
    'duplicate date',
    [point('2026-10-01', '1.00', '0.00', '1.00'), point('2026-10-01', '1.00', '0.00', '1.00')],
  ],
  [
    'producer order violation',
    [point('2026-10-02', '1.00', '0.00', '1.00'), point('2026-10-01', '1.00', '0.00', '1.00')],
  ],
  ['absent collection', undefined],
])
  test('BF252 ' + name + ' is unavailable, never zero/fabricated/sorted', () =>
    assert.equal(geometry(rows), null),
  );
test('BF252 complete ALL_TIME has no day cap or sampling', () => {
  const rows = Array.from({ length: 730 }, (_, i) =>
    point(new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), '1.00', '2.00', '3.00'),
  );
  const r = geometry(rows);
  assert.equal(r.points.length, 730);
  assert.deepEqual(
    r.points.map((p) => p.point.date),
    rows.map((p) => p.date),
  );
});
test('BF252 civil labels remain independent of host timezone across DST', () => {
  const prior = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Honolulu';
    const a = geometry([point('2026-03-08', '1.00', '0.00', '1.00')]);
    process.env.TZ = 'Asia/Tokyo';
    const b = geometry([point('2026-03-08', '1.00', '0.00', '1.00')]);
    assert.equal(a.points[0].dateLabel, b.points[0].dateLabel);
    assert.equal(b.points[0].compactDateLabel, '08/03');
  } finally {
    if (prior === undefined) delete process.env.TZ;
    else process.env.TZ = prior;
  }
});
