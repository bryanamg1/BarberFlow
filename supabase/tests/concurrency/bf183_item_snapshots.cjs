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
      const marker = `bf183_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(
        () => reject(new Error('BF183 connection command timed out')),
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
const business = randomUUID();
const users = [randomUUID(), randomUUID()];
const service = randomUUID();
const products = [randomUUID(), randomUUID()].sort();
const begin = (s, user = users[0]) =>
  s.sql(
    `BEGIN; SELECT set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true);`,
  );
const header = (op, amount) =>
  `DO $$ BEGIN PERFORM private.persist_checkout_sale('${business}','${op}',NULL,NULL,${amount},0,${amount}); END $$;`;
const serviceBody = (quantity = 1) =>
  JSON.stringify([{ itemType: 'SERVICE', itemId: service, quantity }]);
const snapshot = (op, body = serviceBody()) =>
  `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY created_at,id),'[]'::jsonb) FROM private.persist_checkout_items('${business}','${op}',${body === null ? 'NULL' : `'${body}'::jsonb`}) t;`;
const denied = (op, body, code, detail) =>
  `DO $$ DECLARE d text; BEGIN PERFORM private.persist_checkout_items('${business}','${op}','${body}'::jsonb); RAISE EXCEPTION 'Expected rejection'; EXCEPTION WHEN SQLSTATE '${code}' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL; IF d IS DISTINCT FROM '${detail}' THEN RAISE EXCEPTION 'Wrong safe identifier'; END IF; END $$;`;
const blocked = async (waiter, holder) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (query(`SELECT ${holder.pid}=ANY(pg_blocking_pids(${waiter.pid}));`) === 't') return;
    await delay(30);
  }
  throw new Error('Expected PostgreSQL blocking relationship not observed');
};
let groups = 0;
const run = async (name, fn) => {
  await fn();
  groups++;
  console.log(`PASS ${name}`);
};
(async () => {
  query(`BEGIN; INSERT INTO auth.users(id) VALUES('${users[0]}'),('${users[1]}');
 INSERT INTO public.businesses(id,name) VALUES('${business}','BF183 concurrency');
 INSERT INTO public.business_members(business_id,user_id,role) VALUES('${business}','${users[0]}','OWNER'),('${business}','${users[1]}','OWNER');
 INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES('${service}','${business}','Original service',0.29,30);
 ${products.map((id) => `INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES('${id}','${business}','Original product',1.00,0.50);`).join('\n')}
 COMMIT;`);
  const a = await new Session().init(),
    b = await new Session().init(),
    holder = await new Session().init();
  await run('concurrent operation replay returns exact persisted duplicates once', async () => {
    const op = randomUUID();
    const body = JSON.stringify([
      { itemType: 'SERVICE', itemId: service, quantity: 1 },
      { itemType: 'SERVICE', itemId: service, quantity: 1 },
    ]);
    await begin(a);
    await a.sql(header(op, '0.58'));
    const original = JSON.parse(await a.sql(snapshot(op, body)));
    await begin(b, users[1]);
    const waiting = b.sql(header(op, '999') + snapshot(op, null));
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql('COMMIT;');
    assert.deepEqual(JSON.parse(await waiting), original);
    await b.sql('COMMIT;');
    assert.equal(original.length, 2);
    assert.equal(
      query(
        `SELECT count(*) FROM public.sale_items WHERE sale_id=(SELECT id FROM public.sales WHERE operation_id='${op}');`,
      ),
      '2',
    );
  });
  await run(
    'rollback removes header/items and waiting retry creates only its own snapshots',
    async () => {
      const op = randomUUID();
      await begin(a);
      await a.sql(header(op, '0.58'));
      const original = JSON.parse(await a.sql(snapshot(op, serviceBody(2))));
      await begin(b);
      const waiting = b.sql(header(op, '0.29') + snapshot(op));
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('ROLLBACK;');
      const replacement = JSON.parse(await waiting);
      await b.sql('COMMIT;');
      assert.equal(replacement.length, 1);
      assert.notEqual(replacement[0].sale_id, original[0].sale_id);
      assert.equal(replacement[0].line_total, 0.29);
    },
  );
  await run(
    'catalog snapshot refreshes after waiting for concurrent price/name update',
    async () => {
      const op = randomUUID();
      await holder.sql(
        `BEGIN; UPDATE public.services SET price=0.49,name='Updated service' WHERE id='${service}';`,
      );
      await begin(a);
      await a.sql(header(op, '0.49'));
      const waiting = a.sql(snapshot(op));
      waiting.catch(() => {});
      await blocked(a, holder);
      await holder.sql('COMMIT;');
      const rows = JSON.parse(await waiting);
      assert.equal(rows[0].unit_price_snapshot, 0.49);
      assert.equal(rows[0].item_name_snapshot, 'Updated service');
      await a.sql('COMMIT;');
    },
  );
  await run(
    'catalog locks remain held after helper return until commit; historical replay stays unchanged',
    async () => {
      const op = randomUUID();
      await begin(a);
      await a.sql(header(op, '0.49'));
      const original = JSON.parse(await a.sql(snapshot(op)));
      await b.sql('BEGIN;');
      const waiting = b.sql(
        `UPDATE public.services SET price=0.59,name='Later service' WHERE id='${service}';`,
      );
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      await waiting;
      await b.sql('COMMIT;');
      await begin(a);
      assert.deepEqual(JSON.parse(await a.sql(snapshot(op, null))), original);
      await a.sql('COMMIT;');
    },
  );
  await run(
    'service archived during catalog wait is rejected with no item persistence',
    async () => {
      const op = randomUUID();
      await holder.sql(`BEGIN; UPDATE public.services SET is_active=false WHERE id='${service}';`);
      await begin(a);
      await a.sql(header(op, '0.59'));
      const waiting = a.sql(denied(op, serviceBody(), '22023', 'INVALID_CHECKOUT'));
      waiting.catch(() => {});
      await blocked(a, holder);
      await holder.sql('COMMIT;');
      await waiting;
      assert.equal(
        await a.sql(
          `SELECT count(*) FROM public.sale_items WHERE sale_id=(SELECT id FROM public.sales WHERE operation_id='${op}');`,
        ),
        '0',
      );
      await a.sql('ROLLBACK;');
      query(`UPDATE public.services SET is_active=true WHERE id='${service}';`);
    },
  );
  await run('membership revoked during catalog wait cannot persist snapshots', async () => {
    const op = randomUUID();
    await holder.sql(`BEGIN; SELECT id FROM public.services WHERE id='${service}' FOR UPDATE;`);
    await begin(a, users[1]);
    await a.sql(header(op, '0.59'));
    const waiting = a.sql(denied(op, serviceBody(), '42501', 'CHECKOUT_ACCESS_DENIED'));
    waiting.catch(() => {});
    await blocked(a, holder);
    query(
      `UPDATE public.business_members SET is_active=false WHERE business_id='${business}' AND user_id='${users[1]}';`,
    );
    await holder.sql('COMMIT;');
    await waiting;
    await a.sql('ROLLBACK;');
    assert.equal(query(`SELECT count(*) FROM public.sales WHERE operation_id='${op}';`), '0');
    query(
      `UPDATE public.business_members SET is_active=true WHERE business_id='${business}' AND user_id='${users[1]}';`,
    );
  });
  await run(
    'reverse product input orders acquire UUID-sorted catalog locks without deadlock',
    async () => {
      const ops = [randomUUID(), randomUUID()];
      query(
        `BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${users[0]}","role":"authenticated"}',true);${header(ops[0], '2.00')}${header(ops[1], '2.00')}COMMIT;`,
      );
      const bodies = [products, products.slice().reverse()].map((ids) =>
        JSON.stringify(ids.map((itemId) => ({ itemType: 'PRODUCT', itemId, quantity: 1 }))),
      );
      await holder.sql(
        `BEGIN; SELECT id FROM public.products WHERE id='${products[0]}' FOR UPDATE;`,
      );
      await begin(a);
      await begin(b);
      const first = a.sql(snapshot(ops[0], bodies[0])),
        second = b.sql(snapshot(ops[1], bodies[1]));
      first.catch(() => {});
      second.catch(() => {});
      await blocked(a, holder);
      await blocked(b, holder);
      // If either waiter locked the second input first, this NOWAIT would fail.
      await holder.sql(
        `SELECT id FROM public.products WHERE id='${products[1]}' FOR UPDATE NOWAIT;COMMIT;`,
      );
      assert.equal(JSON.parse(await first).length, 2);
      assert.equal(JSON.parse(await second).length, 2);
      await a.sql('COMMIT;');
      await b.sql('COMMIT;');
    },
  );
  await run(
    'product cost/price snapshot refreshes after wait and is immutable thereafter',
    async () => {
      const op = randomUUID(),
        body = JSON.stringify([{ itemType: 'PRODUCT', itemId: products[0], quantity: 1 }]);
      await holder.sql(
        `BEGIN;UPDATE public.products SET name='Changed product',sale_price=1.25,default_purchase_cost=0.75 WHERE id='${products[0]}';`,
      );
      await begin(a);
      await a.sql(header(op, '1.25'));
      const waiting = a.sql(snapshot(op, body));
      waiting.catch(() => {});
      await blocked(a, holder);
      await holder.sql('COMMIT;');
      const original = JSON.parse(await waiting);
      assert.equal(original[0].item_name_snapshot, 'Changed product');
      assert.equal(original[0].unit_cost_snapshot, 0.75);
      assert.equal(original[0].unit_price_snapshot, 1.25);
      await a.sql('COMMIT;');
      query(
        `UPDATE public.products SET name='Later product',sale_price=99,default_purchase_cost=88,is_active=false WHERE id='${products[0]}';`,
      );
      await begin(a);
      assert.deepEqual(JSON.parse(await a.sql(snapshot(op, null))), original);
      await a.sql('COMMIT;');
    },
  );
  await run('slice adds no payment/SALE movement/purchase/appointment side effects', async () => {
    assert.equal(
      query(
        'SELECT (SELECT count(*) FROM public.payments)+(SELECT count(*) FROM public.stock_movements)+(SELECT count(*) FROM public.purchases);',
      ),
      '0',
    );
    assert.equal(
      query(`SELECT count(*) FROM public.appointments WHERE business_id='${business}';`),
      '0',
    );
  });
  console.log(`PASS ${groups}/9 real local concurrency groups; no public checkout implemented.`);
  console.log('Committed synthetic fixtures require final local db reset.');
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const session of sessions) session.close();
  });
