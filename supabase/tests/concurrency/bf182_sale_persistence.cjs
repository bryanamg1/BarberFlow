// Local PostgreSQL integration only. Committed synthetic fixtures are removed by
// the authorized final db reset; this runner never contacts a remote database.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const args = [
  'exec',
  '-i',
  'supabase_db_barberflow',
  'psql',
  '-X',
  '-q',
  '-At',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
];
const query = (sql) =>
  execFileSync('docker', args, { input: sql, encoding: 'utf8', timeout: 15000 }).trim();
const sessions = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class Session {
  constructor() {
    this.child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    this.errors = '';
    this.pending = null;
    this.child.stderr.on('data', (chunk) => {
      this.errors += chunk;
    });
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      if (this.pending && this.buffer.includes(this.pending.marker + '\n')) {
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        const result = this.buffer.slice(0, this.buffer.indexOf(pending.marker)).trim();
        this.buffer = '';
        pending.resolve(result);
      }
    });
    this.child.on('exit', (code) => {
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(new Error(`psql exit ${code}: ${this.errors}`));
        this.pending = null;
      }
    });
    sessions.push(this);
  }
  sql(sql) {
    assert.equal(this.pending, null, 'one outstanding command per connection');
    return new Promise((resolve, reject) => {
      const marker = `bf182_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(
        () => reject(new Error('BF182 connection command timed out')),
        16000,
      );
      this.pending = { marker, timer, resolve, reject };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }
  async init() {
    this.pid = Number(await this.sql('SELECT pg_backend_pid();'));
    await this.sql("SET statement_timeout='12s'; SET lock_timeout='10s';");
    return this;
  }
  close() {
    this.child.stdin.end('\\q\n');
  }
}
const businesses = [randomUUID(), randomUUID()];
const users = [randomUUID(), randomUUID()];
const clients = [randomUUID(), randomUUID()];
const members = [randomUUID(), randomUUID()];
const appointments = Array.from({ length: 6 }, () => randomUUID());
const call = (
  op,
  appointment = null,
  subtotal = 10,
  discount = 1,
  total = 9,
  business = businesses[0],
) =>
  `private.persist_checkout_sale('${business}','${op}',${appointment ? `'${appointment}'` : 'NULL'},NULL,${subtotal},${discount},${total})`;
const invoke = (...args) => `SELECT to_jsonb(t) FROM ${call(...args)} AS t;`;
const begin = (session, actor = users[0]) =>
  session.sql(
    `BEGIN; SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);`,
  );
const count = (op) =>
  Number(query(`SELECT count(*) FROM public.sales WHERE operation_id='${op}';`));
const expect = (statement, code, detail) =>
  `DO $$ DECLARE actual text; BEGIN PERFORM ${statement}; RAISE EXCEPTION 'Expected ${code}'; EXCEPTION WHEN SQLSTATE '${code}' THEN GET STACKED DIAGNOSTICS actual=PG_EXCEPTION_DETAIL; IF actual IS DISTINCT FROM '${detail}' THEN RAISE EXCEPTION 'Unexpected domain detail'; END IF; END $$;`;
const blocked = async (waiter, holder, advisory = false) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const observed = query(
      `SELECT ${holder.pid}=ANY(pg_blocking_pids(${waiter.pid})) AND (${!advisory} OR EXISTS(SELECT 1 FROM pg_locks WHERE pid=${waiter.pid} AND locktype='advisory' AND NOT granted));`,
    );
    if (observed === 't') return;
    await delay(30);
  }
  throw new Error('Expected PostgreSQL blocking relationship not observed');
};
const run = async (name, fn) => {
  await fn();
  console.log(`PASS ${name}`);
};
const revoke = () =>
  query(
    `UPDATE public.business_members SET is_active=false WHERE business_id='${businesses[0]}' AND user_id='${users[1]}';`,
  );
const restore = () =>
  query(
    `UPDATE public.business_members SET is_active=true WHERE business_id='${businesses[0]}' AND user_id='${users[1]}';`,
  );

(async () => {
  query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${users[0]}'),('${users[1]}');
    ${businesses.map((id, i) => `INSERT INTO public.businesses(id,name) VALUES('${id}','BF182 concurrency ${i}'); INSERT INTO public.business_members(id,business_id,user_id,role) VALUES('${members[i]}','${id}','${users[0]}','OWNER'); INSERT INTO public.clients(id,business_id,first_name) VALUES('${clients[i]}','${id}','BF182 concurrency');`).join('\n')}
    INSERT INTO public.business_members(business_id,user_id,role) VALUES('${businesses[0]}','${users[1]}','OWNER');
    ${appointments.map((id) => `INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES('${id}','${businesses[0]}','${clients[0]}','${members[0]}','2026-01-01T10:00:00Z','2026-01-01T10:30:00Z','${users[0]}');`).join('\n')}
  COMMIT;`);
  const a = await new Session().init();
  const b = await new Session().init();
  const holder = await new Session().init();
  await run('concurrent same-operation replay returns exact original header once', async () => {
    const op = randomUUID();
    await begin(a);
    const original = JSON.parse(await a.sql(invoke(op)));
    await begin(b, users[1]);
    const waiting = b.sql(invoke(op, null, 999, 0, 999));
    waiting.catch(() => {});
    await blocked(b, a, true);
    await a.sql('COMMIT;');
    assert.deepEqual(JSON.parse(await waiting), original);
    await b.sql('COMMIT;');
    assert.equal(count(op), 1);
  });
  await run(
    'rollback releases operation lock; waiter inserts its own authoritative header',
    async () => {
      const op = randomUUID();
      await begin(a);
      const original = JSON.parse(await a.sql(invoke(op)));
      await begin(b);
      const waiting = b.sql(invoke(op, null, 2, 0, 2));
      waiting.catch(() => {});
      await blocked(b, a, true);
      await a.sql('ROLLBACK;');
      const replacement = JSON.parse(await waiting);
      assert.notEqual(replacement.id, original.id);
      assert.equal(replacement.total, 2);
      await b.sql('COMMIT;');
      assert.equal(count(op), 1);
    },
  );
  await run('different operation cannot persist a second sale for one appointment', async () => {
    const firstOp = randomUUID(),
      secondOp = randomUUID();
    await begin(a);
    await a.sql(invoke(firstOp, appointments[0]));
    await begin(b);
    const waiting = b.sql(
      expect(call(secondOp, appointments[0]), 'PT409', 'INVALID_APPOINTMENT_STATUS'),
    );
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql('COMMIT;');
    await waiting;
    await b.sql('COMMIT;');
    assert.equal(count(firstOp), 1);
    assert.equal(count(secondOp), 0);
    assert.equal(
      query(`SELECT status FROM public.appointments WHERE id='${appointments[0]}';`),
      'PENDING',
    );
  });
  await run(
    'rolled-back appointment sale does not reserve or complete the appointment',
    async () => {
      const firstOp = randomUUID(),
        secondOp = randomUUID();
      await begin(a);
      await a.sql(invoke(firstOp, appointments[1]));
      await begin(b);
      const waiting = b.sql(invoke(secondOp, appointments[1]));
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('ROLLBACK;');
      await waiting;
      await b.sql('COMMIT;');
      assert.equal(count(firstOp), 0);
      assert.equal(count(secondOp), 1);
    },
  );
  await run('parent eligibility is refreshed after a status-change wait', async () => {
    const op = randomUUID();
    await holder.sql(
      `BEGIN; UPDATE public.appointments SET status='CANCELLED' WHERE id='${appointments[2]}';`,
    );
    await begin(a);
    const waiting = a.sql(expect(call(op, appointments[2]), 'PT409', 'INVALID_APPOINTMENT_STATUS'));
    waiting.catch(() => {});
    await blocked(a, holder);
    await holder.sql('COMMIT;');
    await waiting;
    await a.sql('ROLLBACK;');
    assert.equal(count(op), 0);
  });
  await run('parent lock remains owned after helper returns until transaction ends', async () => {
    const op = randomUUID();
    await begin(a);
    await a.sql(invoke(op, appointments[3]));
    await holder.sql('BEGIN;');
    const waiting = holder.sql(
      `SELECT id FROM public.appointments WHERE id='${appointments[3]}' FOR UPDATE;`,
    );
    waiting.catch(() => {});
    await blocked(holder, a);
    await a.sql('COMMIT;');
    await waiting;
    await holder.sql('ROLLBACK;');
  });
  await run('revoked identity cannot replay after waiting for the operation lock', async () => {
    const op = randomUUID();
    await begin(a);
    await a.sql(invoke(op));
    await begin(b, users[1]);
    const waiting = b.sql(expect(call(op), '42501', 'CHECKOUT_ACCESS_DENIED'));
    waiting.catch(() => {});
    await blocked(b, a, true);
    revoke();
    await a.sql('COMMIT;');
    await waiting;
    await b.sql('ROLLBACK;');
    restore();
    assert.equal(count(op), 1);
  });
  await run('revoked identity is checked before interpreting a changed parent status', async () => {
    const op = randomUUID();
    await holder.sql(
      `BEGIN; UPDATE public.appointments SET status='CANCELLED' WHERE id='${appointments[4]}';`,
    );
    await begin(b, users[1]);
    const waiting = b.sql(expect(call(op, appointments[4]), '42501', 'CHECKOUT_ACCESS_DENIED'));
    waiting.catch(() => {});
    await blocked(b, holder);
    revoke();
    await holder.sql('COMMIT;');
    await waiting;
    await b.sql('ROLLBACK;');
    restore();
    assert.equal(count(op), 0);
  });
  await run(
    'identity loss during existing financial-currency INSERT wait rolls back the header',
    async () => {
      const op = randomUUID();
      await holder.sql(
        `BEGIN; SELECT id FROM public.businesses WHERE id='${businesses[0]}' FOR UPDATE;`,
      );
      await begin(b, users[1]);
      const waiting = b.sql(expect(call(op), '42501', 'CHECKOUT_ACCESS_DENIED'));
      waiting.catch(() => {});
      await blocked(b, holder);
      revoke();
      await holder.sql('COMMIT;');
      await waiting;
      await b.sql('ROLLBACK;');
      restore();
      assert.equal(count(op), 0);
    },
  );
  await run(
    'operation IDs are scoped by business, with independent authorized headers',
    async () => {
      const op = randomUUID();
      await begin(a);
      const first = JSON.parse(await a.sql(invoke(op)));
      await begin(b);
      const second = JSON.parse(await b.sql(invoke(op, null, 1, 0, 1, businesses[1])));
      assert.notEqual(first.id, second.id);
      assert.equal(second.business_id, businesses[1]);
      await a.sql('COMMIT;');
      await b.sql('COMMIT;');
      assert.equal(count(op), 2);
    },
  );
  await run('internal header persistence adds no items, payments or stock movements', async () => {
    assert.equal(
      query(
        'SELECT (SELECT count(*) FROM public.sale_items)+(SELECT count(*) FROM public.payments)+(SELECT count(*) FROM public.stock_movements);',
      ),
      '0',
    );
  });
  console.log('PASS 11/11 real local concurrency groups; no public checkout implemented.');
  console.log('Committed synthetic fixtures require final local db reset.');
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const session of sessions) session.close();
  });
