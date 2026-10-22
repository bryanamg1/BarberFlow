const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { query, Session, blocked } = require('../helpers/local-postgres.cjs');
const { checkoutFixture } = require('../helpers/checkout-appointment-fixture.cjs');
const sessions = [];
let count = 0;
async function run(name, action) {
  await action();
  console.log(`PASS ${++count} ${name}`);
}
async function connections(f) {
  query(`BEGIN;${f.sql}COMMIT;`);
  const a = await new Session().init(),
    b = await new Session().init();
  sessions.push(a, b);
  await a.sql(`BEGIN;${f.identity()}`);
  await b.sql(`BEGIN;${f.identity()}`);
  return [a, b];
}
(async () => {
  for (const same of [true, false]) {
    await run(
      same
        ? 'simultaneous same-operation replay completes once'
        : 'distinct operations cannot both complete appointment',
      async () => {
        const f = checkoutFixture(),
          op = randomUUID(),
          other = same ? op : randomUUID(),
          [a, b] = await connections(f);
        await a.sql(f.pipeline(op));
        const original = await a.sql(
          `SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}';`,
        );
        const wait = b.sql(
          same ? f.pipeline(other) : f.expect(`PERFORM ${f.sale(other)}`, 'PT409'),
        );
        await blocked(b, a);
        await a.sql('COMMIT;');
        await wait;
        await b.sql('COMMIT;');
        assert.equal(
          query(`SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}';`),
          original,
        );
        assert.equal(
          query(`SELECT count(*) FROM public.sales WHERE appointment_id='${f.appointment}';`),
          '1',
        );
      },
    );
  }
  for (const terminal of ['CANCELLED', 'NO_SHOW']) {
    await run(
      `${terminal} winning row lock rejects new checkout without partial sale`,
      async () => {
        const f = checkoutFixture(),
          op = randomUUID(),
          [a, b] = await connections(f);
        await a.sql(`SET LOCAL ROLE authenticated;SELECT ${f.status(terminal)};`);
        const wait = b.sql(f.expect(`PERFORM ${f.sale(op)}`, 'PT409'));
        await blocked(b, a);
        await a.sql('COMMIT;');
        await wait;
        await b.sql('COMMIT;');
        assert.equal(
          query(`SELECT status FROM public.appointments WHERE id='${f.appointment}';`),
          terminal,
        );
        assert.equal(query(`SELECT count(*) FROM public.sales WHERE operation_id='${op}';`), '0');
      },
    );
    await run(`completion winning row lock rejects waiting ${terminal}`, async () => {
      const f = checkoutFixture(),
        op = randomUUID(),
        [a, b] = await connections(f);
      await a.sql(f.pipeline(op));
      await b.sql('SET LOCAL ROLE authenticated;');
      const wait = b.sql(f.expect(`PERFORM ${f.status(terminal)}`, 'PT409'));
      await blocked(b, a);
      await a.sql('COMMIT;');
      await wait;
      await b.sql('COMMIT;');
      assert.equal(
        query(`SELECT status FROM public.appointments WHERE id='${f.appointment}';`),
        'COMPLETED',
      );
    });
  }
  await run('outer rollback releases appointment for waiting different operation', async () => {
    const f = checkoutFixture(),
      op = randomUUID(),
      next = randomUUID(),
      [a, b] = await connections(f);
    await a.sql(f.pipeline(op));
    const wait = b.sql(f.pipeline(next));
    await blocked(b, a);
    await a.sql('ROLLBACK;');
    await wait;
    await b.sql('COMMIT;');
    assert.equal(
      query(`SELECT operation_id FROM public.sales WHERE appointment_id='${f.appointment}';`),
      next,
    );
  });
  await run(
    'calendar/business circular wait is cut by safe40001 and complete rollback',
    async () => {
      const f = checkoutFixture(),
        op = randomUUID(),
        newId = randomUUID(),
        [a, b] = await connections(f);
      await a.sql(
        `SELECT pg_advisory_xact_lock(hashtextextended('barberflow:calendar:${f.business}:${f.barberMember}',0));`,
      );
      await b.sql(`SELECT ${f.sale(op)};`); // Owns appointment and financial business currency lock.
      await a.sql('SET LOCAL ROLE authenticated;');
      const wait =
        a.sql(`SELECT public.create_appointment_with_services('${newId}','${f.business}','${f.client}','${f.barberMember}',
      '2026-10-14T11:00Z','[{"service_id":"${f.service}","quantity":1}]');`);
      await blocked(a, b); // Real create owns calendar and awaits business held by checkout.
      await b.sql(f.expect(`PERFORM ${f.completion(op)}`, '40001'));
      await b.sql('ROLLBACK;');
      await wait;
      await a.sql('COMMIT;');
      assert.equal(query(`SELECT count(*) FROM public.sales WHERE operation_id='${op}';`), '0');
      assert.equal(
        query(`SELECT status FROM public.appointments WHERE id='${f.appointment}';`),
        'PENDING',
      );
      assert.equal(query(`SELECT count(*) FROM public.appointments WHERE id='${newId}';`), '1');
    },
  );
  await run('membership lost while waiting on original operation denies replay', async () => {
    const f = checkoutFixture(),
      op = randomUUID(),
      [a, b] = await connections(f);
    // Hold operation only so revocation itself does not wait for our membership SHARE.
    await a.sql(
      `SELECT pg_advisory_xact_lock(hashtextextended('barberflow:checkout:${f.business}:${op}',0));`,
    );
    const wait = b.sql(f.expect(`PERFORM ${f.completion(op)}`, '42501'));
    await blocked(b, a);
    query(`UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`);
    await a.sql('COMMIT;');
    await wait;
    await b.sql('COMMIT;');
    assert.equal(
      query(`SELECT status FROM public.appointments WHERE id='${f.appointment}';`),
      'PENDING',
    );
  });
  console.log(
    `PASS ${count}/${count} real completion concurrency groups; final local reset removes fixtures.`,
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(sessions.map((s) => s.close()));
  });
