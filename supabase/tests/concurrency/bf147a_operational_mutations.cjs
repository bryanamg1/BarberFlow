const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { query, Session, blocked } = require('../helpers/local-postgres.cjs');
const { appointmentFixture } = require('../helpers/appointment-fixture.cjs');
const sessions = [];
let count = 0;
async function pair(name, first, second, expected, from = 'PENDING') {
  const f = appointmentFixture();
  query(
    `BEGIN;${f.sql} UPDATE public.appointments SET status='${from}' WHERE id='${f.appointment}';COMMIT;`,
  );
  const a = await new Session().init(),
    b = await new Session().init();
  sessions.push(a, b);
  await a.sql(`BEGIN;${f.identity()} SET LOCAL ROLE authenticated;${first(f)}`);
  await b.sql(`BEGIN;${f.identity()} SET LOCAL ROLE authenticated;`);
  const wait = b.sql(second(f));
  await blocked(b, a);
  await a.sql('COMMIT;');
  await wait;
  await b.sql('COMMIT;');
  assert.equal(
    query(`SELECT status FROM public.appointments WHERE id='${f.appointment}';`),
    expected,
  );
  console.log(`PASS ${++count} ${name}`);
}
(async () => {
  await pair(
    'two forward transitions serialize',
    (f) => `SELECT ${f.status('CONFIRMED')};`,
    (f) => `SELECT ${f.status('IN_PROGRESS')};`,
    'IN_PROGRESS',
  );
  await pair(
    'cancel defeats waiting in-progress',
    (f) => `SELECT ${f.status('CANCELLED')};`,
    (f) => f.expect(`PERFORM ${f.status('IN_PROGRESS')}`, 'PT409'),
    'CANCELLED',
  );
  await pair(
    'no-show defeats waiting cancel',
    (f) => `SELECT ${f.status('NO_SHOW')};`,
    (f) => f.expect(`PERFORM ${f.status('CANCELLED')}`, 'PT409'),
    'NO_SHOW',
  );
  await pair(
    'authorized terminal same-target replay',
    (f) => `SELECT ${f.status('CANCELLED')};`,
    (f) => `SELECT ${f.status('CANCELLED')};`,
    'CANCELLED',
  );
  await pair(
    'terminal defeats waiting notes',
    (f) => `SELECT ${f.status('NO_SHOW')};`,
    (f) =>
      f.expect(
        `PERFORM public.update_appointment_notes('${f.business}','${f.appointment}','late')`,
        'PT409',
      ),
    'NO_SHOW',
  );
  // Real calendar contention with creation after a reschedule: its availability
  // query must see the winner's newly committed interval, not a stale snapshot.
  const f = appointmentFixture();
  query(`BEGIN;${f.sql}COMMIT;`);
  const a = await new Session().init(),
    b = await new Session().init();
  sessions.push(a, b);
  await a.sql(`BEGIN;${f.identity()} SET LOCAL ROLE authenticated;
    SELECT public.reschedule_appointment('${f.business}','${f.appointment}','${f.barberMember}','2026-10-14T10:00Z');`);
  await b.sql(`BEGIN;${f.identity()} SET LOCAL ROLE authenticated;`);
  const wait = b.sql(
    f.expect(
      `PERFORM public.create_appointment_with_services('${randomUUID()}','${f.business}','${f.client}','${f.barberMember}',
    '2026-10-14T10:00Z','[{"service_id":"${f.service}","quantity":1}]')`,
      'PT409',
    ),
  );
  await blocked(b, a);
  await a.sql('COMMIT;');
  await wait;
  await b.sql('COMMIT;');
  console.log(`PASS ${++count} reschedule/create share calendar lock and fresh availability`);
  // Revoke while waiting for the appointment row; post-wait authorization wins.
  const x = appointmentFixture();
  query(`BEGIN;${x.sql}COMMIT;`);
  await a.sql(`BEGIN;SELECT id FROM public.appointments WHERE id='${x.appointment}' FOR UPDATE;`);
  await b.sql(`BEGIN;${x.identity(x.barber)} SET LOCAL ROLE authenticated;`);
  const denied = b.sql(x.expect(`PERFORM ${x.status('CONFIRMED')}`, '42501'));
  await blocked(b, a);
  query(`UPDATE public.business_members SET is_active=false WHERE id='${x.barberMember}';`);
  await a.sql('COMMIT;');
  await denied;
  await b.sql('COMMIT;');
  assert.equal(
    query(`SELECT status FROM public.appointments WHERE id='${x.appointment}';`),
    'PENDING',
  );
  console.log(`PASS ${++count} revoked assignment cannot bypass post-row-wait check`);
  console.log(
    `PASS ${count}/${count} real concurrency groups; final local reset removes synthetic fixtures.`,
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(sessions.map((s) => s.close()));
  });
