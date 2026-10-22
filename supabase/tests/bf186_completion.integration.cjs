const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { query } = require('./helpers/local-postgres.cjs');
const { checkoutFixture } = require('./helpers/checkout-appointment-fixture.cjs');
for (const status of ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) {
  test(`BF186 real checkout eligibility ${status}`, () => {
    const f = checkoutFixture(),
      op = randomUUID(),
      eligible = ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(status);
    const action = eligible ? f.pipeline(op) : f.expect(`PERFORM ${f.sale(op)}`, 'PT409');
    const result =
      query(`BEGIN;${f.sql}UPDATE public.appointments SET status='${status}' WHERE id='${f.appointment}';${f.identity()}
      ${action} SELECT status FROM public.appointments WHERE id='${f.appointment}';ROLLBACK;`);
    assert.equal(result.split('\n').at(-1), eligible ? 'COMPLETED' : status);
  });
}
for (const actor of ['barber', 'other', 'inactive', 'anonymous', 'foreign']) {
  test(`BF186 denies ${actor} before replay`, () => {
    const f = checkoutFixture(),
      op = randomUUID();
    const setup =
      actor === 'inactive'
        ? `UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`
        : '';
    const identity = f.identity(
      actor === 'anonymous'
        ? ''
        : actor === 'barber'
          ? f.barber
          : actor === 'other'
            ? f.other
            : f.owner,
    );
    const call =
      actor === 'foreign'
        ? `private.complete_checkout_appointment('${f.foreignBusiness}','${op}')`
        : f.completion(op);
    const result = query(`BEGIN;${f.sql}${f.identity()}SELECT ${f.sale(op)};${setup}${identity}
      ${f.expect(`PERFORM ${call}`, '42501')} SELECT status FROM public.appointments WHERE id='${f.appointment}';ROLLBACK;`);
    assert.equal(result.split('\n').at(-1), 'PENDING');
  });
}
test('BF186 full-slice replay preserves appointment, sale, items and effects', () => {
  const f = checkoutFixture(),
    op = randomUUID();
  const result = query(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}
    CREATE TEMP TABLE before186 AS SELECT to_jsonb(a) v FROM public.appointments a WHERE id='${f.appointment}';
    ${f.pipeline(op)}
    SELECT (SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}')=(SELECT v FROM before186),
      (SELECT count(*) FROM public.sales WHERE operation_id='${op}'),
      (SELECT count(*) FROM public.sale_items WHERE sale_id=(SELECT id FROM public.sales WHERE operation_id='${op}')),
      (SELECT count(*) FROM public.payments WHERE business_id='${f.business}'),
      (SELECT count(*) FROM public.stock_movements WHERE business_id='${f.business}');ROLLBACK;`);
  assert.equal(result.split('\n').at(-1), 't|1|1|0|0');
});
test('BF186 different operation cannot complete original appointment twice', () => {
  const f = checkoutFixture(),
    op = randomUUID();
  const result = query(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}
    ${f.expect(`PERFORM ${f.sale(randomUUID())}`, 'PT409')}
    SELECT count(*) FROM public.sales WHERE business_id='${f.business}';ROLLBACK;`);
  assert.equal(result.split('\n').at(-1), '1');
});
for (const stage of ['items', 'payment', 'stock', 'simulated']) {
  test(`BF186 completion rolls back on downstream ${stage} failure`, () => {
    const f = checkoutFixture(),
      op = randomUUID();
    const failure =
      stage === 'items'
        ? `PERFORM private.persist_checkout_items('${f.business}','${op}','[]');`
        : stage === 'payment'
          ? `PERFORM private.persist_checkout_payment('${f.business}','${op}','OTHER');`
          : stage === 'stock'
            ? `PERFORM private.persist_checkout_stock('${f.business}','${op}');`
            : `RAISE EXCEPTION USING ERRCODE='ZT186';`;
    const result = query(`BEGIN;${f.sql}${f.identity()}
      DO $$ BEGIN BEGIN PERFORM ${f.sale(op)}; PERFORM ${f.completion(op)};${failure}
        RAISE EXCEPTION 'Missing failure'; EXCEPTION WHEN SQLSTATE '${stage === 'simulated' ? 'ZT186' : '22023'}' THEN NULL;END; END $$;
      SELECT status,(SELECT count(*) FROM public.sales WHERE operation_id='${op}') FROM public.appointments WHERE id='${f.appointment}';ROLLBACK;`);
    assert.equal(result.split('\n').at(-1), 'PENDING|0');
  });
}
test('BF186 direct sale skips linked stage without fabricating appointment', () => {
  const f = checkoutFixture(),
    op = randomUUID();
  const result = query(
    `BEGIN;${f.sql}${f.identity()}SELECT ${f.sale(op, null)};SELECT (${f.completion(op)}).id IS NULL;ROLLBACK;`,
  );
  assert.equal(result.split('\n').at(-1), 't');
});
test('BF186 missing persisted operation fails safely', () => {
  const f = checkoutFixture();
  query(
    `BEGIN;${f.sql}${f.identity()}${f.expect(`PERFORM ${f.completion(randomUUID())}`, '22023')}ROLLBACK;`,
  );
});
test('BF186 positive product sale replays one payment and one stock debit', () => {
  const f = checkoutFixture(),
    op = randomUUID(),
    product = randomUUID();
  const pipeline = `DO $$ BEGIN
    PERFORM private.persist_checkout_sale('${f.business}','${op}','${f.appointment}',NULL,10,0,10);
    PERFORM private.lock_checkout_products('${f.business}',ARRAY['${product}'::uuid],ARRAY[1]);
    PERFORM private.persist_checkout_items('${f.business}','${op}','[{"itemType":"PRODUCT","itemId":"${product}","quantity":1}]');
    PERFORM private.persist_checkout_payment('${f.business}','${op}','CASH');
    PERFORM private.persist_checkout_stock('${f.business}','${op}');
    PERFORM ${f.completion(op)};END $$;`;
  // Stock preflight is new-operation only: a historical replay returns original
  // effects even after all stock has been sold. Exercise existing stages directly.
  const replay = pipeline.replace(
    `PERFORM private.lock_checkout_products('${f.business}',ARRAY['${product}'::uuid],ARRAY[1]);`,
    '',
  );
  const result = query(`BEGIN;${f.sql}
    INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES('${product}','${f.business}','Product',10,4);
    INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES('${f.business}','${product}','ADJUSTMENT',1,'${f.owner}');
    ${f.identity()}${pipeline}${replay}
    SELECT (SELECT count(*) FROM public.sales WHERE operation_id='${op}'),
      (SELECT count(*) FROM public.payments WHERE business_id='${f.business}'),
      (SELECT count(*) FROM public.stock_movements WHERE business_id='${f.business}' AND type='SALE'),
      (SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id='${product}'),
      (SELECT status FROM public.appointments WHERE id='${f.appointment}');ROLLBACK;`);
  assert.equal(result.split('\n').at(-1), '1|1|1|0|COMPLETED');
});
test('BF186 insufficient stock rolls back completion, items, payment and sale', () => {
  const f = checkoutFixture(),
    op = randomUUID(),
    product = randomUUID();
  const result = query(`BEGIN;${f.sql}
    INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES('${product}','${f.business}','Product',10,4);
    ${f.identity()}DO $$ BEGIN BEGIN
      PERFORM private.persist_checkout_sale('${f.business}','${op}','${f.appointment}',NULL,10,0,10);
      PERFORM private.persist_checkout_items('${f.business}','${op}','[{"itemType":"PRODUCT","itemId":"${product}","quantity":1}]');
      PERFORM private.persist_checkout_payment('${f.business}','${op}','CASH');
      PERFORM ${f.completion(op)};
      PERFORM private.persist_checkout_stock('${f.business}','${op}');
      RAISE EXCEPTION 'Expected insufficient stock';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;END $$;
      SELECT (SELECT status FROM public.appointments WHERE id='${f.appointment}'),
        (SELECT count(*) FROM public.sales WHERE operation_id='${op}'),
        (SELECT count(*) FROM public.payments WHERE business_id='${f.business}'),
        (SELECT count(*) FROM public.stock_movements WHERE product_id='${product}');ROLLBACK;`);
  assert.equal(result.split('\n').at(-1), 'PENDING|0|0|0');
});
