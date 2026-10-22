const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { query, Session, blocked } = require('../helpers/local-postgres.cjs');
const { replayFixture } = require('../helpers/checkout-replay-fixture.cjs');
const sessions = [];
let count = 0;
async function run(name, action) {
  await action();
  console.log(`PASS ${++count} ${name}`);
}
async function setup(f, number = 2) {
  query(`BEGIN;${f.sql}COMMIT;`);
  const clients = [];
  for (let i = 0; i < number; i++) {
    const s = await new Session().init();
    sessions.push(s);
    clients.push(s);
    await s.sql(`BEGIN;${f.identity()}`);
  }
  return clients;
}
const outcome = (f, op) => `SELECT ${f.gate(op)};`;
(async () => {
  await run(
    'three same-operation callers converge on one complete outcome/effect set',
    async () => {
      const f = replayFixture(),
        op = randomUUID(),
        [a, b, c] = await setup(f, 3);
      await a.sql(f.pipeline(op));
      const first = await a.sql(f.snapshot(op));
      const waitB = b.sql(`${f.pipeline(op)}${f.snapshot(op)}`);
      await blocked(b, a);
      const waitC = c.sql(`${f.pipeline(op)}${f.snapshot(op)}`);
      await blocked(c, a);
      await a.sql('COMMIT;');
      const second = await waitB;
      await b.sql('COMMIT;');
      const third = await waitC;
      await c.sql('COMMIT;');
      assert.equal(second, first);
      assert.equal(third, first);
      const history = JSON.parse(first);
      assert.equal(history.sales, 1);
      assert.equal(history.outcome.items.length, 3);
      assert.equal(history.outcome.payments.length, 1);
      assert.equal(history.movements.filter((m) => m.type === 'SALE').length, 2);
    },
  );
  await run(
    'different operation waiting on same appointment rejects after first completes',
    async () => {
      const f = replayFixture(),
        op = randomUUID(),
        next = randomUUID(),
        [a, b] = await setup(f);
      await a.sql(f.pipeline(op));
      await b.sql(outcome(f, next)); // Unknown key cannot reuse the other result.
      const wait = b.sql(f.expect(`PERFORM ${f.header(next)}`, 'PT409'));
      await blocked(b, a);
      await a.sql('COMMIT;');
      await wait;
      await b.sql('COMMIT;');
      assert.equal(
        query(`SELECT count(*) FROM public.sales WHERE appointment_id='${f.appointment}';`),
        '1',
      );
    },
  );
  await run(
    'first transaction rollback lets waiting same key execute once from scratch',
    async () => {
      const f = replayFixture(),
        op = randomUUID(),
        [a, b] = await setup(f);
      await a.sql(f.pipeline(op));
      const wait = b.sql(`${f.pipeline(op)}${outcome(f, op)}`);
      await blocked(b, a);
      await a.sql('ROLLBACK;');
      const result = await wait;
      await b.sql('COMMIT;');
      assert.equal(JSON.parse(result).sale.operation_id, op);
      assert.equal(
        query(`SELECT count(*) FROM public.sales WHERE appointment_id='${f.appointment}';`),
        '1',
      );
    },
  );
  await run('replay waits while first execution is blocked at product/stock stage', async () => {
    const f = replayFixture(),
      op = randomUUID(),
      [a, b, c] = await setup(f, 3);
    await c.sql(`SELECT id FROM public.products WHERE id='${f.product}' FOR UPDATE;`);
    await a.sql(`${outcome(f, op)}SELECT ${f.header(op)};`);
    const first = a.sql(`DO $$ BEGIN ${f.remaining(op)} END $$;${outcome(f, op)}`);
    await blocked(a, c);
    const replay = b.sql(outcome(f, op));
    await blocked(b, a);
    await c.sql('COMMIT;');
    const original = await first;
    await a.sql('COMMIT;');
    assert.equal(await replay, original);
    await b.sql('COMMIT;');
  });
  await run('replay waits at operation barrier through payment-stage contention', async () => {
    const f = replayFixture(),
      op = randomUUID(),
      [a, b, c] = await setup(f, 3);
    await a.sql(`${outcome(f, op)}SELECT ${f.header(op)};`);
    // Controlled local contention at the payment table, after sale persistence.
    await c.sql('LOCK TABLE public.payments IN SHARE MODE;');
    const first = a.sql(`DO $$ BEGIN ${f.remaining(op)} END $$;${outcome(f, op)}`);
    await blocked(a, c);
    const replay = b.sql(outcome(f, op));
    await blocked(b, a);
    await c.sql('COMMIT;');
    const original = await first;
    await a.sql('COMMIT;');
    assert.equal(await replay, original);
    await b.sql('COMMIT;');
  });
  await run('membership revoked while waiting rejects replay after advisory wait', async () => {
    const f = replayFixture(),
      op = randomUUID(),
      [a, b] = await setup(f);
    await a.sql(
      `SELECT pg_advisory_xact_lock(hashtextextended('barberflow:checkout:${f.business}:${op}',0));`,
    );
    const wait = b.sql(f.expect(`PERFORM ${f.gate(op)}`, '42501'));
    await blocked(b, a);
    query(`UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`);
    await a.sql('COMMIT;');
    await wait;
    await b.sql('COMMIT;');
  });
  await run(
    'membership revoked during sale row wait rejects previously authorized replay',
    async () => {
      const f = replayFixture(),
        op = randomUUID();
      query(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}COMMIT;`);
      const a = await new Session().init(),
        b = await new Session().init();
      sessions.push(a, b);
      await a.sql(`BEGIN;SELECT id FROM public.sales WHERE operation_id='${op}' FOR UPDATE;`);
      await b.sql(`BEGIN;${f.identity()}`);
      const wait = b.sql(f.expect(`PERFORM ${f.gate(op)}`, '42501'));
      await blocked(b, a);
      query(`UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`);
      await a.sql('COMMIT;');
      await wait;
      await b.sql('COMMIT;');
    },
  );
  console.log(
    `PASS ${count}/${count} real replay concurrency groups; final local reset removes fixtures.`,
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(sessions.map((s) => s.close()));
  });
