const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { query } = require('./helpers/local-postgres.cjs');
const { replayFixture } = require('./helpers/checkout-replay-fixture.cjs');
const last = (sql) => query(sql).split('\n').at(-1);

test('BF187 unknown authorized operation returns NULL without effects', () => {
  const f = replayFixture();
  assert.equal(
    last(`BEGIN;${f.sql}${f.identity()}SELECT ${f.gate(randomUUID())} IS NULL;ROLLBACK;`),
    't',
  );
});
test('BF187 exact persisted outcome, duplicate lines, one payment/debit set, completion unchanged', () => {
  const f = replayFixture(),
    op = randomUUID();
  const result = query(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}${f.snapshot(op)}
    ${f.pipeline(op)}${f.snapshot(op)}ROLLBACK;`)
    .split('\n')
    .filter((x) => x.startsWith('{'));
  assert.equal(result.length, 2);
  assert.equal(result[0], result[1]);
  const history = JSON.parse(result[0]),
    out = history.outcome;
  assert.deepEqual(Object.keys(out).sort(), ['items', 'payments', 'sale']);
  assert.equal(Object.keys(out.sale).length, 13);
  assert.equal(out.items.length, 3);
  assert.equal(out.items.filter((i) => i.item_type === 'PRODUCT').length, 2);
  assert.ok(out.items.every((i) => Object.keys(i).length === 11));
  assert.equal(out.payments.length, 1);
  assert.equal(Object.keys(out.payments[0]).length, 9);
  assert.equal(out.payments[0].amount, 20);
  assert.equal(history.sales, 1);
  assert.equal(history.movements.filter((m) => m.type === 'SALE').length, 2);
  assert.equal(history.appointment.status, 'COMPLETED');
  const sorted = [...out.items].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  assert.deepEqual(out.items, sorted);
});
test('BF187 replay never validates new payload or catalog, stock depleted and inactive business/catalog', () => {
  const f = replayFixture(),
    op = randomUUID();
  const result = query(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}SELECT ${f.gate(op)};
    UPDATE public.products SET name='Later',sale_price=900,default_purchase_cost=800,is_active=false WHERE id='${f.product}';
    UPDATE public.services SET name='Later',price=500,is_active=false WHERE id='${f.service}';
    UPDATE public.businesses SET is_active=false WHERE id='${f.business}';
    DO $$ BEGIN IF ${f.gate(op)} IS NULL THEN RAISE EXCEPTION 'New input would be processed'; END IF; END $$;
    SELECT ${f.gate(op)};ROLLBACK;`)
    .split('\n')
    .filter((x) => x.startsWith('{'));
  assert.equal(result[0], result[1]);
});
test('BF187 different operation cannot consume completed appointment', () => {
  const f = replayFixture(),
    op = randomUUID(),
    next = randomUUID();
  assert.equal(
    last(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}
    ${f.expect(`PERFORM ${f.header(next)}`, 'PT409')}
    SELECT count(*) FROM public.sales WHERE business_id='${f.business}';ROLLBACK;`),
    '1',
  );
});
for (const actor of ['barber', 'stranger', 'inactive', 'anonymous', 'foreign']) {
  test(`BF187 validates ${actor} before returning persisted outcome`, () => {
    const f = replayFixture(),
      op = randomUUID();
    const setup =
      actor === 'inactive'
        ? `UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`
        : '';
    const user =
      actor === 'anonymous'
        ? ''
        : actor === 'barber'
          ? f.barber
          : actor === 'stranger'
            ? f.other
            : f.owner;
    query(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}${setup}${f.identity(user)}
      ${f.expect(`PERFORM ${f.gate(op, actor === 'foreign' ? f.foreignBusiness : f.business)}`, '42501')}ROLLBACK;`);
  });
}
test('BF187 another active OWNER is authorized, operation is business scoped not actor/payload scoped', () => {
  const f = replayFixture(),
    op = randomUUID();
  const result = query(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}SELECT ${f.gate(op)};
    INSERT INTO public.business_members(business_id,user_id,role) VALUES('${f.business}','${f.other}','OWNER');
    ${f.identity(f.other)}SELECT ${f.gate(op)};ROLLBACK;`)
    .split('\n')
    .filter((x) => x.startsWith('{'));
  assert.equal(result[0], result[1]);
});
for (const partial of [
  'DRAFT',
  'header',
  'items',
  'payment',
  'stock',
  'missingPayment',
  'extraPayment',
  'badStock',
  'foreignPayment',
  'foreignService',
  'foreignClient',
]) {
  test(`BF187 rejects ${partial} committed partial/inconsistent state without repair`, () => {
    const f = replayFixture(),
      op = randomUUID();
    let prepare;
    if (partial === 'DRAFT')
      prepare = `INSERT INTO public.sales(business_id,operation_id,status,subtotal,discount,total,created_by) VALUES('${f.business}','${op}','DRAFT',20,0,20,'${f.owner}');`;
    else if (['header', 'items', 'payment', 'stock'].includes(partial)) {
      prepare = `SELECT ${f.header(op)};`;
      if (partial !== 'header')
        prepare += `SELECT private.persist_checkout_items('${f.business}','${op}','[{"itemType":"PRODUCT","itemId":"${f.product}","quantity":2}]');`;
      if (['payment', 'stock'].includes(partial))
        prepare += `SELECT private.persist_checkout_payment('${f.business}','${op}','CASH');`;
      if (partial === 'stock')
        prepare += `SELECT private.persist_checkout_stock('${f.business}','${op}');`;
    } else {
      prepare = f.pipeline(op);
      if (partial === 'missingPayment')
        prepare += `DELETE FROM public.payments WHERE business_id='${f.business}';`;
      if (partial === 'extraPayment')
        prepare += `INSERT INTO public.payments(business_id,sale_id,payment_method,amount,created_by) SELECT business_id,id,'CASH',20,created_by FROM public.sales WHERE operation_id='${op}';`;
      if (partial === 'badStock')
        prepare += `INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by) SELECT business_id,'${f.product}','SALE',-1,4,'SALE',id,created_by FROM public.sales WHERE operation_id='${op}';`;
      if (partial === 'foreignPayment')
        prepare += `UPDATE public.payments SET business_id='${f.foreignBusiness}' WHERE business_id='${f.business}';`;
      if (partial === 'foreignService')
        prepare += `UPDATE public.services SET business_id='${f.foreignBusiness}' WHERE id='${f.service}';`;
      if (partial === 'foreignClient')
        prepare += `UPDATE public.clients SET business_id='${f.foreignBusiness}' WHERE id='${f.client}';`;
    }
    const code = ['foreignService', 'foreignClient'].includes(partial) ? '42501' : '22023';
    query(`BEGIN;${f.sql}${f.identity()}${prepare}
      CREATE TEMP TABLE before187 AS SELECT (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.sale_items i WHERE sale_id IN (SELECT id FROM public.sales WHERE operation_id='${op}')) items,
        (SELECT count(*) FROM public.stock_movements WHERE business_id='${f.business}') movements;
      ${f.expect(`PERFORM ${f.gate(op)}`, code)}
      DO $$ BEGIN IF (SELECT count(*) FROM public.stock_movements WHERE business_id='${f.business}')<>(SELECT movements FROM before187)
        OR (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.sale_items i WHERE sale_id IN (SELECT id FROM public.sales WHERE operation_id='${op}')) IS DISTINCT FROM (SELECT items FROM before187)
        THEN RAISE EXCEPTION 'Replay repaired history'; END IF; END $$;ROLLBACK;`);
  });
}
test('BF187 NULL operation and snapshot isolation fail safely', () => {
  const f = replayFixture();
  query(
    `BEGIN;${f.sql}${f.identity()}${f.expect(`PERFORM private.get_checkout_replay('${f.business}',NULL)`, '22023')}ROLLBACK;`,
  );
  query(
    `BEGIN ISOLATION LEVEL REPEATABLE READ;${f.sql}${f.identity()}${f.expect(`PERFORM ${f.gate(randomUUID())}`, '40001')}ROLLBACK;`,
  );
});

for (const movement of ['missing', 'partial', 'costMismatch']) {
  test(`BF187 rejects completed appointment with ${movement} SALE multiset`, () => {
    const f = replayFixture(),
      op = randomUUID();
    const rows =
      movement === 'missing'
        ? ''
        : `INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
      SELECT business_id,'${f.product}','SALE',${movement === 'partial' ? -1 : -2},${movement === 'partial' ? 4 : 99},'SALE',id,created_by FROM public.sales WHERE operation_id='${op}';`;
    query(`BEGIN;${f.sql}${f.identity()}SELECT ${f.header(op)};
      SELECT private.persist_checkout_items('${f.business}','${op}','[{"itemType":"PRODUCT","itemId":"${f.product}","quantity":2}]');
      SELECT private.persist_checkout_payment('${f.business}','${op}','CASH');
      SELECT ${f.completion(op)};${rows}
      ${f.expect(`PERFORM ${f.gate(op)}`, '22023')}ROLLBACK;`);
  });
}
test('BF187 VOIDED product sale returns original history without changing completion or ledger', () => {
  const f = replayFixture(),
    op = randomUUID();
  const results = query(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}
    UPDATE public.sales SET status='VOIDED' WHERE operation_id='${op}';${f.snapshot(op)}
    ${f.pipeline(op)}${f.snapshot(op)}ROLLBACK;`)
    .split('\n')
    .filter((x) => x.startsWith('{'));
  assert.equal(results[0], results[1]);
  assert.equal(JSON.parse(results[1]).outcome.sale.status, 'VOIDED');
});

test('BF187 authorized other business cannot see an operation outside that key scope', () => {
  const f = replayFixture(),
    op = randomUUID();
  assert.equal(
    last(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}
    INSERT INTO public.business_members(business_id,user_id,role) VALUES('${f.foreignBusiness}','${f.owner}','OWNER');
    SELECT ${f.gate(op, f.foreignBusiness)} IS NULL;ROLLBACK;`),
    't',
  );
});

test('BF187 distinct direct-sale operation IDs are distinct intentions, not payload deduplication', () => {
  const f = replayFixture();
  const operations = [randomUUID(), randomUUID()];
  const stages = operations
    .map(
      (op) => `DO $$ BEGIN IF ${f.gate(op)} IS NULL THEN
    PERFORM ${f.sale(op, null)};
    PERFORM private.persist_checkout_items('${f.business}','${op}','[{"itemType":"SERVICE","itemId":"${f.service}","quantity":1}]');
    PERFORM private.persist_checkout_payment('${f.business}','${op}','CASH');
    PERFORM private.persist_checkout_stock('${f.business}','${op}');
    PERFORM ${f.completion(op)};END IF; END $$;`,
    )
    .join('\n');
  assert.equal(
    last(`BEGIN;${f.sql}${f.identity()}${stages}
    SELECT count(*) FROM public.sales WHERE business_id='${f.business}';ROLLBACK;`),
    '2',
  );
});
