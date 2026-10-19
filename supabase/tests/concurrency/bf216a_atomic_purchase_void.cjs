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
const begin = (s, actor = owners[0]) =>
  s.sql(
    `BEGIN;SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`,
  );
const claim = `SET LOCAL request.jwt.claims='{"sub":"${owners[0]}","role":"authenticated"}';`;
const asOwner = (sql) => query(`BEGIN;${claim}SET LOCAL ROLE authenticated;${sql}COMMIT;`);
const newProduct = () => {
  const id = randomUUID();
  query(
    `INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES('${id}','${business}','BF216A concurrency',10,7);`,
  );
  return id;
};
const buy = (products, quantity = 1) =>
  JSON.parse(
    asOwner(
      `SELECT public.complete_purchase('${business}','${randomUUID()}','Supplier','${category}','CASH','2026-09-20T12:00Z',NULL,'${JSON.stringify(products.map((productId) => ({ productId, quantity, unitCost: '1.00' })))}');`,
    ),
  );
const expr = (purchase, op = randomUUID(), reason = 'reason') =>
  `public.void_purchase('${business}','${op}','${purchase.purchase.id}','${reason}')`;
const expect = (expression, detail) =>
  `DO $$ DECLARE d text;BEGIN BEGIN PERFORM ${expression};RAISE EXCEPTION 'expected rejection';EXCEPTION WHEN SQLSTATE 'PT409' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;IF d<>'${detail}' THEN RAISE EXCEPTION 'wrong rejection %',d;END IF;END;END $$;`;
const balance = (p) =>
  BigInt(
    query(
      `SELECT coalesce(sum(quantity_delta),0) FROM public.stock_movements WHERE product_id='${p}';`,
    ),
  );
const count = (p) =>
  Number(
    query(`SELECT count(*) FROM private.purchase_voids WHERE purchase_id='${p.purchase.id}';`),
  );
async function blocked(waiter, holder) {
  const until = Date.now() + 6000;
  while (Date.now() < until) {
    if (query(`SELECT ${holder.pid}=ANY(pg_blocking_pids(${waiter.pid}));`) === 't') return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Expected real lock overlap not observed');
}
let cases = 0;
async function main() {
  query(
    `INSERT INTO auth.users(id) VALUES('${owners[0]}'),('${owners[1]}');INSERT INTO public.businesses(id,name) VALUES('${business}','BF216A concurrency');INSERT INTO public.business_members(business_id,user_id,role) VALUES('${business}','${owners[0]}','OWNER'),('${business}','${owners[1]}','OWNER');INSERT INTO public.expense_categories(id,business_id,name) VALUES('${category}','${business}','Category');`,
  );
  const a = await new Session().init(),
    b = await new Session().init();
  let p = newProduct(),
    purchase = buy([p]),
    op = randomUUID(),
    pending;
  await begin(a);
  const first = JSON.parse(await a.sql(`SELECT ${expr(purchase, op)};`));
  assert.equal(count(purchase), 0);
  await begin(b, owners[1]);
  pending = b.sql(`SELECT ${expr(purchase, op)};`);
  await blocked(b, a);
  await a.sql('COMMIT;');
  assert.deepEqual(JSON.parse(await pending), first);
  await b.sql('COMMIT;');
  assert.equal(count(purchase), 1);
  assert.equal(balance(p), 0n);
  cases++;
  p = newProduct();
  purchase = buy([p]);
  await begin(a);
  await a.sql(`SELECT ${expr(purchase)};`);
  await begin(b);
  pending = b.sql(expect(expr(purchase), 'INVALID_STATUS'));
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.equal(count(purchase), 1);
  assert.equal(balance(p), 0n);
  cases++;
  // Later complete_purchase serializes before product access and keeps its own cost.
  p = newProduct();
  purchase = buy([p]);
  await begin(a);
  await a.sql(`SELECT ${expr(purchase)};`);
  await begin(b);
  pending = b.sql(
    `SELECT public.complete_purchase('${business}','${randomUUID()}','Later','${category}','CASH','2026-09-21T12:00Z',NULL,'[{"productId":"${p}","quantity":2,"unitCost":"2.00"}]');`,
  );
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.equal(balance(p), 2n);
  assert.equal(query(`SELECT default_purchase_cost FROM public.products WHERE id='${p}';`), '2.00');
  cases++;
  // Adjustment waits behind void and sees committed zero, cannot consume again.
  p = newProduct();
  purchase = buy([p]);
  await begin(a);
  await a.sql(`SELECT ${expr(purchase)};`);
  await begin(b);
  pending = b.sql(
    expect(
      `public.adjust_stock('${business}','${randomUUID()}','${p}',-1,'LOSS',NULL)`,
      'INSUFFICIENT_STOCK',
    ),
  );
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.equal(balance(p), 0n);
  cases++;
  // Adjustment wins first: void must reject wholly after observing the new balance.
  p = newProduct();
  purchase = buy([p]);
  await begin(a);
  await a.sql(`SELECT public.adjust_stock('${business}','${randomUUID()}','${p}',-1,'LOSS',NULL);`);
  await begin(b);
  pending = b.sql(expect(expr(purchase), 'INSUFFICIENT_STOCK'));
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.equal(count(purchase), 0);
  assert.equal(balance(p), 0n);
  cases++;
  // Existing private checkout stock lock stage; no invented full checkout API.
  p = newProduct();
  purchase = buy([p]);
  await a.sql(
    `BEGIN;${claim}SELECT current_stock FROM private.lock_checkout_products('${business}',ARRAY['${p}'::uuid],ARRAY[1]);INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES('${business}','${p}','SALE',-1,'${owners[0]}');`,
  );
  await begin(b);
  pending = b.sql(expect(expr(purchase), 'INSUFFICIENT_STOCK'));
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.equal(balance(p), 0n);
  assert.equal(count(purchase), 0);
  cases++;
  // Void wins before checkout locking: checkout refuses a second consumption.
  p = newProduct();
  purchase = buy([p]);
  await begin(a);
  await a.sql(`SELECT ${expr(purchase)};`);
  await b.sql(`BEGIN;${claim}`);
  pending = b.sql(
    expect(
      `private.lock_checkout_products('${business}',ARRAY['${p}'::uuid],ARRAY[1])`,
      'INSUFFICIENT_STOCK',
    ),
  );
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.equal(balance(p), 0n);
  cases++;
  // Opposite item order still takes distinct product locks in UUID order.
  const products = [newProduct(), newProduct()].sort();
  const pa = buy(products),
    pb = buy([...products].reverse());
  await begin(a);
  await a.sql(`SELECT ${expr(pa)};`);
  await begin(b);
  pending = b.sql(`SELECT ${expr(pb)};`);
  await blocked(b, a);
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  for (const x of products) assert.equal(balance(x), 0n);
  cases++;
  // Revocation while waiting on a product must be observed after release.
  p = newProduct();
  purchase = buy([p]);
  await a.sql(`BEGIN;SELECT id FROM public.products WHERE id='${p}' FOR UPDATE;`);
  await begin(b, owners[1]);
  pending = b.sql(
    `DO $$ BEGIN BEGIN PERFORM ${expr(purchase)};RAISE EXCEPTION 'expected denied';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;`,
  );
  await blocked(b, a);
  query(
    `UPDATE public.business_members SET is_active=false WHERE business_id='${business}' AND user_id='${owners[1]}';`,
  );
  await a.sql('COMMIT;');
  await pending;
  await b.sql('COMMIT;');
  assert.equal(count(purchase), 0);
  assert.equal(balance(p), 1n);
  query(
    `UPDATE public.business_members SET is_active=true WHERE business_id='${business}' AND user_id='${owners[1]}';`,
  );
  cases++;
  // Completion replay races with void using the SAME completion operation lock.
  p = newProduct();
  purchase = buy([p]);
  await begin(a);
  await a.sql(`SELECT ${expr(purchase)};`);
  await begin(b);
  pending = b.sql(
    `SELECT public.complete_purchase('${business}','${purchase.purchase.operation_id}','Ignored','${category}','CASH','2026-09-20T12:00Z',NULL,'[{"productId":"${p}","quantity":1,"unitCost":"1.00"}]');`,
  );
  await blocked(b, a);
  await a.sql('COMMIT;');
  const replay = JSON.parse(await pending);
  await b.sql('COMMIT;');
  assert.equal(replay.purchase.status, 'VOIDED');
  assert.equal(balance(p), 0n);
  cases++;
  assert.equal(cases, 10);
  process.stdout.write(`BF216A concurrency PASS ${cases}/10 real coordinated cases\n`);
}
main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(sessions.map((s) => s.close()));
  });
