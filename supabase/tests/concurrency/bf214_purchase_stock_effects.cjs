// Local PostgreSQL only. The final authorized local reset removes synthetic
// committed fixtures. This harness is not a public purchase orchestrator.
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
    this.child.stderr.on('data', (c) => {
      this.errors += c;
    });
    this.child.stdout.on('data', (c) => {
      this.buffer += c;
      if (this.pending && this.buffer.includes(this.pending.marker + '\n')) {
        const p = this.pending;
        this.pending = null;
        clearTimeout(p.timer);
        const result = this.buffer.slice(0, this.buffer.indexOf(p.marker)).trim();
        this.buffer = '';
        p.resolve(result);
      }
    });
    this.child.on('error', (e) => this.fail(e));
    this.child.on('exit', (code) => this.fail(new Error(`psql exit ${code}: ${this.errors}`)));
    sessions.push(this);
  }
  fail(error) {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    p.reject(error);
  }
  sql(sql) {
    assert.equal(this.pending, null);
    return new Promise((resolve, reject) => {
      const marker = `bf214_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(() => {
        this.fail(new Error('BF214 connection command timed out'));
        this.child.kill();
      }, 16000);
      this.pending = { marker, timer, resolve, reject };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }
  async init() {
    this.pid = Number(await this.sql('SELECT pg_backend_pid();'));
    await this.sql("SET statement_timeout='12s';SET lock_timeout='10s';");
    return this;
  }
  async close() {
    if (this.child.exitCode !== null) return;
    const done = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.stdin.end('ROLLBACK;\n\\q\n');
    await done;
  }
}
const business = randomUUID();
const owners = [randomUUID(), randomUUID()];
const products = [randomUUID(), randomUUID()].sort();
const category = randomUUID();
const begin = (s, actor = owners[0], isolation = '') =>
  s.sql(
    `BEGIN ${isolation};SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);`,
  );
const create = (op, cost = '1.01', ids = [products[0]], quantity = 1, date = '2026-01-01Z') =>
  `private.persist_purchase('${business}','${op}','BF214 supplier','${category}','CASH','${date}',NULL,'${JSON.stringify(
    ids.map((productId) => ({ productId, quantity, unitCost: cost })),
  )}')`;
const effects = (op, initial = false) =>
  `private.persist_purchase_stock('${business}','${op}',${initial})`;
const newPurchase = (op, cost = '1.01', ids = [products[0]], quantity = 1, date = '2026-01-01Z') =>
  `DO $$ BEGIN PERFORM ${create(op, cost, ids, quantity, date)};PERFORM ${effects(op, true)};END $$;`;
// Test-only example of the trusted boundary: determine NEW vs REPLAY under
// the same advisory lock BEFORE BF213. No SQL function is installed for this.
const boundary = (op) => `DO $$ DECLARE initial boolean; BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('barberflow:purchase:${business}:${op}',0));
  SELECT NOT EXISTS(SELECT 1 FROM public.purchases WHERE business_id='${business}' AND operation_id='${op}') INTO initial;
  PERFORM ${create(op)};PERFORM private.persist_purchase_stock('${business}','${op}',initial);
END $$;`;
const expectError = (
  expression,
  state = '42501',
  detail = 'ACCESS_DENIED',
) => `DO $$ DECLARE d text; BEGIN
  BEGIN PERFORM ${expression};RAISE EXCEPTION 'Expected rejection';
  EXCEPTION WHEN SQLSTATE '${state}' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
    IF d IS DISTINCT FROM '${detail}' THEN RAISE EXCEPTION 'Wrong error detail'; END IF;
  END; END $$;`;
const stock = () =>
  Number(
    query(
      `SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id='${products[0]}';`,
    ),
  );
const parentCount = (op) =>
  Number(
    query(
      `SELECT count(*) FROM public.purchases WHERE business_id='${business}' AND operation_id='${op}';`,
    ),
  );
const cost = () =>
  query(`SELECT default_purchase_cost FROM public.products WHERE id='${products[0]}';`);
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
    INSERT INTO public.businesses(id,name) VALUES('${business}','BF214 concurrency');
    INSERT INTO public.business_members(business_id,user_id,role) VALUES
      ('${business}','${owners[0]}','OWNER'),('${business}','${owners[1]}','OWNER');
    INSERT INTO public.expense_categories(id,business_id,name) VALUES('${category}','${business}','BF214 category');
    ${products
      .map(
        (id) => `INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost)
      VALUES('${id}','${business}','BF214 product',2,7);
      INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by)
      VALUES('${business}','${id}','ADJUSTMENT',10,'${owners[0]}');`,
      )
      .join('\n')}
    COMMIT;`);
  const a = await new Session().init();
  const b = await new Session().init();
  const holder = await new Session().init();
  let replayOp;
  await run(
    'concurrent same operation derives replay internally and applies effects exactly once',
    async () => {
      replayOp = randomUUID();
      const before = stock();
      await begin(a);
      await a.sql(boundary(replayOp));
      const original = await a.sql(
        `SELECT jsonb_agg(to_jsonb(m) ORDER BY occurred_at,id) FROM ${effects(replayOp)} m;`,
      );
      await begin(b, owners[1]);
      const waiting = b.sql(boundary(replayOp));
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      await waiting;
      assert.equal(
        await b.sql(
          `SELECT jsonb_agg(to_jsonb(m) ORDER BY occurred_at,id) FROM ${effects(replayOp)} m;`,
        ),
        original,
      );
      await b.sql('COMMIT;');
      assert.equal(stock(), before + 1);
      assert.equal(parentCount(replayOp), 1);
    },
  );
  await run(
    'committed header/items without effects rejects replay without backfill or cost mutation',
    async () => {
      const op = randomUUID(),
        before = stock(),
        originalCost = cost();
      await begin(a);
      await a.sql(`SELECT ${create(op)};`);
      await a.sql('COMMIT;');
      await begin(b);
      await b.sql(expectError(effects(op), '22023', 'INVALID_INPUT'));
      await b.sql('COMMIT;');
      assert.equal(parentCount(op), 1);
      assert.equal(stock(), before);
      assert.equal(cost(), originalCost);
    },
  );
  await run(
    'two purchases serialize reference costs by application despite backdated purchased_at',
    async () => {
      const first = randomUUID(),
        second = randomUUID(),
        before = stock();
      await begin(a);
      await a.sql(newPurchase(first, '3.00', products, 1, '2050-01-01Z'));
      await begin(b);
      const waiting = b.sql(newPurchase(second, '4.00', [...products].reverse(), 1, '1990-01-01Z'));
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      await waiting;
      await b.sql('COMMIT;');
      assert.equal(stock(), before + 2);
      assert.equal(cost(), '4.00');
      await begin(a);
      await a.sql(`SELECT count(*) FROM ${effects(first)};`);
      await a.sql('COMMIT;');
      assert.equal(cost(), '4.00');
    },
  );
  await run(
    'BF214 replay itself locks lower UUID before waiting for the higher product',
    async () => {
      const op = randomUUID();
      await begin(a);
      await a.sql(newPurchase(op, '4.00', products));
      await a.sql('COMMIT;');
      await holder.sql(
        `BEGIN;SELECT id FROM public.products WHERE id='${products[1]}' FOR UPDATE;`,
      );
      await begin(a);
      const waiting = a.sql(`SELECT count(*) FROM ${effects(op)};`);
      waiting.catch(() => {});
      await blocked(a, holder);
      await begin(b);
      const lower = b.sql(`SELECT id FROM public.products WHERE id='${products[0]}' FOR UPDATE;`);
      lower.catch(() => {});
      await blocked(b, a);
      await holder.sql('ROLLBACK;');
      await waiting;
      await a.sql('COMMIT;');
      await lower;
      await b.sql('ROLLBACK;');
    },
  );
  await run(
    'checkout waits and reads newly committed PURCHASE stock on the same product anchor',
    async () => {
      const op = randomUUID(),
        before = stock();
      await begin(a);
      await a.sql(newPurchase(op, '5.00', [products[0]], 5));
      await begin(b);
      const waiting = b.sql(
        `SELECT current_stock FROM private.lock_checkout_products('${business}',ARRAY['${products[0]}'::uuid],ARRAY[${before + 5}]);`,
      );
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      assert.equal(await waiting, String(before + 5));
      await b.sql('ROLLBACK;');
    },
  );
  await run('real adjustment waits and its final balance includes the PURCHASE', async () => {
    const op = randomUUID(),
      before = stock();
    await begin(a);
    await a.sql(newPurchase(op, '6.00', [products[0]], 2));
    await begin(b);
    const waiting = b.sql(
      `SELECT public.adjust_stock('${business}','${randomUUID()}','${products[0]}',-${before + 1},'LOSS',NULL);`,
    );
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql('COMMIT;');
    await waiting;
    assert.equal(
      await b.sql(
        `SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id='${products[0]}';`,
      ),
      '1',
    );
    await b.sql('ROLLBACK;');
    assert.equal(stock(), before + 2);
  });
  await run(
    'later checkout snapshots use new reference while older sale items stay unchanged',
    async () => {
      const saleOps = [randomUUID(), randomUUID()],
        oldCost = cost();
      const snapshot = (op) => `DO $$ BEGIN
      PERFORM private.persist_checkout_sale('${business}','${op}',NULL,NULL,2,0,2);
      PERFORM private.persist_checkout_items('${business}','${op}','[{"itemType":"PRODUCT","itemId":"${products[0]}","quantity":1}]');
    END $$;`;
      await begin(a);
      await a.sql(snapshot(saleOps[0]));
      await a.sql('COMMIT;');
      const oldRows = query(
        `SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.operation_id='${saleOps[0]}';`,
      );
      await begin(a);
      await a.sql(newPurchase(randomUUID(), '8.25'));
      await a.sql('COMMIT;');
      await begin(b);
      await b.sql(snapshot(saleOps[1]));
      await b.sql('COMMIT;');
      assert.equal(
        query(
          `SELECT i.unit_cost_snapshot FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.operation_id='${saleOps[1]}';`,
        ),
        '8.25',
      );
      assert.equal(
        query(
          `SELECT i.unit_cost_snapshot FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.operation_id='${saleOps[0]}';`,
        ),
        oldCost,
      );
      assert.equal(
        query(
          `SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.operation_id='${saleOps[0]}';`,
        ),
        oldRows,
      );
    },
  );
  await run('OWNER revoked during operation lock wait cannot read replay', async () => {
    await begin(a);
    await a.sql(`SELECT count(*) FROM ${effects(replayOp)};`);
    await begin(b, owners[1]);
    const waiting = b.sql(expectError(effects(replayOp)));
    waiting.catch(() => {});
    await blocked(b, a);
    membership(false);
    await a.sql('COMMIT;');
    await waiting;
    await b.sql('COMMIT;');
    membership(true);
  });
  await run('OWNER revoked during parent row wait cannot read replay', async () => {
    await holder.sql(
      `BEGIN;SELECT id FROM public.purchases WHERE business_id='${business}' AND operation_id='${replayOp}' FOR UPDATE;`,
    );
    await begin(a, owners[1]);
    const waiting = a.sql(expectError(effects(replayOp)));
    waiting.catch(() => {});
    await blocked(a, holder);
    membership(false);
    await holder.sql('ROLLBACK;');
    await waiting;
    await a.sql('COMMIT;');
    membership(true);
  });
  await run(
    'OWNER revoked during BF214 product wait cannot read replay or mutate cost',
    async () => {
      const before = stock(),
        originalCost = cost();
      await holder.sql(
        `BEGIN;SELECT id FROM public.products WHERE id='${products[0]}' FOR UPDATE;`,
      );
      await begin(a, owners[1]);
      const waiting = a.sql(expectError(effects(replayOp)));
      waiting.catch(() => {});
      await blocked(a, holder);
      membership(false);
      await holder.sql('ROLLBACK;');
      await waiting;
      await a.sql('COMMIT;');
      membership(true);
      assert.equal(stock(), before);
      assert.equal(cost(), originalCost);
    },
  );
  await run('archive during new purchase product wait rejects the entire operation', async () => {
    const op = randomUUID(),
      before = stock();
    await holder.sql(`BEGIN;UPDATE public.products SET is_active=false WHERE id='${products[0]}';`);
    await begin(a);
    const waiting = a.sql(expectError(create(op), '22023', 'INVALID_INPUT'));
    waiting.catch(() => {});
    await blocked(a, holder);
    await holder.sql('COMMIT;');
    await waiting;
    await a.sql('COMMIT;');
    assert.equal(parentCount(op), 0);
    assert.equal(stock(), before);
    query(`UPDATE public.products SET is_active=true WHERE id='${products[0]}';`);
  });
  await run(
    'rollback after effects removes parent/items/ledger and restores reference cost',
    async () => {
      const op = randomUUID(),
        before = stock(),
        originalCost = cost();
      await begin(a);
      await a.sql(newPurchase(op, '11.00'));
      await a.sql('ROLLBACK;');
      assert.equal(parentCount(op), 0);
      assert.equal(stock(), before);
      assert.equal(cost(), originalCost);
    },
  );
  await run('stale transaction isolation fails before any effect', async () => {
    await begin(a, owners[0], 'ISOLATION LEVEL REPEATABLE READ');
    await a.sql(`DO $$ BEGIN BEGIN PERFORM ${effects(replayOp)};RAISE EXCEPTION 'Expected isolation rejection';
      EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;END $$;`);
    await a.sql('ROLLBACK;');
  });
  console.log(
    `BF214 concurrency ${groups}/${groups} PASS; final local reset removes synthetic fixtures.`,
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(sessions.map((s) => s.close()));
  });
