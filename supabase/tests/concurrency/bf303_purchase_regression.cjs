// Real LOCAL PostgreSQL only. Reuse BF302 transport/barriers; reset between
// standalone runners and after committed synthetic fixtures, as documented.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { query, Session, blocked } = require('../helpers/local-postgres.cjs');
const namespace = randomUUID().slice(0, 24);
let sequence = 0;
const id = () => namespace + (++sequence).toString(16).padStart(12, '0');
const biz = id(),
  category = id(),
  owners = [id(), id()],
  sessions = [];
const claim = (actor = 0) =>
  `SET LOCAL request.jwt.claims='{"sub":"${owners[actor]}","role":"authenticated"}';`;
const begin = (session, actor = 0, trustedStage = false) =>
  session.sql(`BEGIN;${claim(actor)}${trustedStage ? '' : 'SET LOCAL ROLE authenticated;'}`);
const owner = (sql) => query(`BEGIN;${claim()}SET LOCAL ROLE authenticated;${sql}COMMIT;`);
const product = () => {
  const p = id();
  query(
    `INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES('${p}','${biz}','BF303 historical',0,7);`,
  );
  return p;
};
const call = (op, ps, quantity = 1, cost = '10.00', date = '2026-09-20T12:00Z') =>
  `public.complete_purchase('${biz}','${op}','  BF303 supplier  ','${category}','BANK_TRANSFER','${date}','  notes  ',
    '${JSON.stringify(ps.map((productId) => ({ productId, quantity, unitCost: cost })))}')`;
const buy = (ps, quantity = 1) => JSON.parse(owner(`SELECT ${call(id(), ps, quantity)};`));
const voidCall = (purchase) =>
  `public.void_purchase('${biz}','${id()}','${purchase.purchase.id}','BF303 void')`;
const cost = (p) => query(`SELECT default_purchase_cost FROM public.products WHERE id='${p}';`);
const stock = (p) =>
  owner(`SELECT current_stock FROM public.get_product_stock('${biz}',ARRAY['${p}'::uuid]);`);
const counts = (op) =>
  JSON.parse(
    query(`SELECT jsonb_build_array(
 (SELECT count(*) FROM public.purchases WHERE business_id='${biz}' AND operation_id='${op}'),
 (SELECT count(*) FROM public.purchase_items i JOIN public.purchases p ON p.id=i.purchase_id WHERE p.business_id='${biz}' AND p.operation_id='${op}'),
 (SELECT count(*) FROM public.stock_movements m JOIN public.purchases p ON p.id=m.reference_id WHERE p.business_id='${biz}' AND p.operation_id='${op}' AND m.reference_type='PURCHASE'),
 (SELECT count(*) FROM public.expenses e JOIN public.purchases p ON p.id=e.purchase_id WHERE p.business_id='${biz}' AND p.operation_id='${op}'));`),
  );
const sale = (ps, op = id(), quantity = 1) => `DO $$ BEGIN
 PERFORM private.persist_checkout_sale('${biz}','${op}',NULL,NULL,0,0,0);
 PERFORM private.lock_checkout_products('${biz}',ARRAY[${ps.map((p) => `'${p}'::uuid`).join(',')}],ARRAY[${ps.map(() => quantity).join(',')}]);
 PERFORM private.persist_checkout_items('${biz}','${op}','${JSON.stringify(ps.map((p) => ({ itemType: 'PRODUCT', itemId: p, quantity, unitPriceOverride: '0.00' })))}');
 PERFORM private.persist_checkout_payment('${biz}','${op}','CASH');
 PERFORM private.persist_checkout_stock('${biz}','${op}'); END $$;`;
const lowerLocked = (p) =>
  query(`DO $$ BEGIN BEGIN
 PERFORM id FROM public.products WHERE id='${p}' FOR UPDATE NOWAIT;
 RAISE EXCEPTION 'BF303 expected lower UUID lock before upper';
 EXCEPTION WHEN lock_not_available THEN NULL;END;END $$;`);
const history = new Map();
function invariants() {
  // Independent expected relation: exact line multiset, one generated expense,
  // exact numeric sums and valid ownership, not a copy of the writer algorithm.
  assert.equal(
    query(`SELECT count(*) FROM public.purchases p WHERE p.business_id='${biz}' AND (
   p.total IS DISTINCT FROM (SELECT sum(i.line_total) FROM public.purchase_items i WHERE i.purchase_id=p.id) OR
   (SELECT count(*) FROM public.expenses e WHERE e.purchase_id=p.id AND e.business_id=p.business_id AND e.source_type='PURCHASE' AND e.amount=p.total)<>1 OR
   EXISTS((SELECT i.product_id,i.quantity,i.unit_cost_snapshot FROM public.purchase_items i WHERE i.purchase_id=p.id
     EXCEPT ALL SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m WHERE m.reference_type='PURCHASE' AND m.reference_id=p.id)
     UNION ALL (SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m WHERE m.reference_type='PURCHASE' AND m.reference_id=p.id
     EXCEPT ALL SELECT i.product_id,i.quantity,i.unit_cost_snapshot FROM public.purchase_items i WHERE i.purchase_id=p.id))
  );`),
    '0',
    'no incomplete purchase/expense/stock set',
  );
  assert.equal(
    owner(`SELECT count(*) FROM public.get_product_stock('${biz}',ARRAY(SELECT id FROM public.products WHERE business_id='${biz}')) s
    WHERE s.current_stock::bigint<0 OR s.current_stock::bigint IS DISTINCT FROM
      (SELECT coalesce(sum(m.quantity_delta),0) FROM public.stock_movements m WHERE m.business_id='${biz}' AND m.product_id=s.product_id);`),
    '0',
  );
  const rows = JSON.parse(
    query(`SELECT coalesce(jsonb_agg(x),'[]') FROM (
    SELECT 'item' AS kind,i.id,to_jsonb(i) AS body FROM public.purchase_items i JOIN public.purchases p ON p.id=i.purchase_id WHERE p.business_id='${biz}'
    UNION ALL SELECT 'stock',m.id,to_jsonb(m) FROM public.stock_movements m WHERE m.business_id='${biz}'
    UNION ALL SELECT 'expense',e.id,to_jsonb(e) FROM public.expenses e WHERE e.business_id='${biz}'
    UNION ALL SELECT 'audit',v.id,to_jsonb(v) FROM private.purchase_voids v WHERE v.business_id='${biz}'
  ) x;`),
  );
  const present = new Set(rows.map((r) => r.kind + r.id));
  for (const key of history.keys()) assert.ok(present.has(key), 'historical row retained');
  for (const row of rows) {
    const key = row.kind + row.id;
    if (history.has(key)) assert.deepEqual(row.body, history.get(key), 'historical body immutable');
    history.set(key, row.body);
  }
}
let cases = 0;
async function run(name, fn) {
  await fn();
  invariants();
  cases++;
  console.log(`PASS BF303 ${name}`);
}
async function main() {
  query(`BEGIN;INSERT INTO auth.users(id) VALUES('${owners[0]}'),('${owners[1]}');
    INSERT INTO public.businesses(id,name,timezone) VALUES('${biz}','BF303 concurrency','UTC');
    INSERT INTO public.business_members(business_id,user_id,role) VALUES('${biz}','${owners[0]}','OWNER'),('${biz}','${owners[1]}','OWNER');
    INSERT INTO public.expense_categories(id,business_id,name) VALUES('${category}','${biz}','BF303 category');COMMIT;`);
  for (let i = 0; i < 3; i++) {
    const s = new Session();
    sessions.push(s);
    await s.init();
  }
  const [a, b, holder] = sessions;
  async function race(first, second, trustedB = false) {
    await begin(a);
    const one = await a.sql(first);
    await begin(b, 1, trustedB);
    const waiting = b.sql(second);
    await blocked(b, a);
    await a.sql('COMMIT;');
    const two = await waiting;
    await b.sql('COMMIT;');
    return [one, two];
  }
  await run('same completion operation returns one exact duplicate-line history', async () => {
    const p = product(),
      op = id(),
      expression = call(op, [p, p], 2);
    const [one, two] = await race(`SELECT ${expression};`, `SELECT ${expression};`);
    assert.deepEqual(JSON.parse(two), JSON.parse(one));
    assert.deepEqual(counts(op), [1, 2, 2, 1]);
    assert.equal(stock(p), '4');
  });
  await run(
    'different retry payload cannot mix product/cost/creator into winning NEW',
    async () => {
      const p = product(),
        other = product(),
        op = id();
      const [one, two] = await race(
        `SELECT ${call(op, [p], 3, '1.01')};`,
        `SELECT ${call(op, [other], 7, '99.00')};`,
      );
      const result = JSON.parse(one);
      assert.deepEqual(JSON.parse(two), result);
      assert.equal(result.purchase.created_by, owners[0]);
      assert.deepEqual(counts(op), [1, 1, 1, 1]);
      assert.equal(stock(p), '3');
      assert.equal(stock(other), '0');
      assert.equal(cost(other), '7.00');
    },
  );
  await run('two purchases serialize cost by application, not purchased_at', async () => {
    const p = product(),
      opA = id(),
      opB = id();
    await race(
      `SELECT ${call(opA, [p], 2, '10.00')};`,
      `SELECT ${call(opB, [p], 3, '12.00', '2026-01-01T12:00Z')};`,
    );
    assert.equal(stock(p), '5');
    assert.equal(cost(p), '12.00');
    owner(`SELECT ${call(opA, [p])};`);
    assert.equal(cost(p), '12.00');
    assert.deepEqual(counts(opA), [1, 1, 1, 1]);
    assert.deepEqual(counts(opB), [1, 1, 1, 1]);
  });
  await run('inverse multi-product purchases hold low UUID before upper and finish', async () => {
    const low = product(),
      high = product(),
      opA = id(),
      opB = id();
    await holder.sql(`BEGIN;SELECT id FROM public.products WHERE id='${high}' FOR UPDATE;`);
    await begin(a);
    const first = a.sql(`SELECT ${call(opA, [high, low])};`);
    await blocked(a, holder);
    lowerLocked(low);
    await begin(b, 1);
    const second = b.sql(`SELECT ${call(opB, [low, high], 2, '12.00')};`);
    await blocked(b, a);
    await holder.sql('COMMIT;');
    await first;
    await a.sql('COMMIT;');
    await second;
    await b.sql('COMMIT;');
    assert.equal(stock(low), '3');
    assert.equal(stock(high), '3');
    assert.equal(cost(low), '12.00');
    assert.equal(cost(high), '12.00');
  });
  await run(
    'BF302 purchase business/product order remains compatible with existing SALE',
    async () => {
      const p = product();
      buy([p], 2);
      await race(`SELECT ${call(id(), [p], 3, '12.00')};`, sale([p], id(), 4), true);
      assert.equal(stock(p), '1');
      assert.equal(
        query(
          `SELECT unit_cost FROM public.stock_movements WHERE product_id='${p}' AND reference_type='SALE';`,
        ),
        '12.00',
      );
    },
  );
  await run(
    'SALE first and inverse purchase input cannot recreate business/product cycle',
    async () => {
      const low = product(),
        high = product();
      buy([low, high], 3);
      await holder.sql(`BEGIN;SELECT id FROM public.products WHERE id='${high}' FOR UPDATE;`);
      await begin(a, 0, true);
      const first = a.sql(sale([high, low]));
      await blocked(a, holder);
      lowerLocked(low);
      await begin(b, 1);
      const second = b.sql(`SELECT ${call(id(), [low, high], 2)};`);
      await blocked(b, a);
      await holder.sql('COMMIT;');
      await first;
      await a.sql('COMMIT;');
      await second;
      await b.sql('COMMIT;');
      assert.equal(stock(low), '4');
      assert.equal(stock(high), '4');
    },
  );
  await run('purchase credit and adjustment share one exact ledger', async () => {
    const p = product();
    await race(
      `SELECT ${call(id(), [p], 5)};`,
      `SELECT public.adjust_stock('${biz}','${id()}','${p}',-4,'LOSS',NULL);`,
    );
    assert.equal(stock(p), '1');
  });
  await run(
    'new purchase and old purchase void preserve both expense histories and latest cost',
    async () => {
      const p = product(),
        old = buy([p], 2);
      const [, second] = await race(
        `SELECT ${call(id(), [p], 3, '12.00')};`,
        `SELECT ${voidCall(old)};`,
      );
      assert.deepEqual(JSON.parse(second).expense, old.expense);
      assert.equal(stock(p), '3');
      assert.equal(cost(p), '12.00');
    },
  );
  await run('current OWNER revoked during completion replay wait sees no history', async () => {
    const p = product(),
      op = id();
    await begin(a);
    await a.sql(`SELECT ${call(op, [p])};`);
    await begin(b, 1);
    const waiting = b.sql(`DO $$ DECLARE d text;BEGIN BEGIN PERFORM ${call(op, [p])};
      RAISE EXCEPTION 'BF303 unauthorized replay accepted';EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;IF d IS DISTINCT FROM 'ACCESS_DENIED' THEN RAISE EXCEPTION 'wrong signal';END IF;END;END $$;`);
    await blocked(b, a);
    query(
      `UPDATE public.business_members SET is_active=false WHERE business_id='${biz}' AND user_id='${owners[1]}';`,
    );
    try {
      await a.sql('COMMIT;');
      await waiting;
      await b.sql('COMMIT;');
      assert.deepEqual(counts(op), [1, 1, 1, 1]);
    } finally {
      query(
        `UPDATE public.business_members SET is_active=true WHERE business_id='${biz}' AND user_id='${owners[1]}';`,
      );
    }
  });
  await run(
    'rollback of NEW winner lets waiter apply its whole own history without mixture',
    async () => {
      const p = product(),
        op = id();
      await begin(a);
      const discarded = JSON.parse(await a.sql(`SELECT ${call(op, [p], 5)};`));
      assert.deepEqual(counts(op), [0, 0, 0, 0]);
      await begin(b, 1);
      const waiting = b.sql(`SELECT ${call(op, [p], 2, '12.00')};`);
      await blocked(b, a);
      await a.sql('ROLLBACK;');
      const persisted = JSON.parse(await waiting);
      await b.sql('COMMIT;');
      assert.notEqual(persisted.purchase.id, discarded.purchase.id);
      assert.equal(persisted.purchase.created_by, owners[1]);
      assert.deepEqual(counts(op), [1, 1, 1, 1]);
      assert.equal(stock(p), '2');
      assert.equal(cost(p), '12.00');
    },
  );
  assert.equal(cases, 10);
  console.log(`BF303 concurrency PASS ${cases}/10 real coordinated cases`);
}
main()
  .catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(sessions.map((s) => s.close()));
  });
