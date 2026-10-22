const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { query, Session, blocked } = require('../helpers/local-postgres.cjs');
const { completeCheckoutFixture } = require('../helpers/complete-checkout-fixture.cjs');
const sessions = [];
let count = 0;
async function run(name, action) {
  await action();
  console.log(`PASS ${++count} ${name}`);
}
async function setup(f, n = 2) {
  query(`BEGIN;${f.sql}COMMIT;`);
  const clients = [];
  for (let i = 0; i < n; i++) {
    const s = await new Session().init();
    sessions.push(s);
    clients.push(s);
    await s.sql(`BEGIN;${f.identity()}SET LOCAL ROLE authenticated;`);
  }
  return clients;
}
const call = (f, op, opts) => `SELECT ${f.checkout(op, opts)};`;
const stats = (f) => JSON.parse(query(f.stats + ';'));
(async () => {
  for (const n of [2, 3])
    await run(`${n} same-operation public callers converge with one effect set`, async () => {
      const f = completeCheckoutFixture(),
        op = randomUUID(),
        clients = await setup(f, n),
        [a, b, c] = clients;
      const first = await a.sql(call(f, op));
      const second = b.sql(call(f, op, { items: null, discount: null, method: null }));
      await blocked(b, a);
      const third = c ? c.sql(call(f, op)) : null;
      if (c) await blocked(c, a);
      await a.sql('COMMIT;');
      assert.equal(await second, first);
      await b.sql('COMMIT;');
      if (c) {
        assert.equal(await third, first);
        await c.sql('COMMIT;');
      }
      assert.deepEqual(stats(f), {
        sales: 1,
        items: 3,
        payments: 1,
        debits: 2,
        stock: 0,
        appointment: 'COMPLETED',
      });
    });
  await run('different operation IDs cannot both consume the same appointment', async () => {
    const f = completeCheckoutFixture(),
      [a, b] = await setup(f);
    await a.sql(call(f, randomUUID()));
    const wait = b.sql(f.expect(`PERFORM ${f.checkout(randomUUID())}`, 'PT409'));
    await blocked(b, a);
    await a.sql('COMMIT;');
    await wait;
    await b.sql('COMMIT;');
    assert.equal(stats(f).sales, 1);
  });
  for (const terminal of ['CANCELLED', 'NO_SHOW']) {
    await run(`${terminal} wins row lock, checkout rolls back without effects`, async () => {
      const f = completeCheckoutFixture(),
        [a, b] = await setup(f);
      await a.sql(`SELECT ${f.status(terminal)};`);
      const wait = b.sql(f.expect(`PERFORM ${f.checkout(randomUUID())}`, 'PT409'));
      await blocked(b, a);
      await a.sql('COMMIT;');
      await wait;
      await b.sql('COMMIT;');
      assert.deepEqual(stats(f), {
        sales: 0,
        items: 0,
        payments: 0,
        debits: 0,
        stock: 2,
        appointment: terminal,
      });
    });
    await run(
      `checkout completion wins, waiting ${terminal} cannot rewrite completed appointment`,
      async () => {
        const f = completeCheckoutFixture(),
          [a, b] = await setup(f);
        await a.sql(call(f, randomUUID()));
        const wait = b.sql(f.expect(`PERFORM ${f.status(terminal)}`, 'PT409'));
        await blocked(b, a);
        await a.sql('COMMIT;');
        await wait;
        await b.sql('COMMIT;');
        assert.equal(stats(f).appointment, 'COMPLETED');
      },
    );
  }
  await run(
    'two direct checkouts contend on final product stock, loser writes nothing',
    async () => {
      const f = completeCheckoutFixture(),
        [a, b] = await setup(f);
      await a.sql(call(f, randomUUID(), { appointmentId: null }));
      const wait = b.sql(
        f.expect(`PERFORM ${f.checkout(randomUUID(), { appointmentId: null })}`, 'PT409'),
      );
      await blocked(b, a);
      await a.sql('COMMIT;');
      await wait;
      await b.sql('COMMIT;');
      assert.deepEqual(stats(f), {
        sales: 1,
        items: 3,
        payments: 1,
        debits: 2,
        stock: 0,
        appointment: 'PENDING',
      });
    },
  );
  await run(
    'same-key waiter creates fresh outcome after first transaction rolls back',
    async () => {
      const f = completeCheckoutFixture(),
        op = randomUUID(),
        [a, b] = await setup(f);
      await a.sql(call(f, op));
      const wait = b.sql(call(f, op));
      await blocked(b, a);
      await a.sql('ROLLBACK;');
      assert.equal(JSON.parse(await wait).sale.operation_id, op);
      await b.sql('COMMIT;');
      assert.equal(stats(f).sales, 1);
    },
  );
  await run(
    'membership lost during product or terminal-appointment wait aborts before context disclosure',
    async () => {
      for (const anchor of ['products', 'appointments']) {
        const f = completeCheckoutFixture(),
          [a, b] = await setup(f);
        const id = anchor === 'products' ? f.product : f.appointment;
        await a.sql(`RESET ROLE;SELECT id FROM public.${anchor} WHERE id='${id}' FOR UPDATE;`);
        const wait = b.sql(f.expect(`PERFORM ${f.checkout(randomUUID())}`, '42501'));
        await blocked(b, a);
        query(`UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`);
        if (anchor === 'appointments')
          await a.sql(`UPDATE public.appointments SET status='CANCELLED' WHERE id='${id}';`);
        await a.sql('COMMIT;');
        await wait;
        await b.sql('COMMIT;');
        assert.equal(stats(f).sales, 0);
        assert.equal(stats(f).debits, 0);
      }
    },
  );
  await run(
    'same-operation replay behind advisory wait revalidates active membership',
    async () => {
      const f = completeCheckoutFixture(),
        op = randomUUID(),
        [a, b] = await setup(f);
      await a.sql(
        `SELECT pg_advisory_xact_lock(hashtextextended('barberflow:checkout:${f.business}:${op}',0));`,
      );
      const wait = b.sql(f.expect(`PERFORM ${f.checkout(op)}`, '42501'));
      await blocked(b, a);
      query(`UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`);
      await a.sql('COMMIT;');
      await wait;
      await b.sql('COMMIT;');
      assert.equal(stats(f).sales, 0);
    },
  );
  await run(
    'calendar/business contention fails safe40001 instead of deadlock and rolls back checkout',
    async () => {
      const f = completeCheckoutFixture(),
        newId = randomUUID(),
        [a, b, c] = await setup(f, 3);
      await a.sql(
        `SELECT pg_advisory_xact_lock(hashtextextended('barberflow:calendar:${f.business}:${f.barberMember}',0));`,
      );
      await c.sql(`RESET ROLE;SELECT id FROM public.products WHERE id='${f.product}' FOR UPDATE;`);
      const checkout = b.sql(f.expect(`PERFORM ${f.checkout(randomUUID())}`, '40001'));
      await blocked(b, c);
      const create =
        a.sql(`SELECT public.create_appointment_with_services('${newId}','${f.business}','${f.client}','${f.barberMember}',
      '2026-10-14T11:00Z','[{"service_id":"${f.service}","quantity":1}]');`);
      await blocked(a, b);
      await c.sql('COMMIT;');
      await checkout;
      await b.sql('ROLLBACK;');
      await create;
      await a.sql('COMMIT;');
      assert.equal(stats(f).sales, 0);
      assert.equal(stats(f).debits, 0);
      assert.equal(stats(f).appointment, 'PENDING');
      assert.equal(query(`SELECT count(*) FROM public.appointments WHERE id='${newId}';`), '1');
    },
  );
  console.log(
    `PASS ${count}/${count} real public checkout concurrency groups; final reset removes fixtures.`,
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(sessions.map((s) => s.close()));
  });
