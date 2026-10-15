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
      const marker = `bf185_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(
        () => reject(new Error('BF185 connection command timed out')),
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
  products = [randomUUID(), randomUUID(), randomUUID()];
const begin = (s, user = users[0]) =>
  s.sql(
    `BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true);`,
  );
const argsFor = (op, ids = [products[0]], business = businesses[0]) => ({ op, ids, business });
const invoke = ({ op, business }) =>
  `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY occurred_at,id),'[]'::jsonb) FROM private.persist_checkout_stock('${business}','${op}') t;`;
const pipeline = ({ op, ids, business }) => `DO $$ DECLARE s public.sales%ROWTYPE; BEGIN
 s:=private.persist_checkout_sale('${business}','${op}',NULL,NULL,0,0,0);
 IF NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_type='SALE' AND reference_id=s.id) THEN
  PERFORM private.lock_checkout_products('${business}',ARRAY[${ids.map((p) => `'${p}'::uuid`).join(',')}],ARRAY[${ids.map(() => 1).join(',')}]);
  PERFORM private.persist_checkout_items('${business}','${op}','${JSON.stringify(ids.map((id) => ({ itemType: 'PRODUCT', itemId: id, quantity: 1, unitPriceOverride: '0.00' })))}');
  PERFORM private.persist_checkout_payment('${business}','${op}','CASH');
 END IF;
 PERFORM private.persist_checkout_stock('${business}','${op}'); END $$;`;
const failing = (a, state = 'PT409', detail = 'INSUFFICIENT_STOCK') => `DO $$ DECLARE d text; BEGIN
 BEGIN ${pipeline(a)
   .replace(
     /^DO \$\$ DECLARE s public.sales%ROWTYPE; BEGIN/,
     'DECLARE s public.sales%ROWTYPE; BEGIN',
   )
   .replace(/ END \$\$;$/, ' END;')}
 RAISE EXCEPTION 'Expected failure'; EXCEPTION WHEN SQLSTATE '${state}' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
 IF d IS DISTINCT FROM '${detail}' THEN RAISE EXCEPTION 'Wrong normalized signal'; END IF; END; END $$;`;
const balance = (id) =>
  Number(
    query(
      `SELECT coalesce(sum(quantity_delta),0) FROM public.stock_movements WHERE product_id='${id}';`,
    ),
  );
const setStock = (id, n, business = businesses[0]) => {
  const delta = n - balance(id);
  if (delta)
    query(
      `INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES('${business}','${id}','ADJUSTMENT',${delta},'${users[0]}');`,
    );
};
const count = (op) =>
  Number(
    query(
      `SELECT count(*) FROM public.stock_movements WHERE reference_type='SALE' AND reference_id=(SELECT id FROM public.sales WHERE business_id='${businesses[0]}' AND operation_id='${op}');`,
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
  query(`BEGIN;INSERT INTO auth.users(id) VALUES('${users[0]}'),('${users[1]}');${businesses.map((b, i) => `INSERT INTO public.businesses(id,name) VALUES('${b}','BF185 concurrency ${i}');INSERT INTO public.business_members(business_id,user_id,role) VALUES('${b}','${users[0]}','OWNER');`).join('')}
 INSERT INTO public.business_members(business_id,user_id,role) VALUES('${businesses[0]}','${users[1]}','OWNER');
 ${products.map((p, i) => `INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES('${p}','${businesses[i === 2 ? 1 : 0]}','BF185 product ${i}',1,0.29);`).join('')}COMMIT;`);
  const a = await new Session().init(),
    b = await new Session().init(),
    holder = await new Session().init();
  await run(
    'exact stock for one of two checkouts; waiter sees committed debit and rolls back all slices',
    async () => {
      setStock(products[0], 1);
      const x = argsFor(randomUUID()),
        y = argsFor(randomUUID());
      await begin(a);
      await a.sql(pipeline(x));
      await begin(b);
      const wait = b.sql(failing(y));
      wait.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      await wait;
      await b.sql('COMMIT;');
      assert.equal(balance(products[0]), 0);
      assert.equal(count(x.op), 1);
      assert.equal(count(y.op), 0);
      assert.equal(query(`SELECT count(*) FROM public.sales WHERE operation_id='${y.op}';`), '0');
    },
  );
  await run('stock sufficient for both serializes and commits two distinct debits', async () => {
    setStock(products[0], 2);
    const x = argsFor(randomUUID()),
      y = argsFor(randomUUID());
    await begin(a);
    await a.sql(pipeline(x));
    await begin(b);
    const wait = b.sql(pipeline(y));
    wait.catch(() => {});
    await blocked(b, a);
    await a.sql('COMMIT;');
    await wait;
    await b.sql('COMMIT;');
    assert.equal(balance(products[0]), 0);
    assert.equal(count(x.op), 1);
    assert.equal(count(y.op), 1);
  });
  await run(
    'opposite product order uses BF181 UUID locks and completes without deadlock',
    async () => {
      setStock(products[0], 2);
      setStock(products[1], 2);
      const x = argsFor(randomUUID(), [products[0], products[1]]),
        y = argsFor(randomUUID(), [products[1], products[0]]);
      await begin(a);
      await a.sql(pipeline(x));
      await begin(b);
      const wait = b.sql(pipeline(y));
      wait.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      await wait;
      await b.sql('COMMIT;');
      assert.equal(balance(products[0]), 0);
      assert.equal(balance(products[1]), 0);
      assert.equal(count(x.op), 2);
      assert.equal(count(y.op), 2);
    },
  );
  await run(
    'rollback of sale/items/payment-stage/ledger releases stock for waiting replacement',
    async () => {
      setStock(products[0], 1);
      const x = argsFor(randomUUID()),
        y = argsFor(randomUUID());
      await begin(a);
      await a.sql(pipeline(x));
      await begin(b);
      const wait = b.sql(pipeline(y));
      wait.catch(() => {});
      await blocked(b, a);
      await a.sql('ROLLBACK;');
      await wait;
      await b.sql('COMMIT;');
      assert.equal(balance(products[0]), 0);
      assert.equal(count(x.op), 0);
      assert.equal(count(y.op), 1);
      assert.equal(query(`SELECT count(*) FROM public.sales WHERE operation_id='${x.op}';`), '0');
    },
  );
  await run(
    'simultaneous same operation replays original movement/audit without another debit',
    async () => {
      setStock(products[0], 1);
      const x = argsFor(randomUUID());
      await begin(a);
      await a.sql(pipeline(x));
      const original = JSON.parse(await a.sql(invoke(x)));
      await begin(b, users[1]);
      const wait = b.sql(pipeline(x) + invoke(x));
      wait.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      assert.deepEqual(JSON.parse(await wait), original);
      await b.sql('COMMIT;');
      assert.equal(balance(products[0]), 0);
      assert.equal(count(x.op), 1);
    },
  );
  await run(
    'membership revoked during operation-lock wait denies historical replay unchanged',
    async () => {
      setStock(products[0], 2);
      const x = argsFor(randomUUID());
      await begin(a);
      await a.sql(pipeline(x));
      await a.sql('COMMIT;');
      await begin(a);
      await a.sql(invoke(x));
      await begin(b, users[1]);
      const wait = b.sql(
        `DO $$ BEGIN PERFORM private.persist_checkout_stock('${x.business}','${x.op}');RAISE EXCEPTION 'Expected denial';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END $$;`,
      );
      wait.catch(() => {});
      await blocked(b, a);
      revoke();
      await a.sql('COMMIT;');
      await wait;
      await b.sql('COMMIT;');
      restore();
      assert.equal(count(x.op), 1);
    },
  );
  await run(
    'membership revoked during product-lock wait rolls back new slice transaction',
    async () => {
      setStock(products[0], 2);
      const x = argsFor(randomUUID());
      await holder.sql(
        `BEGIN;SELECT id FROM public.products WHERE id='${products[0]}' FOR UPDATE;`,
      );
      await begin(a, users[1]);
      const wait = a.sql(failing(x, '42501', 'CHECKOUT_ACCESS_DENIED'));
      wait.catch(() => {});
      await blocked(a, holder);
      revoke();
      await holder.sql('COMMIT;');
      await wait;
      await a.sql('COMMIT;');
      restore();
      assert.equal(count(x.op), 0);
      assert.equal(balance(products[0]), 2);
      assert.equal(query(`SELECT count(*) FROM public.sales WHERE operation_id='${x.op}';`), '0');
    },
  );
  await run(
    'same operation key in separate businesses has independent ledger and balance',
    async () => {
      setStock(products[0], 1);
      setStock(products[2], 1, businesses[1]);
      const op = randomUUID(),
        x = argsFor(op),
        y = argsFor(op, [products[2]], businesses[1]);
      await begin(a);
      await a.sql(pipeline(x));
      await begin(b);
      await b.sql(pipeline(y));
      await a.sql('COMMIT;');
      await b.sql('COMMIT;');
      assert.equal(balance(products[0]), 0);
      assert.equal(balance(products[2]), 0);
      assert.equal(count(op), 1);
    },
  );
  await run(
    'multi-product failure after first sufficient product creates no partial ledger/header',
    async () => {
      setStock(products[0], 1);
      setStock(products[1], 0);
      const x = argsFor(randomUUID(), [products[0], products[1]]);
      await begin(a);
      await a.sql(failing(x));
      await a.sql('COMMIT;');
      assert.equal(count(x.op), 0);
      assert.equal(balance(products[0]), 1);
      assert.equal(query(`SELECT count(*) FROM public.sales WHERE operation_id='${x.op}';`), '0');
    },
  );
  await run(
    'no purchases/expenses/appointment completion or positive payment for free test sales',
    async () => {
      assert.equal(
        query(
          `SELECT (SELECT count(*) FROM public.purchases WHERE business_id IN ('${businesses[0]}','${businesses[1]}'))+(SELECT count(*) FROM public.expenses WHERE business_id IN ('${businesses[0]}','${businesses[1]}'))+(SELECT count(*) FROM public.appointments WHERE business_id IN ('${businesses[0]}','${businesses[1]}'))+(SELECT count(*) FROM public.payments WHERE business_id IN ('${businesses[0]}','${businesses[1]}'));`,
        ),
        '0',
      );
    },
  );
  console.log(`PASS ${groups}/10 real local concurrency groups; private slice only.`);
  console.log('Committed synthetic fixtures require final local db reset.');
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const s of sessions) s.close();
  });
