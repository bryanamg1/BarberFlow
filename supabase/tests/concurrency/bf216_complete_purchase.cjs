// Synthetic fixtures on LOCAL Supabase only. The final local reset removes them.
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
    assert.equal(this.pending, null);
    return new Promise((resolve, reject) => {
      const marker = `bf216_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(() => {
        this.fail(new Error('BF216 connection timeout'));
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
const category = randomUUID();
const owners = [randomUUID(), randomUUID()];
const products = [randomUUID(), randomUUID()].sort();
const begin = (session, actor = owners[0], isolation = '') =>
  session.sql(
    `BEGIN ${isolation};SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);SET LOCAL ROLE authenticated;`,
  );
const lines = (cost = '1.01', reverse = false) =>
  (reverse ? [...products].reverse() : products).map((productId) => ({
    productId,
    quantity: 1,
    unitCost: cost,
  }));
const call = (
  op,
  cost = '1.01',
  items = [{ productId: products[0], quantity: 1, unitCost: cost }],
) =>
  `public.complete_purchase('${business}','${op}','BF216 supplier','${category}','BANK_TRANSFER',
   '2026-01-01T01:30Z','  Original notes  ','${JSON.stringify(items)}')`;
const execute = (op, cost, items) => `SELECT ${call(op, cost, items)};`;
const counts = (op) =>
  JSON.parse(
    query(`SELECT json_build_array(
  (SELECT count(*) FROM public.purchases WHERE business_id='${business}' AND operation_id='${op}'),
  (SELECT count(*) FROM public.purchase_items i JOIN public.purchases p ON p.id=i.purchase_id WHERE p.business_id='${business}' AND p.operation_id='${op}'),
  (SELECT count(*) FROM public.stock_movements m JOIN public.purchases p ON p.id=m.reference_id WHERE m.reference_type='PURCHASE' AND p.business_id='${business}' AND p.operation_id='${op}'),
  (SELECT count(*) FROM public.expenses e JOIN public.purchases p ON p.id=e.purchase_id WHERE p.business_id='${business}' AND p.operation_id='${op}'));`),
  );
const balance = () =>
  Number(
    query(
      `SELECT COALESCE(sum(quantity_delta),0) FROM public.stock_movements WHERE product_id='${products[0]}';`,
    ),
  );
const cost = () =>
  query(`SELECT default_purchase_cost FROM public.products WHERE id='${products[0]}';`);
const membership = (active) =>
  query(
    `UPDATE public.business_members SET is_active=${active} WHERE business_id='${business}' AND user_id='${owners[1]}';`,
  );
const denied = (expression, state = '42501') => `DO $$ BEGIN
  BEGIN PERFORM ${expression};RAISE EXCEPTION 'BF216 expected rejection';
  EXCEPTION WHEN SQLSTATE '${state}' THEN NULL;END;END $$;`;
async function blocked(waiter, holder) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (query(`SELECT ${holder.pid}=ANY(pg_blocking_pids(${waiter.pid}));`) === 't') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('BF216 required real overlap not observed');
}
let cases = 0;
async function main() {
  query(`INSERT INTO auth.users(id) VALUES('${owners[0]}'),('${owners[1]}');
    INSERT INTO public.businesses(id,name,timezone) VALUES('${business}','BF216 concurrency','UTC');
    INSERT INTO public.business_members(business_id,user_id,role) VALUES('${business}','${owners[0]}','OWNER'),('${business}','${owners[1]}','OWNER');
    INSERT INTO public.expense_categories(id,business_id,name) VALUES('${category}','${business}','BF216 category');
    INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES
      ('${products[0]}','${business}','BF216 A',10,7),('${products[1]}','${business}','BF216 B',10,7);`);
  const a = await new Session().init();
  const b = await new Session().init();
  // Same operation, different payload, concurrent OWNER callers; no visible partial writes.
  let op = randomUUID();
  await begin(a);
  const first = JSON.parse(await a.sql(execute(op)));
  assert.deepEqual(counts(op), [0, 0, 0, 0]);
  cases++;
  await begin(b, owners[1]);
  let pending = b.sql(execute(op, '9.00'));
  await blocked(b, a);
  await a.sql('COMMIT;');
  const replay = JSON.parse(await pending);
  await b.sql('COMMIT;');
  assert.deepEqual(replay, first);
  assert.deepEqual(counts(op), [1, 1, 1, 1]);
  assert.equal(cost(), '1.01');
  cases++;
  // Response lost after commit: retry the same key, including another changed payload.
  await begin(b);
  assert.deepEqual(JSON.parse(await b.sql(execute(op, '8.00'))), first);
  await b.sql('COMMIT;');
  assert.deepEqual(counts(op), [1, 1, 1, 1]);
  cases++;
  // Distinct operations serialize cost application on the shared product anchor.
  op = randomUUID();
  const next = randomUUID();
  await begin(a);
  await a.sql(execute(op, '2.00'));
  await begin(b);
  pending = b.sql(execute(next, '3.00'));
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.equal(cost(), '3.00');
  assert.deepEqual(counts(next), [1, 1, 1, 1]);
  cases++;
  // Products supplied in reverse orders cannot introduce inconsistent lock order.
  op = randomUUID();
  const reversed = randomUUID();
  await begin(a);
  await a.sql(execute(op, '4.00', lines('4.00')));
  await begin(b);
  pending = b.sql(execute(reversed, '5.00', lines('5.00', true)));
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.deepEqual(counts(reversed), [1, 2, 2, 1]);
  assert.equal(cost(), '5.00');
  cases++;
  // Purchase then adjustment shares the product lock, preserves append-only effects.
  const before = balance();
  op = randomUUID();
  await begin(a);
  await a.sql(execute(op, '6.00'));
  await begin(b);
  pending = b.sql(
    `SELECT public.adjust_stock('${business}','${randomUUID()}','${products[0]}',-1,'LOSS',NULL);`,
  );
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.equal(balance(), before);
  assert.equal(cost(), '6.00');
  cases++;
  // Existing private checkout lock stage (no invented completed checkout endpoint).
  await a.sql(`BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${owners[0]}"}',true);`);
  await a.sql(
    `SELECT current_stock FROM private.lock_checkout_products('${business}',ARRAY['${products[0]}'::uuid],ARRAY[1]);`,
  );
  op = randomUUID();
  await begin(b);
  pending = b.sql(execute(op, '7.00'));
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.deepEqual(counts(op), [1, 1, 1, 1]);
  cases++;
  // Purchase holds the product before checkout: checkout sees the committed increment.
  const stockBefore = balance();
  op = randomUUID();
  await begin(a);
  await a.sql(execute(op, '8.00'));
  await b.sql(`BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${owners[0]}"}',true);`);
  pending = b.sql(
    `SELECT current_stock FROM private.lock_checkout_products('${business}',ARRAY['${products[0]}'::uuid],ARRAY[${stockBefore + 1}]);`,
  );
  await blocked(b, a);
  await a.sql('COMMIT;');
  assert.equal(Number(await pending), stockBefore + 1);
  await b.sql('COMMIT;');
  cases++;
  // Revocation while waiting on the operation lock rejects even a complete replay.
  op = randomUUID();
  await begin(a);
  await a.sql(execute(op));
  await begin(b, owners[1]);
  pending = b.sql(denied(call(op)));
  await blocked(b, a);
  membership(false);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.deepEqual(counts(op), [1, 1, 1, 1]);
  membership(true);
  cases++;
  // Product/category/business waits each revalidate OWNER and roll back all effects.
  for (const anchor of [
    `SELECT id FROM public.products WHERE id='${products[0]}' FOR UPDATE;`,
    `SELECT id FROM public.expense_categories WHERE id='${category}' FOR UPDATE;`,
    `SELECT id FROM public.businesses WHERE id='${business}' FOR NO KEY UPDATE;`,
  ]) {
    await a.sql(`BEGIN;${anchor}`);
    op = randomUUID();
    const oldCost = cost();
    const oldBalance = balance();
    await begin(b, owners[1]);
    pending = b.sql(denied(call(op)));
    await blocked(b, a);
    membership(false);
    await a.sql('COMMIT;');
    await pending;
    await b.sql('COMMIT;');
    assert.deepEqual(counts(op), [0, 0, 0, 0]);
    assert.equal(cost(), oldCost);
    assert.equal(balance(), oldBalance);
    membership(true);
    cases++;
  }
  await begin(a, owners[0], 'ISOLATION LEVEL REPEATABLE READ');
  await a.sql(denied(call(randomUUID()), '40001'));
  await a.sql('ROLLBACK;');
  cases++;
  // A replay after a later purchase never undoes the later reference cost.
  await begin(a);
  const original = JSON.parse(await a.sql(execute(randomUUID(), '9.00')));
  await a.sql('COMMIT;');
  await begin(b);
  await b.sql(execute(randomUUID(), '10.00'));
  await b.sql('COMMIT;');
  await begin(a);
  assert.deepEqual(
    JSON.parse(await a.sql(execute(original.purchase.operation_id, '99.00'))),
    original,
  );
  await a.sql('COMMIT;');
  assert.equal(cost(), '10.00');
  cases++;
  assert.equal(cases, 14);
  process.stdout.write(`BF216 concurrency PASS ${cases}/14 real coordinated cases\n`);
}
main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(sessions.map((session) => session.close()));
  });
