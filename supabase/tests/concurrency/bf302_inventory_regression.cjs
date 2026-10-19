// LOCAL real multi-connection regression. Synthetic committed fixtures are
// removed by the final authorized local reset, as in the existing harness.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { query, Session, blocked } = require('../helpers/local-postgres.cjs');

// Unique run namespace avoids collisions with a previous interrupted probe;
// monotonic suffixes make product UUID order deterministic within every run.
const namespace = randomUUID().slice(0, 24);
let sequence = 0;
const id = () => namespace + (++sequence).toString(16).padStart(12, '0');
const businesses = [id(), id()],
  owners = [id(), id()],
  categories = [id(), id()];
const products = [[], []],
  sessions = [];
const claim = (tenant = 0) =>
  `SET LOCAL request.jwt.claims='{"sub":"${owners[tenant]}","role":"authenticated"}';`;
const asOwner = (sql, tenant = 0) =>
  query(`BEGIN;${claim(tenant)}SET LOCAL ROLE authenticated;${sql}COMMIT;`);
const begin = (s, tenant = 0, privateStage = false) =>
  s.sql(`BEGIN;${claim(tenant)}${privateStage ? '' : 'SET LOCAL ROLE authenticated;'}`);
const product = (tenant = 0) => {
  const p = id();
  products[tenant].push(p);
  query(`INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost)
    VALUES('${p}','${businesses[tenant]}','BF302 concurrency',0,7);`);
  return p;
};
const items = (ids, quantity = 1, unitCost = '10.00') =>
  ids.map((productId) => ({ productId, quantity, unitCost }));
const buyExpr = (
  ids,
  quantity = 1,
  op = id(),
  cost = '10.00',
  date = '2026-09-20T12:00Z',
  tenant = 0,
) =>
  `public.complete_purchase('${businesses[tenant]}','${op}','BF302 supplier','${categories[tenant]}','CASH','${date}',NULL,'${JSON.stringify(items(ids, quantity, cost))}')`;
const buy = (ids, quantity = 1) => JSON.parse(asOwner(`SELECT ${buyExpr(ids, quantity)};`));
const adjust = (p, delta, op = id(), tenant = 0) =>
  `public.adjust_stock('${businesses[tenant]}','${op}','${p}',${delta},'ADJUSTMENT',NULL)`;
const voidExpr = (purchase, op = id()) =>
  `public.void_purchase('${businesses[0]}','${op}','${purchase.purchase.id}','BF302 correction')`;
// Existing private stages, not a new public complete_checkout. Setup has the
// trusted postgres role, but the real stage checks the synthetic caller OWNER.
const sale = (ids, quantity = 1, op = id()) => `DO $sale$ DECLARE s public.sales%ROWTYPE; BEGIN
  s:=private.persist_checkout_sale('${businesses[0]}','${op}',NULL,NULL,0,0,0);
  PERFORM private.lock_checkout_products('${businesses[0]}',ARRAY[${ids.map((p) => `'${p}'::uuid`).join(',')}],ARRAY[${ids.map(() => quantity).join(',')}]);
  PERFORM private.persist_checkout_items('${businesses[0]}','${op}','${JSON.stringify(ids.map((p) => ({ itemType: 'PRODUCT', itemId: p, quantity, unitPriceOverride: '0.00' })))}');
  PERFORM private.persist_checkout_payment('${businesses[0]}','${op}','CASH');
  PERFORM private.persist_checkout_stock('${businesses[0]}','${op}'); END $sale$;`;
const rejected = (statement) => `DO $$ DECLARE d text; BEGIN
  BEGIN ${statement} RAISE EXCEPTION 'BF302 expected rejection';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
    IF d IS DISTINCT FROM 'INSUFFICIENT_STOCK' THEN RAISE EXCEPTION 'BF302 wrong signal %',d; END IF;
  END; END $$;`;
const selectRejected = (expr) => rejected(`PERFORM ${expr};`);
const saleRejected = (ids, quantity, op) => rejected(sale(ids, quantity, op));
const ledger = (p, tenant = 0) =>
  BigInt(
    query(`SELECT coalesce(sum(quantity_delta),0)
  FROM public.stock_movements WHERE business_id='${businesses[tenant]}' AND product_id='${p}';`),
  );
const count = (reference, type) =>
  Number(
    query(`SELECT count(*) FROM public.stock_movements
  WHERE reference_type='${type}' AND reference_id='${reference}';`),
  );
const cost = (p) => query(`SELECT default_purchase_cost FROM public.products WHERE id='${p}';`);
const auditCount = (purchase) =>
  query(`SELECT count(*) FROM private.purchase_voids WHERE purchase_id='${purchase.purchase.id}';`);
const status = (purchase) =>
  query(`SELECT status FROM public.purchases WHERE id='${purchase.purchase.id}';`);
const history = new Map();
function invariants() {
  for (let tenant = 0; tenant < 2; tenant++) {
    if (!products[tenant].length) continue;
    const rows = JSON.parse(
      asOwner(
        `SELECT jsonb_agg(to_jsonb(x)) FROM public.get_product_stock(
      '${businesses[tenant]}',ARRAY[${products[tenant].map((p) => `'${p}'::uuid`).join(',')}]) x;`,
        tenant,
      ),
    );
    assert.equal(rows.length, products[tenant].length);
    for (const row of rows) {
      const actual = ledger(row.product_id, tenant);
      assert.ok(actual >= 0n, 'successful current writers never create negative stock');
      assert.equal(
        row.current_stock,
        actual.toString(),
        'RPC equals tenant-scoped ledger bigint sum',
      );
    }
  }
  const rows = JSON.parse(
    query(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]')
    FROM public.stock_movements m WHERE business_id IN ('${businesses[0]}','${businesses[1]}');`),
  );
  const present = new Set(rows.map((row) => row.id));
  for (const [movementId] of history)
    assert.ok(present.has(movementId), 'no historical row deleted');
  for (const row of rows) {
    if (history.has(row.id))
      assert.deepEqual(row, history.get(row.id), 'all historical fields unchanged');
    history.set(row.id, row);
  }
  assert.equal(
    query(`SELECT count(*) FROM public.stock_movements m WHERE m.business_id IN ('${businesses[0]}','${businesses[1]}') AND (
    (m.reference_type='PURCHASE' AND NOT EXISTS(SELECT 1 FROM public.purchases p WHERE p.id=m.reference_id AND p.business_id=m.business_id)) OR
    (m.reference_type='SALE' AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=m.reference_id AND s.business_id=m.business_id)) OR
    (m.reference_type='PURCHASE_VOID' AND (m.type<>'ADJUSTMENT' OR NOT EXISTS(SELECT 1 FROM private.purchase_voids v WHERE v.id=m.reference_id AND v.business_id=m.business_id)))
  );`),
    '0',
    'scenario-created movement references stay valid',
  );
}
let cases = 0;
async function run(name, fn) {
  await fn();
  invariants();
  cases++;
  console.log(`PASS BF302 ${name}`);
}
async function main() {
  query(
    `BEGIN;${businesses
      .map(
        (b, i) => `INSERT INTO auth.users(id) VALUES('${owners[i]}');
    INSERT INTO public.businesses(id,name,timezone) VALUES('${b}','BF302 concurrency ${i}','UTC');
    INSERT INTO public.business_members(business_id,user_id,role) VALUES('${b}','${owners[i]}','OWNER');
    INSERT INTO public.expense_categories(id,business_id,name) VALUES('${categories[i]}','${b}','BF302 category');`,
      )
      .join('')}COMMIT;`,
  );
  for (let i = 0; i < 3; i++) {
    const session = new Session();
    sessions.push(session);
    await session.init();
  }
  const [a, b, holder] = sessions;
  async function race(first, second, privateA = false, privateB = false) {
    await begin(a, 0, privateA);
    const firstResult = await a.sql(first);
    await begin(b, 0, privateB);
    const waiting = b.sql(second);
    await blocked(b, a);
    await a.sql('COMMIT;');
    const secondResult = await waiting;
    await b.sql('COMMIT;');
    return [firstResult, secondResult];
  }
  await run('two -4 adjustments against 5 allow one, exact final 1', async () => {
    const p = product();
    buy([p], 5);
    await race(`SELECT ${adjust(p, -4)};`, selectRejected(adjust(p, -4)));
    assert.equal(ledger(p), 1n);
    assert.equal(
      query(
        `SELECT count(*) FROM public.stock_movements WHERE product_id='${p}' AND reference_type='STOCK_ADJUSTMENT';`,
      ),
      '1',
    );
  });
  await run('purchase credit first, waiting debit sees committed +5', async () => {
    const p = product();
    await race(`SELECT ${buyExpr([p], 5)};`, `SELECT ${adjust(p, -4)};`);
    assert.equal(ledger(p), 1n);
  });
  await run('negative adjustment first, waiting purchase adds without lost effect', async () => {
    const p = product();
    buy([p], 5);
    await race(`SELECT ${adjust(p, -4)};`, `SELECT ${buyExpr([p], 2)};`);
    assert.equal(ledger(p), 3n);
  });
  await run('real SALE persistence first rejects competing adjustment', async () => {
    const p = product();
    buy([p], 5);
    const op = id();
    await race(sale([p], 4, op), selectRejected(adjust(p, -4)), true);
    assert.equal(ledger(p), 1n);
    assert.equal(
      query(`SELECT count(*) FROM public.stock_movements m JOIN public.sales s ON s.id=m.reference_id
      WHERE s.operation_id='${op}' AND m.reference_type='SALE' AND m.quantity_delta=-4;`),
      '1',
    );
  });
  await run('adjustment first rejects complete existing SALE stage atomically', async () => {
    const p = product();
    buy([p], 5);
    const op = id();
    await race(`SELECT ${adjust(p, -4)};`, saleRejected([p], 4, op), false, true);
    assert.equal(ledger(p), 1n);
    assert.equal(query(`SELECT count(*) FROM public.sales WHERE operation_id='${op}';`), '0');
  });
  await run('void first rejects waiting actual SALE path', async () => {
    const p = product(),
      purchase = buy([p], 5),
      op = id();
    await race(`SELECT ${voidExpr(purchase)};`, saleRejected([p], 1, op), false, true);
    assert.equal(ledger(p), 0n);
    assert.equal(auditCount(purchase), '1');
    assert.equal(query(`SELECT count(*) FROM public.sales WHERE operation_id='${op}';`), '0');
  });
  await run('actual SALE wins, void rejects with no audit/status/compensation', async () => {
    const p = product(),
      purchase = buy([p], 5);
    await race(sale([p], 4), selectRejected(voidExpr(purchase)), true);
    assert.equal(ledger(p), 1n);
    assert.equal(auditCount(purchase), '0');
    assert.equal(status(purchase), 'COMPLETED');
    assert.equal(
      query(
        `SELECT count(*) FROM public.stock_movements WHERE product_id='${p}' AND reference_type='PURCHASE_VOID';`,
      ),
      '0',
    );
  });
  await run('void first rejects waiting adjustment', async () => {
    const p = product(),
      purchase = buy([p], 5);
    await race(`SELECT ${voidExpr(purchase)};`, selectRejected(adjust(p, -1)));
    assert.equal(ledger(p), 0n);
  });
  await run('adjustment first rejects waiting void wholly', async () => {
    const p = product(),
      purchase = buy([p], 5);
    await race(`SELECT ${adjust(p, -4)};`, selectRejected(voidExpr(purchase)));
    assert.equal(ledger(p), 1n);
    assert.equal(auditCount(purchase), '0');
    assert.equal(status(purchase), 'COMPLETED');
  });
  await run(
    'inverse inputs prove first UUID anchor before held second across purchase/SALE',
    async () => {
      const low = product(),
        high = product();
      buy([low, high], 3);
      await holder.sql(`BEGIN; SELECT id FROM public.products WHERE id='${high}' FOR UPDATE;`);
      await begin(a);
      const purchaseWaiting = a.sql(`SELECT ${buyExpr([high, low])};`);
      await blocked(a, holder);
      query(`DO $$ BEGIN BEGIN
      PERFORM id FROM public.products WHERE id='${low}' FOR UPDATE NOWAIT;
      RAISE EXCEPTION 'BF302 lower UUID anchor not acquired before higher UUID';
      EXCEPTION WHEN lock_not_available THEN NULL; END; END $$;`);
      await begin(b, 0, true);
      const saleWaiting = b.sql(sale([low, high]));
      await blocked(b, a); // May wait on the earlier shared business anchor.
      await holder.sql('COMMIT;');
      await purchaseWaiting;
      await a.sql('COMMIT;');
      await saleWaiting;
      await b.sql('COMMIT;');
      assert.equal(ledger(low), 3n);
      assert.equal(ledger(high), 3n);
    },
  );
  await run(
    'inverse SALE inputs lock low UUID before high; waiting purchase completes',
    async () => {
      const low = product(),
        high = product();
      buy([low, high], 3);
      await holder.sql(`BEGIN; SELECT id FROM public.products WHERE id='${high}' FOR UPDATE;`);
      await begin(a, 0, true);
      const saleWaiting = a.sql(sale([high, low]));
      await blocked(a, holder);
      query(`DO $$ BEGIN BEGIN
      PERFORM id FROM public.products WHERE id='${low}' FOR UPDATE NOWAIT;
      RAISE EXCEPTION 'BF302 SALE lower UUID anchor not acquired before higher UUID';
      EXCEPTION WHEN lock_not_available THEN NULL; END; END $$;`);
      await begin(b);
      const purchaseWaiting = b.sql(`SELECT ${buyExpr([low, high])};`);
      await blocked(b, a);
      await holder.sql('COMMIT;');
      await saleWaiting;
      await a.sql('COMMIT;');
      await purchaseWaiting;
      await b.sql('COMMIT;');
      assert.equal(ledger(low), 3n);
      assert.equal(ledger(high), 3n);
    },
  );
  await run(
    'concurrent adjustment replay with changed product returns exact original',
    async () => {
      const p = product(),
        other = product(),
        op = id();
      const [first, second] = await race(
        `SELECT ${adjust(p, 2, op)};`,
        `SELECT ${adjust(other, -99, op)};`,
      );
      assert.deepEqual(JSON.parse(second), JSON.parse(first));
      assert.equal(count(op, 'STOCK_ADJUSTMENT'), 1);
      assert.equal(ledger(p), 2n);
      assert.equal(ledger(other), 0n);
    },
  );
  await run('concurrent purchase replay preserves duplicate lines and one expense', async () => {
    const p = product(),
      op = id();
    const [first, second] = await race(
      `SELECT ${buyExpr([p, p], 2, op)};`,
      `SELECT ${buyExpr([p], 99, op, '99.00')};`,
    );
    const purchase = JSON.parse(first);
    assert.deepEqual(JSON.parse(second), purchase);
    assert.equal(count(purchase.purchase.id, 'PURCHASE'), 2);
    assert.equal(ledger(p), 4n);
    assert.equal(cost(p), '10.00');
    assert.equal(
      query(`SELECT count(*) FROM public.expenses WHERE purchase_id='${purchase.purchase.id}';`),
      '1',
    );
  });
  await run('concurrent void replay preserves duplicate compensation and audit', async () => {
    const p = product(),
      purchase = buy([p, p], 2),
      op = id();
    const expr = voidExpr(purchase, op);
    const [first, second] = await race(`SELECT ${expr};`, `SELECT ${expr};`);
    const result = JSON.parse(first);
    assert.deepEqual(JSON.parse(second), result);
    assert.equal(auditCount(purchase), '1');
    assert.equal(count(result.correction.id, 'PURCHASE_VOID'), 2);
    assert.equal(ledger(p), 0n);
    assert.equal(cost(p), '10.00');
  });
  await run(
    'same operation in different businesses finishes while first remains uncommitted',
    async () => {
      const p = product(),
        other = product(1),
        op = id();
      await begin(a);
      await a.sql(`SELECT ${adjust(p, 2, op)};`);
      await begin(b, 1);
      await b.sql(`SELECT ${adjust(other, 3, op, 1)};`);
      await b.sql('COMMIT;'); // Must complete BEFORE releasing A; no global operation key.
      assert.equal(
        query(`SELECT state FROM pg_stat_activity WHERE pid=${a.pid};`),
        'idle in transaction',
      );
      assert.equal(ledger(other, 1), 3n);
      assert.equal(ledger(p), 0n, 'A still uncommitted');
      await a.sql('COMMIT;');
      assert.equal(ledger(p), 2n);
      assert.equal(count(op, 'STOCK_ADJUSTMENT'), 2);
    },
  );
  await run(
    'concurrent serialized cost application beats purchased_at, replay and void',
    async () => {
      const p = product(),
        firstOp = id();
      const [first, second] = await race(
        `SELECT ${buyExpr([p], 1, firstOp, '10.00', '2026-09-20T12:00Z')};`,
        `SELECT ${buyExpr([p], 1, id(), '12.00', '2026-01-01T12:00Z')};`,
      );
      assert.equal(cost(p), '12.00');
      asOwner(`SELECT ${buyExpr([p], 1, firstOp)};`);
      assert.equal(cost(p), '12.00');
      asOwner(`SELECT ${voidExpr(JSON.parse(first))};`);
      asOwner(`SELECT ${voidExpr(JSON.parse(second))};`);
      assert.equal(cost(p), '12.00');
      assert.equal(ledger(p), 0n);
    },
  );
  await run(
    'OWNER revoked during the new early business wait cannot persist a purchase',
    async () => {
      const p = product(),
        op = id();
      await holder.sql(
        `BEGIN; SELECT id FROM public.businesses WHERE id='${businesses[0]}' FOR NO KEY UPDATE;`,
      );
      await begin(a);
      const waiting = a.sql(`DO $$ DECLARE d text; BEGIN BEGIN
      PERFORM ${buyExpr([p], 1, op)};
      RAISE EXCEPTION 'BF302 revoked owner accepted';
      EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
        IF d IS DISTINCT FROM 'ACCESS_DENIED' THEN RAISE EXCEPTION 'BF302 wrong access signal'; END IF;
      END; END $$;`);
      await blocked(a, holder);
      query(
        `UPDATE public.business_members SET is_active=false WHERE business_id='${businesses[0]}' AND user_id='${owners[0]}';`,
      );
      try {
        await holder.sql('COMMIT;');
        await waiting;
        await a.sql('COMMIT;');
        assert.equal(
          query(`SELECT count(*) FROM public.purchases WHERE operation_id='${op}';`),
          '0',
        );
        assert.equal(ledger(p), 0n);
        assert.equal(cost(p), '7.00');
      } finally {
        query(
          `UPDATE public.business_members SET is_active=true WHERE business_id='${businesses[0]}' AND user_id='${owners[0]}';`,
        );
      }
    },
  );
  assert.equal(cases, 17, 'all intended concurrent schedules discovered');
  console.log(`BF302 concurrency PASS ${cases}/17 real coordinated cases`);
}
main()
  .catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(sessions.map((s) => s.close()));
  });
