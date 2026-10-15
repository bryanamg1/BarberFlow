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
      const marker = `bf184_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(
        () => reject(new Error('BF184 connection command timed out')),
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
const businesses = [randomUUID(), randomUUID()],
  users = [randomUUID(), randomUUID()],
  services = [randomUUID(), randomUUID()];
const begin = (s, user = users[0]) =>
  s.sql(
    `BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true);`,
  );
const prepare = (op, business = businesses[0], index = 0, total = '0.29') =>
  `DO $$ BEGIN PERFORM private.persist_checkout_sale('${business}','${op}',NULL,NULL,${total},0,${total});PERFORM private.persist_checkout_items('${business}','${op}','[{"itemType":"SERVICE","itemId":"${services[index]}","quantity":1,"unitPriceOverride":"${total}"}]');END $$;`;
const call = (op, method = 'CASH', business = businesses[0]) =>
  `private.persist_checkout_payment('${business}','${op}',${method === null ? 'NULL' : `'${method}'`})`;
const invoke = (...a) =>
  `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY paid_at,id),'[]'::jsonb) FROM ${call(...a)} t;`;
const deny = (op) =>
  `DO $$ DECLARE d text; BEGIN PERFORM ${call(op)};RAISE EXCEPTION 'Expected rejection';EXCEPTION WHEN SQLSTATE '42501' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;IF d IS DISTINCT FROM 'CHECKOUT_ACCESS_DENIED' THEN RAISE EXCEPTION 'Wrong safe identifier';END IF;END $$;`;
const prepareCommitted = (op, total = '0.29') =>
  query(
    `BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${users[0]}","role":"authenticated"}',true);${prepare(op, businesses[0], 0, total)}COMMIT;`,
  );
const count = (op) =>
  Number(
    query(
      `SELECT count(*) FROM public.payments WHERE sale_id=(SELECT id FROM public.sales WHERE business_id='${businesses[0]}' AND operation_id='${op}');`,
    ),
  );
const blocked = async (waiter, holder) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (query(`SELECT ${holder.pid}=ANY(pg_blocking_pids(${waiter.pid}));`) === 't') return;
    await delay(30);
  }
  throw Error('Expected PostgreSQL blocking not observed');
};
const revoke = () =>
  query(
    `UPDATE public.business_members SET is_active=false WHERE business_id='${businesses[0]}' AND user_id='${users[1]}';`,
  );
const restore = () =>
  query(
    `UPDATE public.business_members SET is_active=true WHERE business_id='${businesses[0]}' AND user_id='${users[1]}';`,
  );
let groups = 0;
const run = async (name, fn) => {
  await fn();
  groups++;
  console.log(`PASS ${name}`);
};
(async () => {
  query(
    `BEGIN;INSERT INTO auth.users(id) VALUES('${users[0]}'),('${users[1]}');${businesses.map((id, i) => `INSERT INTO public.businesses(id,name) VALUES('${id}','BF184 concurrency ${i}');INSERT INTO public.business_members(business_id,user_id,role) VALUES('${id}','${users[0]}','OWNER');INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES('${services[i]}','${id}','BF184 service',0.29,30);`).join('\n')}INSERT INTO public.business_members(business_id,user_id,role) VALUES('${businesses[0]}','${users[1]}','OWNER');COMMIT;`,
  );
  const a = await new Session().init(),
    b = await new Session().init(),
    holder = await new Session().init();
  await run(
    'two full-slice submits with different methods replay one exact original payment',
    async () => {
      const op = randomUUID();
      await begin(a);
      await a.sql(prepare(op));
      const original = JSON.parse(await a.sql(invoke(op)));
      await begin(b, users[1]);
      const waiting = b.sql(prepare(op) + invoke(op, 'BANK_TRANSFER'));
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      assert.deepEqual(JSON.parse(await waiting), original);
      await b.sql('COMMIT;');
      assert.equal(count(op), 1);
      assert.equal(original[0].payment_method, 'CASH');
      assert.equal(original[0].created_by, users[0]);
    },
  );
  await run(
    'rollback removes sale/items/payment and waiting retry inserts only its own result',
    async () => {
      const op = randomUUID();
      await begin(a);
      await a.sql(prepare(op));
      const original = JSON.parse(await a.sql(invoke(op)));
      await begin(b, users[1]);
      const waiting = b.sql(prepare(op) + invoke(op, 'DIGITAL_WALLET'));
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('ROLLBACK;');
      const replacement = JSON.parse(await waiting);
      await b.sql('COMMIT;');
      assert.equal(count(op), 1);
      assert.notEqual(replacement[0].id, original[0].id);
      assert.notEqual(replacement[0].sale_id, original[0].sale_id);
      assert.equal(replacement[0].created_by, users[1]);
      assert.equal(replacement[0].payment_method, 'DIGITAL_WALLET');
    },
  );
  await run('concurrent zero-total submissions return empty payments with one sale', async () => {
    const op = randomUUID();
    await begin(a);
    await a.sql(prepare(op, businesses[0], 0, '0.00'));
    assert.deepEqual(JSON.parse(await a.sql(invoke(op))), []);
    await begin(b);
    const waiting = b.sql(prepare(op, businesses[0], 0, '0.00') + invoke(op, 'CREDIT_CARD'));
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql('COMMIT;');
    assert.deepEqual(JSON.parse(await waiting), []);
    await b.sql('COMMIT;');
    assert.equal(count(op), 0);
    assert.equal(
      query(
        `SELECT count(*) FROM public.sales WHERE business_id='${businesses[0]}' AND operation_id='${op}';`,
      ),
      '1',
    );
  });
  await run('revoked OWNER cannot replay after waiting on the shared operation lock', async () => {
    const op = randomUUID();
    prepareCommitted(op);
    await begin(a);
    await a.sql(invoke(op));
    await begin(b, users[1]);
    const waiting = b.sql(deny(op));
    waiting.catch(() => {});
    await blocked(b, a);
    revoke();
    await a.sql('COMMIT;');
    await waiting;
    await b.sql('COMMIT;');
    assert.equal(count(op), 1);
    restore();
  });
  await run('revoked OWNER is rechecked after waiting on the sale row', async () => {
    const op = randomUUID();
    prepareCommitted(op);
    await holder.sql(`BEGIN;SELECT id FROM public.sales WHERE operation_id='${op}' FOR UPDATE;`);
    await begin(a, users[1]);
    const waiting = a.sql(deny(op));
    waiting.catch(() => {});
    await blocked(a, holder);
    revoke();
    await holder.sql('COMMIT;');
    await waiting;
    await a.sql('COMMIT;');
    assert.equal(count(op), 0);
    restore();
  });
  await run(
    'identity loss during currency-coordinated payment INSERT rolls back that payment',
    async () => {
      const op = randomUUID();
      prepareCommitted(op);
      await holder.sql(
        `BEGIN;SELECT id FROM public.businesses WHERE id='${businesses[0]}' FOR UPDATE;`,
      );
      await begin(a, users[1]);
      const waiting = a.sql(deny(op));
      waiting.catch(() => {});
      await blocked(a, holder);
      revoke();
      await holder.sql('COMMIT;');
      await waiting;
      await a.sql('COMMIT;');
      assert.equal(count(op), 0);
      restore();
    },
  );
  await run(
    'same operation key in two businesses produces independent tenant-correct payments',
    async () => {
      const op = randomUUID();
      await begin(a);
      await a.sql(prepare(op));
      const first = JSON.parse(await a.sql(invoke(op)));
      await begin(b);
      await b.sql(prepare(op, businesses[1], 1));
      const second = JSON.parse(await b.sql(invoke(op, 'DEBIT_CARD', businesses[1])));
      assert.equal(first[0].business_id, businesses[0]);
      assert.equal(second[0].business_id, businesses[1]);
      assert.notEqual(first[0].sale_id, second[0].sale_id);
      await a.sql('COMMIT;');
      await b.sql('COMMIT;');
    },
  );
  await run('payment slice produces no stock/purchase/expense/appointment effects', async () => {
    assert.equal(
      query(
        'SELECT (SELECT count(*) FROM public.stock_movements)+(SELECT count(*) FROM public.purchases)+(SELECT count(*) FROM public.expenses);',
      ),
      '0',
    );
    assert.equal(
      query(
        `SELECT count(*) FROM public.appointments WHERE business_id IN ('${businesses[0]}','${businesses[1]}');`,
      ),
      '0',
    );
  });
  console.log(`PASS ${groups}/8 real local concurrency groups; no public checkout implemented.`);
  console.log('Committed synthetic fixtures require final local db reset.');
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const s of sessions) s.close();
  });
