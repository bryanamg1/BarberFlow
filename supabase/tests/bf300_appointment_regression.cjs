// Dedicated LOCAL PostgreSQL regression, outside the DB-independent unit glob.
// Existing functions only. Committed race fixtures are removed by exact synthetic IDs.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { query, Session, blocked } = require('./helpers/local-postgres.cjs');
const { appointmentFixture } = require('./helpers/appointment-fixture.cjs');

const create = (f, id, start = '2026-10-14T10:00Z', extra = '') =>
  `public.create_appointment_with_services('${id}','${f.business}','${f.client}','${f.barberMember}','${start}','[{"service_id":"${f.service}","quantity":1}]'${extra})`;
const move = (f, id, start = '2026-10-14T10:00Z') =>
  `public.reschedule_appointment('${f.business}','${id}','${f.barberMember}','${start}')`;
const owner = (f, sql, user = f.owner) =>
  query(`BEGIN;${f.identity(user)}SET LOCAL ROLE authenticated;${sql}COMMIT;`);
const json = (output) =>
  JSON.parse(
    output
      .split('\n')
      .find((l) => l.startsWith('JSON:'))
      .slice(5),
  );
const history = (f) =>
  JSON.parse(
    query(
      `SELECT json_build_object('appointment',(SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}'),'items',(SELECT json_agg(s ORDER BY s.id) FROM public.appointment_services s WHERE appointment_id='${f.appointment}'));`,
    ),
  );
function cleanup(f) {
  const bs = `'${f.business}','${f.foreignBusiness}'`,
    us = `'${f.owner}','${f.barber}','${f.other}'`;
  query(`BEGIN;
    DELETE FROM public.appointment_services WHERE appointment_id IN(SELECT id FROM public.appointments WHERE business_id IN(${bs}));
    DELETE FROM public.appointments WHERE business_id IN(${bs});
    DELETE FROM public.services WHERE business_id IN(${bs}); DELETE FROM public.clients WHERE business_id IN(${bs});
    DELETE FROM public.business_hours WHERE business_id IN(${bs}); DELETE FROM public.business_settings WHERE business_id IN(${bs});
    DELETE FROM public.business_members WHERE business_id IN(${bs}); DELETE FROM public.businesses WHERE id IN(${bs});
    DELETE FROM public.profiles WHERE id IN(${us}); DELETE FROM auth.users WHERE id IN(${us}); COMMIT;`);
  assert.equal(query(`SELECT count(*) FROM public.businesses WHERE id IN(${bs});`), '0');
}
async function committed(run) {
  const f = appointmentFixture(),
    sessions = [];
  query(`BEGIN;${f.sql}COMMIT;`);
  const connection = async () => {
    const s = new Session();
    sessions.push(s);
    await s.init();
    await s.sql("SET application_name='bf300-appointment-regression';");
    return s;
  };
  try {
    await run(f, connection);
  } finally {
    await Promise.all(sessions.map((s) => s.close()));
    cleanup(f);
  }
}
function rolled(run) {
  const f = appointmentFixture();
  return query(`BEGIN;${f.sql}${run(f)}ROLLBACK;`);
}

test('BF300 real race: available read, competing create, waiting create fails after commit with no partial row/items', async () =>
  committed(async (f, connect) => {
    const a = await connect(),
      b = await connect(),
      loser = randomUUID(),
      winner = randomUUID();
    await a.sql(`BEGIN;${f.identity()}SET LOCAL ROLE authenticated;`);
    assert.equal(
      await a.sql(
        `SELECT available FROM public.get_availability('${f.business}','${f.barberMember}','2026-10-14',30) WHERE start_at='2026-10-14T10:00Z';`,
      ),
      't',
    );
    await b.sql(`BEGIN;${f.identity()}SET LOCAL ROLE authenticated;SELECT ${create(f, winner)};`);
    const wait = a.sql(f.expect(`PERFORM ${create(f, loser)}`, 'PT409'));
    await blocked(a, b);
    await b.sql('COMMIT;');
    await wait;
    await a.sql('COMMIT;');
    assert.equal(query(`SELECT count(*) FROM public.appointments WHERE id='${loser}';`), '0');
    assert.equal(
      query(`SELECT count(*) FROM public.appointment_services WHERE appointment_id='${loser}';`),
      '0',
    );
    assert.equal(
      query(`SELECT count(*) FROM public.appointment_services WHERE appointment_id='${winner}';`),
      '1',
    );
  }));

test('BF300 real race: assigned BARBER reschedule loses to concurrent create; original timestamps and snapshots unchanged', async () =>
  committed(async (f, connect) => {
    const before = history(f),
      a = await connect(),
      b = await connect();
    await a.sql(`BEGIN;${f.identity(f.barber)}SET LOCAL ROLE authenticated;`);
    assert.equal(
      await a.sql(
        `SELECT available FROM public.get_availability('${f.business}','${f.barberMember}','2026-10-14',30,'${f.appointment}') WHERE start_at='2026-10-14T10:00Z';`,
      ),
      't',
    );
    await b.sql(
      `BEGIN;${f.identity()}SET LOCAL ROLE authenticated;SELECT ${create(f, randomUUID())};`,
    );
    const wait = a.sql(f.expect(`PERFORM ${move(f, f.appointment)}`, 'PT409'));
    await blocked(a, b);
    await b.sql('COMMIT;');
    await wait;
    await a.sql('COMMIT;');
    assert.deepEqual(history(f), before);
  }));

test('BF300 cancellation and waiting create share actual calendar lock; released interval is reusable without deleting history', async () =>
  committed(async (f, connect) => {
    const a = await connect(),
      b = await connect(),
      id = randomUUID(),
      before = history(f).items;
    await b.sql(
      `BEGIN;${f.identity()}SET LOCAL ROLE authenticated;SELECT ${f.status('CANCELLED')};`,
    );
    await a.sql(`BEGIN;${f.identity()}SET LOCAL ROLE authenticated;`);
    const wait = a.sql(`SELECT ${create(f, id, '2026-10-14T09:00Z')};`);
    await blocked(a, b);
    await b.sql('COMMIT;');
    await wait;
    await a.sql('COMMIT;');
    assert.equal(history(f).appointment.status, 'CANCELLED');
    assert.deepEqual(history(f).items, before);
    assert.equal(query(`SELECT count(*) FROM public.appointments WHERE id='${id}';`), '1');
  }));

test('BF300 no-show releases a real locked interval for waiting reschedule; both histories remain intact', async () =>
  committed(async (f, connect) => {
    const id = randomUUID();
    owner(f, `SELECT ${create(f, id, '2026-10-14T11:00Z')};`);
    const items = query(
      `SELECT json_agg(s ORDER BY s.id) FROM public.appointment_services s WHERE appointment_id='${id}';`,
    );
    const a = await connect(),
      b = await connect();
    await b.sql(`BEGIN;${f.identity()}SET LOCAL ROLE authenticated;SELECT ${f.status('NO_SHOW')};`);
    await a.sql(`BEGIN;${f.identity()}SET LOCAL ROLE authenticated;`);
    const wait = a.sql(`SELECT ${move(f, id, '2026-10-14T09:00Z')};`);
    await blocked(a, b);
    await b.sql('COMMIT;');
    await wait;
    await a.sql('COMMIT;');
    assert.equal(history(f).appointment.status, 'NO_SHOW');
    assert.equal(
      query(`SELECT start_at='2026-10-14T09:00Z' FROM public.appointments WHERE id='${id}';`),
      't',
    );
    assert.equal(
      query(
        `SELECT json_agg(s ORDER BY s.id) FROM public.appointment_services s WHERE appointment_id='${id}';`,
      ),
      items,
    );
  }));

test('BF300 exact request replay returns persisted original after catalog changes, no second appointment/items; inactive replay denied', async () =>
  committed(async (f) => {
    const id = randomUUID(),
      first = json(owner(f, `SELECT 'JSON:'||${create(f, id)}::text;`));
    query(
      `UPDATE public.services SET name='Changed',price=999,duration_minutes=60,is_active=false WHERE id='${f.service}';`,
    );
    const replay = json(owner(f, `SELECT 'JSON:'||${create(f, id)}::text;`));
    assert.deepEqual(replay, first);
    assert.equal(
      query(`SELECT count(*) FROM public.appointment_services WHERE appointment_id='${id}';`),
      '1',
    );
    query(`UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`);
    owner(f, f.expect(`PERFORM ${create(f, id)}`, '42501'));
  }));

test('BF300 actual zero-buffer adjacency and exact closing fit; overrun fails without partial appointment', () => {
  const result = rolled(
    (f) => `${f.identity()}SET LOCAL ROLE authenticated;
    ${f.expect(`PERFORM ${create(f, randomUUID(), '2026-10-14T17:30Z', ',60')}`, 'PT422')}
    SELECT 'JSON:'||${create(f, randomUUID(), '2026-10-14T09:30Z')}::text;
    SELECT 'JSON:'||${create(f, randomUUID(), '2026-10-14T17:30Z')}::text;`,
  );
  const rows = result
    .split('\n')
    .filter((l) => l.startsWith('JSON:'))
    .map((l) => JSON.parse(l.slice(5)));
  assert.equal(rows.length, 2);
  assert.equal(Date.parse(rows[0].end_at), Date.parse('2026-10-14T10:00Z'));
  assert.equal(Date.parse(rows[1].end_at), Date.parse('2026-10-14T18:00Z'));
});

test('BF300 posterior buffer blocks adjacency and removes candidates that cannot finish before closing', () => {
  const result = rolled(
    (
      f,
    ) => `UPDATE public.business_settings SET default_service_buffer_minutes=10 WHERE business_id='${f.business}';
    ${f.identity()}SET LOCAL ROLE authenticated;
    SELECT 'JSON:'||json_build_object('adjacent',(SELECT available FROM public.get_availability('${f.business}','${f.barberMember}','2026-10-14',30) WHERE start_at='2026-10-14T09:30Z'),
      'overrun',(SELECT count(*) FROM public.get_availability('${f.business}','${f.barberMember}','2026-10-14',30) WHERE start_at='2026-10-14T17:30Z'))::text;`,
  );
  assert.deepEqual(json(result), { adjacent: false, overrun: 0 });
});

test('BF300 business-zone DST gap omitted and both fold instants retained; no device-time generation', () => {
  const result = rolled(
    (f) => `UPDATE public.businesses SET timezone='America/New_York' WHERE id='${f.business}';
    INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time) VALUES('${f.business}',0,'01:00','04:00');
    ${f.identity()}SET LOCAL ROLE authenticated;
    SELECT 'JSON:'||json_build_object('gap',(SELECT array_agg(start_at ORDER BY start_at) FROM public.get_availability('${f.business}','${f.barberMember}','2026-03-08',30)),
      'fold',(SELECT array_agg(start_at ORDER BY start_at) FROM public.get_availability('${f.business}','${f.barberMember}','2026-11-01',30)))::text;`,
  );
  const data = json(result);
  assert.deepEqual(
    data.gap.map((x) => new Date(x).toISOString()),
    [
      '2026-03-08T06:00:00.000Z',
      '2026-03-08T06:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T07:30:00.000Z',
    ],
  );
  assert.equal(data.fold.length, 8);
  assert(data.fold.some((x) => Date.parse(x) === Date.parse('2026-11-01T05:30Z')));
  assert(data.fold.some((x) => Date.parse(x) === Date.parse('2026-11-01T06:30Z')));
});

test('BF300 normal roles: direct DML, foreign/missing business, foreign professional and reassignment are denied without mutations', () => {
  const result = rolled(
    (f) => `${f.identity()}SET LOCAL ROLE authenticated;
    ${f.expect(`UPDATE public.appointments SET notes='forbidden' WHERE id='${f.appointment}'`, '42501')}
    ${f.expect(`DELETE FROM public.appointments WHERE id='${f.appointment}'`, '42501')}
    ${f.expect(`INSERT INTO public.appointments(business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES('${f.business}','${f.client}','${f.barberMember}','2026-10-14T10:00Z','2026-10-14T10:30Z','${f.owner}')`, '42501')}
    ${f.expect(`PERFORM public.get_availability('${f.foreignBusiness}','${f.barberMember}','2026-10-14',30)`, '42501')}
    ${f.expect(`PERFORM public.get_availability('${randomUUID()}','${f.barberMember}','2026-10-14',30)`, '42501')}
    RESET ROLE;${f.identity(f.barber)}SET LOCAL ROLE authenticated;
    ${f.expect(`PERFORM public.get_availability('${f.business}','${f.ownerMember}','2026-10-14',30)`, '42501')}
    ${f.expect(`PERFORM public.reschedule_appointment('${f.business}','${f.appointment}','${f.ownerMember}','2026-10-14T10:00Z')`, '42501')}
    RESET ROLE;SET LOCAL ROLE anon;${f.expect(`PERFORM ${move(f, f.appointment)}`, '42501')}
    RESET ROLE;SELECT 'JSON:'||json_build_object('status',status,'notes',notes)::text FROM public.appointments WHERE id='${f.appointment}';`,
  );
  assert.deepEqual(json(result), { status: 'PENDING', notes: null });
});
