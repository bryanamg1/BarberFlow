/* global __dirname */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const { load, row } = require('./helpers/agenda.cjs');
const { agendaMonth, groupAgenda, businessCivilDate, shiftCivilDate, agendaAppointmentRange } =
  load('utils/agendaCalendar');
const period = () => agendaMonth('2026-10', 'UTC');
const represented = (p, rows) =>
  groupAgenda(p, rows, 'b').flatMap((group, index) =>
    group.map((s) => [p.days[index].date, s.appointment.id, s.continued]),
  );

for (const [month, length, leading] of [
  ['2024-02', 29, 3],
  ['2025-02', 28, 5],
  ['2026-10', 31, 3],
  ['2026-12', 31, 1],
  ['0001-01', 31, 0],
]) {
  test(`BF150 civil month ${month} has exact dates and Monday alignment`, () => {
    const p = agendaMonth(month, 'UTC');
    assert.equal(p.days.length, length);
    assert.equal(p.leading, leading);
    assert.equal(p.days[0].date, month + '-01');
    assert.equal(p.days.at(-1).date, month + '-' + length);
  });
}
test('BF150 December range ends at next January, civil month only with no padding-day read', () => {
  assert.deepEqual(agendaMonth('2026-12', 'UTC').range, {
    from: '2026-12-01T00:00:00.000Z',
    to: '2027-01-01T00:00:00.000Z',
  });
});
test('BF150 empty month has one empty collection for every civil day', () => {
  const p = period();
  assert.equal(groupAgenda(p, [], 'b').length, 31);
  assert(groupAgenda(p, [], 'b').every((d) => d.length === 0));
});
test('BF150 single day, midnight start and exact midnight end obey half-open intervals', () => {
  assert.deepEqual(
    represented(period(), [row('a', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z')]),
    [['2026-10-01', 'a', false]],
  );
});
test('BF150 crossing midnight repeats original reference only on intersected days, with continuation', () => {
  const a = Object.freeze(row('a', '2026-10-01T23:30:00Z', '2026-10-02T00:30:00Z'));
  const original = JSON.stringify(a),
    groups = groupAgenda(period(), [a], 'b');
  assert.equal(groups[0][0].appointment, a);
  assert.equal(groups[1][0].appointment, a);
  assert.deepEqual(represented(period(), [a]), [
    ['2026-10-01', 'a', false],
    ['2026-10-02', 'a', true],
  ]);
  assert.equal(JSON.stringify(a), original);
});
test('BF150 more than two days and clipping at both month edges preserve real intervals', () => {
  const a = row('a', '2026-09-30T23:30:00Z', '2026-10-03T00:00:00Z');
  const z = row('z', '2026-10-31T23:30:00Z', '2026-11-02T00:00:00Z');
  assert.deepEqual(represented(period(), [a, z]), [
    ['2026-10-01', 'a', true],
    ['2026-10-02', 'a', true],
    ['2026-10-31', 'z', false],
  ]);
});
test('BF150 outside and touching intervals never appear', () => {
  assert.deepEqual(
    represented(period(), [
      row('a', '2026-09-30T23:30:00Z', '2026-10-01T00:00:00Z'),
      row('b', '2026-11-01T00:00:00Z', '2026-11-01T01:00:00Z'),
    ]),
    [],
  );
});
test('BF150 business timezone, not device day, assigns UTC early-morning appointments to prior day', () => {
  const p = agendaMonth('2026-10', 'America/Argentina/Buenos_Aires');
  assert.deepEqual(represented(p, [row('a', '2026-10-02T01:30:00Z', '2026-10-02T02:00:00Z')]), [
    ['2026-10-01', 'a', false],
  ]);
  assert.equal(
    businessCivilDate(Date.parse('2026-10-02T01:00:00Z'), 'America/Argentina/Buenos_Aires'),
    '2026-10-01',
  );
});
for (const [month, day, hours, from, to] of [
  ['2026-03', 8, 23, '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
  ['2026-11', 1, 25, '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
])
  test(`BF150 New York DST ${month} civil day lasts ${hours} real hours`, () => {
    const d = agendaMonth(month, 'America/New_York').days[day - 1];
    assert.equal(d.from, from);
    assert.equal(d.to, to);
    assert.equal(Date.parse(d.to) - Date.parse(d.from), hours * 3600000);
  });
test('BF150 a skipped civil day has no phantom representation', () => {
  const p = agendaMonth('2011-12', 'Pacific/Apia'),
    d = p.days[29];
  assert.equal(d.from, d.to);
  const a = row('a', '2011-12-29T23:00:00Z', '2011-12-31T00:00:00Z');
  assert.equal(groupAgenda(p, [a], 'b')[29].length, 0);
});
test('BF150 fractional instants just past midnight are not truncated into an exact-midnight end', () => {
  assert.deepEqual(
    represented(period(), [row('a', '2026-10-01T23:59:59.999999Z', '2026-10-02T00:00:00.000001Z')]),
    [
      ['2026-10-01', 'a', false],
      ['2026-10-02', 'a', true],
    ],
  );
});
test('BF150 all statuses are retained; stable start/id order and one entry per ID per day', () => {
  const statuses = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
  const rows = statuses
    .map((status, i) => row(String(i), '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', { status }))
    .reverse();
  const groups = groupAgenda(period(), [...rows, rows[0]], 'b');
  assert.deepEqual(
    groups[0].map((s) => s.appointment.status),
    statuses,
  );
});
test('BF150 tenant filter never displays another business row', () => {
  assert.deepEqual(
    represented(period(), [
      row('x', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', { business_id: 'foreign' }),
    ]),
    [],
  );
});
test('BF150 invalid month/timezone are controlled failures without guessed timezone', () => {
  for (const m of ['2026-13', '2026-2', '0000-01', 'bad'])
    assert.throws(() => agendaMonth(m, 'UTC'));
  assert.throws(() => agendaMonth('2026-10', 'bad/zone'));
});
test('BF150 civil date arithmetic crosses years/leap days without device timezone conversion', () => {
  assert.equal(shiftCivilDate('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftCivilDate('2026-12-31', 1), '2027-01-01');
});
test('BF150 real start/end presentation uses business timezone and keeps historical timestamps', () => {
  const a = row('a', '2026-10-02T01:30:00Z', '2026-10-02T03:30:00Z');
  const text = agendaAppointmentRange(a, 'America/Argentina/Buenos_Aires');
  assert(text.includes('22:30'));
  assert(text.includes('00:30'));
  assert.equal(a.start_at, '2026-10-02T01:30:00Z');
});

test('BF150 device timezone UTC or Tokyo cannot change business grouping', () => {
  const script = `const {load,row}=require('./tests/helpers/agenda.cjs');const h=load('utils/agendaCalendar');const p=h.agendaMonth('2026-10','America/Argentina/Buenos_Aires');const groups=h.groupAgenda(p,[row('a','2026-10-02T01:00:00Z','2026-10-02T02:00:00Z')],'b');process.stdout.write(JSON.stringify(groups.flatMap((g,i)=>g.map(s=>[p.days[i].date,s.appointment.id]))));`;
  const run = (TZ) =>
    JSON.parse(
      execFileSync(process.execPath, ['-e', script], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, TZ },
        encoding: 'utf8',
      }),
    );
  assert.deepEqual(run('UTC'), [['2026-10-01', 'a']]);
  assert.deepEqual(run('Asia/Tokyo'), run('UTC'));
});

test('BF150 a positive sub-millisecond appointment retains its single-day representation', () => {
  assert.deepEqual(
    represented(period(), [row('a', '2026-10-02T00:00:00.000001Z', '2026-10-02T00:00:00.000002Z')]),
    [['2026-10-02', 'a', false]],
  );
});
