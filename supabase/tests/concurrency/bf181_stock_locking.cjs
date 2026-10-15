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
      const marker = `bf181_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(
        () => reject(new Error('BF181 connection command timed out')),
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
const user = randomUUID();
const products = Array.from({ length: 20 }, () => randomUUID());
const claim = `SELECT set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true);`;
const ids = (values) => `ARRAY[${values.map((id) => `'${id}'::uuid`).join(',')}]`;
const helper = (indexes, quantities) =>
  `SELECT * FROM private.lock_checkout_products('${business}',${ids(indexes.map((i) => products[i]))},ARRAY[${quantities.join(',')}]);`;
const sale = (index, quantity) =>
  `INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES('${business}','${products[index]}','SALE',-${quantity},'${user}');`;
const stock = (index) =>
  Number(
    query(
      `SELECT coalesce(sum(quantity_delta),0) FROM public.stock_movements WHERE business_id='${business}' AND product_id='${products[index]}';`,
    ),
  );
const expect = (statement, code, detail) =>
  `DO $$ DECLARE actual text; BEGIN ${statement} RAISE EXCEPTION 'Expected ${code}'; EXCEPTION WHEN SQLSTATE '${code}' THEN GET STACKED DIAGNOSTICS actual=PG_EXCEPTION_DETAIL; IF actual IS DISTINCT FROM '${detail}' THEN RAISE EXCEPTION 'Unexpected domain detail'; END IF; END $$;`;
const begin = (s) => s.sql(`BEGIN; ${claim}`);
const blocked = async (waiter, holder) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (query(`SELECT ${holder.pid}=ANY(pg_blocking_pids(${waiter.pid}));`) === 't') return;
    await delay(30);
  }
  throw new Error('Expected PostgreSQL blocking relationship not observed');
};
const run = async (name, fn) => {
  await fn();
  console.log(`PASS ${name}`);
};

(async () => {
  query(
    `BEGIN; INSERT INTO auth.users(id) VALUES('${user}'); INSERT INTO public.businesses(id,name) VALUES('${business}','BF181 concurrency'); INSERT INTO public.business_members(business_id,user_id,role) VALUES('${business}','${user}','OWNER'); ${products.map((id, i) => `INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES('${id}','${business}','BF181 concurrency ${i}',10,4); ${i === 12 ? '' : `INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES('${business}','${id}','PURCHASE',10,'${user}');`}`).join('\n')} COMMIT;`,
  );
  const a = await new Session().init();
  const b = await new Session().init();
  const holder = await new Session().init();
  await run('same product: wait, fresh balance, two sufficient fixture sales', async () => {
    await begin(a);
    await a.sql(helper([0], [4]));
    await begin(b);
    const waiting = b.sql(helper([0], [4]));
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql(sale(0, 4) + 'COMMIT;');
    assert.match(await waiting, /\|4\|6$/);
    await b.sql(sale(0, 4) + 'COMMIT;');
    assert.equal(stock(0), 2);
  });
  await run('same product: second sale rejects after first consumes stock', async () => {
    await begin(a);
    await a.sql(helper([1], [7]));
    await begin(b);
    const waiting = b.sql(expect(helper([1], [7]), 'PT409', 'INSUFFICIENT_STOCK'));
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql(sale(1, 7) + 'COMMIT;');
    await waiting;
    await b.sql('COMMIT;');
    assert.equal(stock(1), 3);
    assert.equal(
      query(
        `SELECT count(*) FROM public.stock_movements WHERE product_id='${products[1]}' AND type='SALE';`,
      ),
      '1',
    );
  });
  await run('different products do not block each other', async () => {
    await begin(a);
    await a.sql(helper([2], [1]));
    await begin(b);
    assert.match(await b.sql(helper([3], [1])), /\|1\|10$/);
    assert.equal(query(`SELECT cardinality(pg_blocking_pids(${b.pid}));`), '0');
    await a.sql('ROLLBACK;');
    await b.sql('ROLLBACK;');
  });
  await run('reversed inputs acquire sorted anchors; no deadlock cycle', async () => {
    const ordered = [4, 5].sort((x, y) => products[x].localeCompare(products[y]));
    await holder.sql(
      `BEGIN; SELECT id FROM public.products WHERE id='${products[ordered[1]]}' FOR UPDATE;`,
    );
    await begin(a);
    const first = a.sql(helper([...ordered].reverse(), [1, 1]));
    first.catch(() => {});
    await blocked(a, holder);
    await begin(b);
    const second = b.sql(helper(ordered, [1, 1]));
    second.catch(() => {});
    await blocked(b, a); // A must own the lower UUID even though caller sent it last.
    await holder.sql('COMMIT;');
    await first;
    await a.sql('COMMIT;');
    await second;
    await b.sql('COMMIT;');
    assert.equal(stock(4), 10);
    assert.equal(stock(5), 10);
  });
  await run('rollback releases locks and rolls back fixture ledger writes', async () => {
    await begin(a);
    await a.sql(helper([6], [7]) + sale(6, 7));
    await begin(b);
    const waiting = b.sql(helper([6], [6]));
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql('ROLLBACK;');
    assert.match(await waiting, /\|6\|10$/);
    await b.sql('ROLLBACK;');
    assert.equal(stock(6), 10);
  });
  await run('commit releases locks even without ledger writes', async () => {
    await begin(a);
    await a.sql(helper([7], [1]));
    await begin(b);
    const waiting = b.sql(helper([7], [1]));
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql('COMMIT;');
    await waiting;
    await b.sql('COMMIT;');
    assert.equal(stock(7), 10);
  });
  await run('sale versus real adjust_stock uses the same anchor', async () => {
    await begin(a);
    await a.sql(helper([8], [7]));
    await begin(b);
    const adjustment = `PERFORM public.adjust_stock('${business}','${randomUUID()}','${products[8]}',-5,'LOSS',NULL);`;
    const waiting = b.sql(expect(adjustment, 'PT409', 'INSUFFICIENT_STOCK'));
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql(sale(8, 7) + 'COMMIT;');
    await waiting;
    await b.sql('COMMIT;');
    assert.equal(stock(8), 3);
  });
  await run('real adjust_stock versus sale refreshes the post-lock snapshot', async () => {
    await begin(b);
    await b.sql(
      `SELECT public.adjust_stock('${business}','${randomUUID()}','${products[9]}',-6,'LOSS',NULL);`,
    );
    await begin(a);
    const waiting = a.sql(expect(helper([9], [5]), 'PT409', 'INSUFFICIENT_STOCK'));
    waiting.catch(() => {});
    await blocked(a, b);
    await b.sql('COMMIT;');
    await waiting;
    await a.sql('COMMIT;');
    assert.equal(stock(9), 4);
  });
  await run('archive during lock wait is rejected without historical mutation', async () => {
    await a.sql(`BEGIN; UPDATE public.products SET is_active=false WHERE id='${products[10]}';`);
    await begin(b);
    const waiting = b.sql(expect(helper([10], [1]), '22023', 'INVALID_CHECKOUT'));
    waiting.catch(() => {});
    await blocked(b, a);
    await a.sql('COMMIT;');
    await waiting;
    await b.sql('ROLLBACK;');
    assert.equal(stock(10), 10);
  });
  await run('membership revoked during lock wait is rechecked', async () => {
    await holder.sql(
      `BEGIN; SELECT id FROM public.products WHERE id='${products[11]}' FOR UPDATE;`,
    );
    await begin(a);
    const waiting = a.sql(expect(helper([11], [1]), '42501', 'CHECKOUT_ACCESS_DENIED'));
    waiting.catch(() => {});
    await blocked(a, holder);
    query(
      `UPDATE public.business_members SET is_active=false WHERE business_id='${business}' AND user_id='${user}';`,
    );
    await holder.sql('COMMIT;');
    await waiting;
    await a.sql('ROLLBACK;');
    query(
      `UPDATE public.business_members SET is_active=true WHERE business_id='${business}' AND user_id='${user}';`,
    );
  });
  await run('zero-ledger product anchors serialize the first inventory entry', async () => {
    assert.equal(stock(12), 0);
    await begin(b);
    await b.sql(
      `SELECT public.adjust_stock('${business}','${randomUUID()}','${products[12]}',5,'ADJUSTMENT',NULL);`,
    );
    await begin(a);
    const waiting = a.sql(helper([12], [4]));
    waiting.catch(() => {});
    await blocked(a, b);
    await b.sql('COMMIT;');
    assert.match(await waiting, /\|4\|5$/);
    await a.sql('ROLLBACK;');
    assert.equal(stock(12), 5);
  });
  console.log('PASS 11/11 real local concurrency groups; no checkout RPC implemented.');
  console.log('Committed synthetic fixtures require final local db reset.');
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const session of sessions) session.close();
  });
