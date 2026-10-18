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
      const marker = `bf215_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(() => {
        this.fail(new Error('BF215 connection command timed out'));
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
const product = randomUUID();
const category = randomUUID();
const begin = (s, actor = owners[0], isolation = '') =>
  s.sql(
    `BEGIN ${isolation};SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);`,
  );
const create = (
  op,
  cost = '1.01',
) => `private.persist_purchase('${business}','${op}','BF215 supplier','${category}',
  'BANK_TRANSFER','2026-01-01T01:30Z','  Historical notes  ','[{"productId":"${product}","quantity":1,"unitCost":"${cost}"}]')`;
const stockStage = (op, initial = false) =>
  `private.persist_purchase_stock('${business}','${op}',${initial})`;
const expenseStage = (op, initial = false) =>
  `private.persist_purchase_expense('${business}','${op}',${initial})`;
const newStages = (op, cost = '1.01', withExpense = true) => `DO $$ BEGIN
  PERFORM ${create(op, cost)};PERFORM ${stockStage(op, true)};
  ${withExpense ? `PERFORM ${expenseStage(op, true)};` : ''} END $$;`;
// Trusted-boundary simulation in test DO only. No installed public function.
const boundary = (op) => `DO $$ DECLARE initial boolean; BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('barberflow:purchase:${business}:${op}',0));
  SELECT NOT EXISTS(SELECT 1 FROM public.purchases WHERE business_id='${business}' AND operation_id='${op}') INTO initial;
  PERFORM ${create(op)};PERFORM private.persist_purchase_stock('${business}','${op}',initial);
  PERFORM private.persist_purchase_expense('${business}','${op}',initial);END $$;`;
const expectedError = (
  expression,
  state = '42501',
  detail = 'ACCESS_DENIED',
) => `DO $$ DECLARE d text;BEGIN
  BEGIN PERFORM ${expression};RAISE EXCEPTION 'Expected rejection';
  EXCEPTION WHEN SQLSTATE '${state}' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
    IF d IS DISTINCT FROM '${detail}' THEN RAISE EXCEPTION 'Wrong detail';END IF;END;END $$;`;
const membership = (active) =>
  query(
    `UPDATE public.business_members SET is_active=${active} WHERE business_id='${business}' AND user_id='${owners[1]}';`,
  );
const balance = () =>
  query(`SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id='${product}';`);
const cost = () =>
  query(`SELECT default_purchase_cost FROM public.products WHERE id='${product}';`);
const expense = (op) =>
  query(`SELECT to_jsonb(e) FROM public.expenses e JOIN public.purchases p ON p.id=e.purchase_id
  WHERE p.business_id='${business}' AND p.operation_id='${op}';`);
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
    INSERT INTO public.businesses(id,name,timezone) VALUES('${business}','BF215 concurrency','America/Argentina/Buenos_Aires');
    INSERT INTO public.business_members(business_id,user_id,role) VALUES
      ('${business}','${owners[0]}','OWNER'),('${business}','${owners[1]}','OWNER');
    INSERT INTO public.expense_categories(id,business_id,name) VALUES('${category}','${business}','BF215 category');
    INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost)
      VALUES('${product}','${business}','BF215 product',2,7);
    INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by)
      VALUES('${business}','${product}','ADJUSTMENT',10,'${owners[0]}');COMMIT;`);
  const a = await new Session().init();
  const b = await new Session().init();
  const holder = await new Session().init();
  let replay;
  await run(
    'concurrent same-key NEW/replay yields one original expense and one stock increase',
    async () => {
      replay = randomUUID();
      const before = Number(balance());
      await begin(a);
      await a.sql(boundary(replay));
      const original = await a.sql(`SELECT to_jsonb(${expenseStage(replay)});`);
      await begin(b, owners[1]);
      const waiting = b.sql(boundary(replay));
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      await waiting;
      assert.equal(await b.sql(`SELECT to_jsonb(${expenseStage(replay)});`), original);
      await b.sql('COMMIT;');
      assert.equal(Number(balance()), before + 1);
      assert.equal(expense(replay), original);
      assert.equal(JSON.parse(original).created_by, owners[0]);
      assert.equal(
        query(
          `SELECT count(*) FROM public.expenses WHERE purchase_id=(SELECT id FROM public.purchases WHERE operation_id='${replay}' AND business_id='${business}');`,
        ),
        '1',
      );
    },
  );
  await run(
    'committed purchase plus stock without expense rejects replay without repair',
    async () => {
      const op = randomUUID();
      await begin(a);
      await a.sql(newStages(op, '1.01', false));
      await a.sql('COMMIT;');
      const before = balance(),
        originalCost = cost();
      await begin(b);
      await b.sql(expectedError(expenseStage(op), '22023', 'INVALID_INPUT'));
      await b.sql('COMMIT;');
      assert.equal(expense(op), '');
      assert.equal(balance(), before);
      assert.equal(cost(), originalCost);
    },
  );
  await run(
    'committed NULL snapshots cannot be filled by a BF213 retry or expense replay',
    async () => {
      const op = randomUUID();
      await begin(a);
      await a.sql(newStages(op));
      await a.sql('COMMIT;');
      const original = expense(op),
        before = balance();
      query(
        `UPDATE public.purchases SET expense_category_id=NULL,payment_method=NULL WHERE business_id='${business}' AND operation_id='${op}';`,
      );
      await begin(b);
      await b.sql(`SELECT ${create(op, '8.88')};`);
      await b.sql(expectedError(expenseStage(op), '22023', 'INVALID_INPUT'));
      await b.sql('COMMIT;');
      assert.equal(
        query(
          `SELECT expense_category_id IS NULL AND payment_method IS NULL FROM public.purchases WHERE business_id='${business}' AND operation_id='${op}';`,
        ),
        't',
      );
      assert.equal(expense(op), original);
      assert.equal(balance(), before);
    },
  );
  await run(
    'two purchases serialize stock/cost and expense amounts as a single transaction each',
    async () => {
      const first = randomUUID(),
        second = randomUUID(),
        before = Number(balance());
      await begin(a);
      await a.sql(newStages(first, '3.00'));
      await begin(b);
      const waiting = b.sql(newStages(second, '4.00'));
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      await waiting;
      await b.sql('COMMIT;');
      assert.equal(Number(balance()), before + 2);
      assert.equal(cost(), '4.00');
      assert.equal(JSON.parse(expense(first)).amount, 3);
      assert.equal(JSON.parse(expense(second)).amount, 4);
    },
  );
  await run(
    'timezone change waits for completion and replay preserves the original civil date',
    async () => {
      const op = randomUUID();
      await begin(a);
      await a.sql(newStages(op));
      await begin(b);
      const waiting = b.sql(
        `UPDATE public.businesses SET timezone='Pacific/Kiritimati' WHERE id='${business}';`,
      );
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      await waiting;
      await b.sql('COMMIT;');
      assert.equal(JSON.parse(expense(op)).expense_date, '2025-12-31');
      await begin(a);
      assert.equal(
        JSON.parse(await a.sql(`SELECT to_jsonb(${expenseStage(op)});`)).expense_date,
        '2025-12-31',
      );
      await a.sql('COMMIT;');
    },
  );
  await run('OWNER revoked during operation wait cannot read expense history', async () => {
    await begin(a);
    await a.sql(`SELECT to_jsonb(${expenseStage(replay)});`);
    await begin(b, owners[1]);
    const waiting = b.sql(expectedError(expenseStage(replay)));
    waiting.catch(() => {});
    await blocked(b, a);
    membership(false);
    await a.sql('COMMIT;');
    await waiting;
    await b.sql('COMMIT;');
    membership(true);
  });
  await run('OWNER revoked during parent wait cannot read expense history', async () => {
    await holder.sql(
      `BEGIN;SELECT id FROM public.purchases WHERE business_id='${business}' AND operation_id='${replay}' FOR UPDATE;`,
    );
    await begin(a, owners[1]);
    const waiting = a.sql(expectedError(expenseStage(replay)));
    waiting.catch(() => {});
    await blocked(a, holder);
    membership(false);
    await holder.sql('ROLLBACK;');
    await waiting;
    await a.sql('COMMIT;');
    membership(true);
  });
  await run(
    'OWNER revoked during product wait is rechecked by retained BF214 validation',
    async () => {
      await holder.sql(`BEGIN;SELECT id FROM public.products WHERE id='${product}' FOR UPDATE;`);
      await begin(a, owners[1]);
      const waiting = a.sql(expectedError(expenseStage(replay)));
      waiting.catch(() => {});
      await blocked(a, holder);
      membership(false);
      await holder.sql('ROLLBACK;');
      await waiting;
      await a.sql('COMMIT;');
      membership(true);
    },
  );
  await run('OWNER revoked during category wait cannot return the expense', async () => {
    await holder.sql(
      `BEGIN;UPDATE public.expense_categories SET name='Category lock' WHERE id='${category}';`,
    );
    await begin(a, owners[1]);
    const waiting = a.sql(expectedError(expenseStage(replay)));
    waiting.catch(() => {});
    await blocked(a, holder);
    membership(false);
    await holder.sql('ROLLBACK;');
    await waiting;
    await a.sql('COMMIT;');
    membership(true);
  });
  await run('OWNER revoked during expense row wait cannot return its contents', async () => {
    const original = expense(replay);
    await holder.sql(
      `BEGIN;SELECT id FROM public.expenses WHERE purchase_id=(SELECT id FROM public.purchases WHERE business_id='${business}' AND operation_id='${replay}') FOR UPDATE;`,
    );
    await begin(a, owners[1]);
    const waiting = a.sql(expectedError(expenseStage(replay)));
    waiting.catch(() => {});
    await blocked(a, holder);
    membership(false);
    await holder.sql('ROLLBACK;');
    await waiting;
    await a.sql('COMMIT;');
    membership(true);
    assert.equal(expense(replay), original);
  });
  await run(
    'checkout observes stock only after the complete expense transaction commits',
    async () => {
      const op = randomUUID(),
        before = Number(balance());
      await begin(a);
      await a.sql(newStages(op));
      await begin(b);
      const waiting = b.sql(
        `SELECT current_stock FROM private.lock_checkout_products('${business}',ARRAY['${product}'::uuid],ARRAY[${before + 1}]);`,
      );
      waiting.catch(() => {});
      await blocked(b, a);
      await a.sql('COMMIT;');
      assert.equal(await waiting, String(before + 1));
      await b.sql('ROLLBACK;');
      assert.notEqual(expense(op), '');
    },
  );
  await run('adjust_stock shares the product anchor through expense completion', async () => {
    const op = randomUUID(),
      before = Number(balance());
    await begin(a);
    await a.sql(newStages(op));
    await begin(b);
    const waiting = b.sql(
      `SELECT public.adjust_stock('${business}','${randomUUID()}','${product}',-1,'LOSS',NULL);`,
    );
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql('COMMIT;');
    await waiting;
    await b.sql('ROLLBACK;');
    assert.equal(Number(balance()), before + 1);
    assert.notEqual(expense(op), '');
  });
  await run(
    'rollback removes all three stages including context snapshots and reference cost',
    async () => {
      const op = randomUUID(),
        before = balance(),
        originalCost = cost();
      await begin(a);
      await a.sql(newStages(op, '12.34'));
      await a.sql('ROLLBACK;');
      assert.equal(expense(op), '');
      assert.equal(balance(), before);
      assert.equal(cost(), originalCost);
      assert.equal(
        query(
          `SELECT count(*) FROM public.purchases WHERE business_id='${business}' AND operation_id='${op}';`,
        ),
        '0',
      );
    },
  );
  await run('stale transaction isolation rejects before expense effects', async () => {
    await begin(a, owners[0], 'ISOLATION LEVEL REPEATABLE READ');
    await a.sql(`DO $$ BEGIN BEGIN PERFORM ${expenseStage(replay)};RAISE EXCEPTION 'Expected conflict';
      EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;END $$;`);
    await a.sql('ROLLBACK;');
  });
  console.log(
    `BF215 concurrency ${groups}/${groups} PASS; final local reset removes synthetic fixtures.`,
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(sessions.map((s) => s.close()));
  });
