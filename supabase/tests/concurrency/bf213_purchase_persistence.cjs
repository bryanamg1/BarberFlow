// Real local PostgreSQL only. Synthetic committed fixtures are removed by the
// authorized final db reset before the complete DB suite. No remote requests.
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
  execFileSync('docker', args, {
    input: sql,
    encoding: 'utf8',
    timeout: 15000,
  }).trim();
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
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code) => this.fail(new Error(`psql exit ${code}: ${this.errors}`)));
    sessions.push(this);
  }
  fail(error) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  sql(sql) {
    assert.equal(this.pending, null, 'one outstanding command per connection');
    return new Promise((resolve, reject) => {
      const marker = `bf213_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(() => {
        this.fail(new Error('BF213 connection command timed out'));
        this.child.kill();
      }, 16000);
      this.pending = { marker, timer, resolve, reject };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }
  async init() {
    this.pid = Number(await this.sql('SELECT pg_backend_pid();'));
    await this.sql("SET statement_timeout='12s'; SET lock_timeout='10s';");
    return this;
  }
  async close() {
    if (this.child.exitCode !== null) return;
    const exited = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.stdin.end('ROLLBACK;\n\\q\n');
    await exited;
  }
}
const business = randomUUID();
const owners = [randomUUID(), randomUUID()];
const products = [randomUUID(), randomUUID()].sort();
const category = randomUUID();
const begin = (s, actor = owners[0]) =>
  s.sql(
    `BEGIN; SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);`,
  );
const call = (op, ids = [products[0]]) =>
  `private.persist_purchase('${business}','${op}','BF213 supplier','${category}','CASH',` +
  `'2026-01-01T00:00:00Z',NULL,'${JSON.stringify(
    ids.map((productId) => ({
      productId,
      quantity: 1,
      unitCost: '1.01',
    })),
  )}')`;
const denied = (expression) => `DO $$ DECLARE d text; BEGIN
  BEGIN PERFORM ${expression}; RAISE EXCEPTION 'Expected denial';
  EXCEPTION WHEN SQLSTATE '42501' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
    IF d IS DISTINCT FROM 'ACCESS_DENIED' THEN RAISE EXCEPTION 'Wrong normalized denial'; END IF;
  END; END $$;`;
const count = (op) =>
  Number(
    query(
      `SELECT count(*) FROM public.purchases WHERE business_id='${business}' AND operation_id='${op}';`,
    ),
  );
const membership = (active) =>
  query(
    `UPDATE public.business_members SET is_active=${active} WHERE business_id='${business}' AND user_id='${owners[1]}';`,
  );
const blocked = async (waiter, holder) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (query(`SELECT ${holder.pid}=ANY(pg_blocking_pids(${waiter.pid}));`) === 't') return;
    await delay(30);
  }
  throw new Error('Expected PostgreSQL blocking not observed');
};
let groups = 0;
const run = async (name, fn) => {
  await fn();
  groups++;
  console.log(`PASS ${name}`);
};
(async () => {
  query(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${owners[0]}'),('${owners[1]}');
    INSERT INTO public.businesses(id,name) VALUES('${business}','BF213 concurrency');
    INSERT INTO public.business_members(business_id,user_id,role) VALUES
      ('${business}','${owners[0]}','OWNER'),('${business}','${owners[1]}','OWNER');
    INSERT INTO public.expense_categories(id,business_id,name) VALUES('${category}','${business}','BF213 category');
    ${products
      .map(
        (id) => `INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost)
      VALUES('${id}','${business}','BF213 product',2,7);
      INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by)
      VALUES('${business}','${id}','PURCHASE',10,'${owners[0]}');`,
      )
      .join('\n')}
    COMMIT;`);
  const a = await new Session().init();
  const b = await new Session().init();
  const holder = await new Session().init();
  let replayOperation;
  await run(
    'concurrent same-key replay returns the same persisted header/items exactly once',
    async () => {
      replayOperation = randomUUID();
      await begin(a);
      const original = JSON.parse(await a.sql(`SELECT ${call(replayOperation)};`));
      await begin(b, owners[1]);
      const waiting = b.sql(`SELECT ${call(replayOperation)};`);
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      assert.deepEqual(JSON.parse(await waiting), original);
      await b.sql('COMMIT;');
      assert.equal(count(replayOperation), 1);
      assert.equal(
        query(
          `SELECT count(*) FROM public.purchase_items WHERE purchase_id='${original.purchase.id}';`,
        ),
        '1',
      );
    },
  );
  await run(
    'different operations with inverted product input serialize without duplicate effects',
    async () => {
      const first = randomUUID(),
        second = randomUUID();
      await begin(a);
      await a.sql(`SELECT ${call(first, [...products].reverse())};`);
      await begin(b);
      const waiting = b.sql(`SELECT ${call(second, products)};`);
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      assert.equal(JSON.parse(await waiting).items.length, 2);
      await b.sql('COMMIT;');
      assert.equal(count(first), 1);
      assert.equal(count(second), 1);
      assert.equal(
        query(
          `SELECT count(*) FROM public.products WHERE business_id='${business}' AND default_purchase_cost=7;`,
        ),
        '2',
      );
    },
  );
  await run('sorted product anchors are acquired before waiting on the higher UUID', async () => {
    await holder.sql(`BEGIN;SELECT id FROM public.products WHERE id='${products[1]}' FOR UPDATE;`);
    await begin(a);
    const purchase = a.sql(`SELECT ${call(randomUUID(), [...products].reverse())};`);
    purchase.catch(() => {});
    await blocked(a, holder);
    await begin(b);
    const lower = b.sql(`SELECT id FROM public.products WHERE id='${products[0]}' FOR UPDATE;`);
    lower.catch(() => {});
    await blocked(b, a);
    await holder.sql('ROLLBACK;');
    await purchase;
    await a.sql('COMMIT;');
    await lower;
    await b.sql('ROLLBACK;');
  });
  await run('checkout waits on the same product row without purchase debiting stock', async () => {
    await begin(a);
    await a.sql(`SELECT ${call(randomUUID())};`);
    await begin(b);
    const waiting = b.sql(
      `SELECT current_stock FROM private.lock_checkout_products('${business}',ARRAY['${products[0]}'::uuid],ARRAY[1]);`,
    );
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql('COMMIT;');
    assert.equal(await waiting, '10');
    await b.sql('ROLLBACK;');
  });
  await run('real adjust_stock also waits on the purchase anchor', async () => {
    await begin(a);
    await a.sql(`SELECT ${call(randomUUID())};`);
    await begin(b);
    const waiting = b.sql(
      `SELECT public.adjust_stock('${business}','${randomUUID()}','${products[0]}',-1,'LOSS',NULL);`,
    );
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql('COMMIT;');
    await waiting;
    // Roll back the test adjustment: BF213 itself never changes the ledger.
    await b.sql('ROLLBACK;');
    assert.equal(
      query(
        `SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id='${products[0]}';`,
      ),
      '10',
    );
  });
  await run('loss of OWNER while waiting for operation replay denies all history', async () => {
    const op = randomUUID();
    await begin(a);
    await a.sql(`SELECT ${call(op)};`);
    await begin(b, owners[1]);
    const waiting = b.sql(denied(call(op)));
    waiting.catch(() => {});
    await blocked(b, a);
    membership(false);
    await a.sql('COMMIT;');
    await waiting;
    await b.sql('COMMIT;');
    membership(true);
    assert.equal(count(op), 1);
  });
  await run('loss of OWNER after existing-parent lock wait denies replay', async () => {
    await holder.sql(
      `BEGIN;SELECT id FROM public.purchases WHERE operation_id='${replayOperation}' FOR UPDATE;`,
    );
    await begin(a, owners[1]);
    const waiting = a.sql(denied(call(replayOperation)));
    waiting.catch(() => {});
    await blocked(a, holder);
    membership(false);
    await holder.sql('ROLLBACK;');
    await waiting;
    await a.sql('COMMIT;');
    membership(true);
  });
  await run('loss of OWNER during product wait leaves no orphan purchase', async () => {
    const op = randomUUID();
    await holder.sql(`BEGIN;SELECT id FROM public.products WHERE id='${products[0]}' FOR UPDATE;`);
    await begin(a, owners[1]);
    const waiting = a.sql(denied(call(op)));
    waiting.catch(() => {});
    await blocked(a, holder);
    membership(false);
    await holder.sql('ROLLBACK;');
    await waiting;
    await a.sql('COMMIT;');
    membership(true);
    assert.equal(count(op), 0);
  });
  await run('catalog archive while waiting is rejected without partial persistence', async () => {
    const op = randomUUID();
    await holder.sql(`BEGIN;UPDATE public.products SET is_active=false WHERE id='${products[0]}';`);
    await begin(a);
    const waiting = a.sql(`DO $$ DECLARE d text; BEGIN
      BEGIN PERFORM ${call(op)};RAISE EXCEPTION 'Expected invalid product';
      EXCEPTION WHEN SQLSTATE '22023' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
        IF d IS DISTINCT FROM 'INVALID_INPUT' THEN RAISE EXCEPTION 'Wrong invalid input signal';END IF;
      END;END $$;`);
    waiting.catch(() => {});
    await blocked(a, holder);
    await holder.sql('COMMIT;');
    await waiting;
    await a.sql('COMMIT;');
    assert.equal(count(op), 0);
    query(`UPDATE public.products SET is_active=true WHERE id='${products[0]}';`);
  });
  await run('category archived during its lock wait is rejected safely', async () => {
    const op = randomUUID();
    await holder.sql(
      `BEGIN;UPDATE public.expense_categories SET is_active=false WHERE id='${category}';`,
    );
    await begin(a);
    const waiting = a.sql(`DO $$ DECLARE d text; BEGIN
      BEGIN PERFORM ${call(op)};RAISE EXCEPTION 'Expected invalid category';
      EXCEPTION WHEN SQLSTATE '22023' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
        IF d IS DISTINCT FROM 'INVALID_INPUT' THEN RAISE EXCEPTION 'Wrong invalid input signal';END IF;
      END;END $$;`);
    waiting.catch(() => {});
    await blocked(a, holder);
    await holder.sql('COMMIT;');
    await waiting;
    await a.sql('COMMIT;');
    assert.equal(count(op), 0);
    query(`UPDATE public.expense_categories SET is_active=true WHERE id='${category}';`);
  });
  await run('loss of OWNER during category wait prevents persistence', async () => {
    const op = randomUUID();
    await holder.sql(
      `BEGIN;SELECT id FROM public.expense_categories WHERE id='${category}' FOR UPDATE;`,
    );
    await begin(a, owners[1]);
    const waiting = a.sql(denied(call(op)));
    waiting.catch(() => {});
    await blocked(a, holder);
    membership(false);
    await holder.sql('ROLLBACK;');
    await waiting;
    await a.sql('COMMIT;');
    membership(true);
    assert.equal(count(op), 0);
  });
  await run(
    'loss of OWNER during currency-trigger wait rolls back the inserted header',
    async () => {
      const op = randomUUID();
      await holder.sql(
        `BEGIN;SELECT id FROM public.businesses WHERE id='${business}' FOR NO KEY UPDATE;`,
      );
      await begin(a, owners[1]);
      const waiting = a.sql(denied(call(op)));
      waiting.catch(() => {});
      await blocked(a, holder);
      membership(false);
      await holder.sql('ROLLBACK;');
      await waiting;
      await a.sql('COMMIT;');
      membership(true);
      assert.equal(count(op), 0);
    },
  );
  console.log(
    `BF213 concurrency ${groups}/${groups} PASS; run final local reset to remove synthetic fixtures.`,
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(sessions.map((session) => session.close()));
  });
