const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { query } = require('./helpers/local-postgres.cjs');
const { saleVoidFixture } = require('./helpers/sale-void-fixture.cjs');
const rows = (sql) =>
  query(sql)
    .split('\n')
    .filter((x) => x.startsWith('{'))
    .map(JSON.parse);
const run = (f, body, options = {}, changes = '') =>
  rows(`BEGIN;${f.setup(options)}${changes}
  ${f.identity()}SET LOCAL ROLE authenticated;${body}RESET ROLE;ROLLBACK;`);
const unchanged = (f, body, changes = '') => {
  const [before, after] = rows(`BEGIN;${f.setup()}${changes}SELECT ${f.history};
    ${body}RESET ROLE;SELECT ${f.history};ROLLBACK;`);
  assert.deepEqual(after, before);
};

test('BF188A mixed duplicated PRODUCT/SERVICE void preserves exact history and stock snapshots', () => {
  const f = saleVoidFixture();
  const [original, out, detail, after] = rows(`BEGIN;${f.setup()}
    UPDATE public.products SET name='Changed',sale_price=999,default_purchase_cost=700,is_active=false WHERE id='${f.product}';
    UPDATE public.services SET name='Changed',price=999,is_active=false WHERE id='${f.service}';
    SELECT outcome FROM original;${f.identity()}SET LOCAL ROLE authenticated;
    SELECT ${f.voidSale()};SELECT ${f.reader()};RESET ROLE;SELECT ${f.history};ROLLBACK;`);
  assert.deepEqual(Object.keys(out).sort(), [
    'correction',
    'items',
    'payments',
    'sale',
    'stockMovements',
  ]);
  assert.equal(Object.keys(out.sale).length, 13);
  assert.deepEqual(out.items, original.items);
  assert.ok(out.items.every((x) => Object.keys(x).length === 11));
  assert.deepEqual(out.payments, original.payments);
  assert.equal(Object.keys(out.payments[0]).length, 9);
  const strip = (s) => {
    const { status, updated_at, ...rest } = s;
    return rest;
  };
  assert.deepEqual(strip(out.sale), strip(original.sale));
  assert.equal(out.sale.status, 'VOIDED');
  assert.equal(Object.keys(out.correction).length, 7);
  assert.equal(out.correction.created_by, f.owner);
  assert.equal(out.correction.reason, '  Original reason  ');
  assert.equal(out.correction.operation_id, f.operation);
  assert.match(out.correction.id, /^[a-f0-9-]{36}$/);
  assert.ok(out.correction.created_at);
  assert.equal(out.stockMovements.length, 2);
  for (const m of out.stockMovements) {
    assert.equal(Object.keys(m).length, 12);
    assert.equal(m.type, 'RETURN');
    assert.equal(m.product_id, f.product);
    assert.equal(m.quantity_delta, 1);
    assert.equal(m.unit_cost, 4);
    assert.equal(m.reference_type, 'SALE_VOID');
    assert.equal(m.reference_id, out.correction.id);
    assert.equal(m.notes, null);
    assert.equal(m.created_by, f.owner);
    assert.equal(m.created_at, out.correction.created_at);
    assert.equal(m.occurred_at, out.correction.created_at);
  }
  assert.deepEqual(detail, { correction: out.correction, stockMovements: out.stockMovements });
  assert.equal(after.sales.length, 1);
  assert.equal(after.audit.length, 1);
  assert.equal(after.audit[0].id, out.correction.id);
  assert.equal(after.appointment.status, 'COMPLETED');
  assert.equal(
    after.ledger.reduce((sum, m) => sum + m.quantity_delta, 0),
    2,
  );
  assert.equal(after.ledger.filter((m) => m.type === 'SALE').length, 2);
});

test('BF188A read-only COMPLETED reader returns exact null/empty shape', () => {
  const f = saleVoidFixture();
  assert.deepEqual(run(f, `SELECT ${f.reader()};`), [{ correction: null, stockMovements: [] }]);
});
test('BF188A identical replay, second active OWNER, and completion UUID domain separation', () => {
  const f = saleVoidFixture();
  const [a, b, c] = rows(`BEGIN;${f.setup()}${f.identity()}SET LOCAL ROLE authenticated;
 SELECT ${f.voidSale()};SELECT ${f.voidSale()};RESET ROLE;
 INSERT INTO public.business_members(business_id,user_id,role) VALUES('${f.business}','${f.other}','OWNER');
 ${f.identity(f.other)}SET LOCAL ROLE authenticated;SELECT ${f.voidSale()};RESET ROLE;ROLLBACK;`);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  const sameDomain = saleVoidFixture();
  const [result] = run(
    sameDomain,
    `SELECT public.void_sale('${sameDomain.business}',(SELECT outcome->'sale'->>'operation_id' FROM original)::uuid,${sameDomain.saleId},'reason');`,
  );
  assert.equal(result.sale.status, 'VOIDED');
});
for (const actor of ['barber', 'stranger', 'inactive', 'anonymous', 'foreign'])
  for (const action of ['void', 'read'])
    test(`BF188A ${actor} cannot ${action} and creates no effects`, () => {
      const f = saleVoidFixture();
      let identity = f.identity(
        actor === 'barber'
          ? f.barber
          : actor === 'stranger'
            ? f.other
            : actor === 'anonymous'
              ? ''
              : f.owner,
      );
      const changes =
        actor === 'inactive'
          ? `UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`
          : '';
      const expression =
        action === 'void'
          ? f.voidSale(undefined, undefined, actor === 'foreign' ? f.foreignBusiness : f.business)
          : f.reader(actor === 'foreign' ? f.foreignBusiness : f.business);
      unchanged(
        f,
        `${identity}SET LOCAL ROLE ${actor === 'anonymous' ? 'anon' : 'authenticated'};${f.expect(expression, '42501')}`,
        changes,
      );
    });
for (const [name, op, reason, target, code, detail] of [
  ['null operation', null, 'reason', null, '22023', 'INVALID_INPUT'],
  ['null reason', 'random', null, null, '22023', 'INVALID_INPUT'],
  ['empty reason', 'random', '', null, '22023', 'INVALID_INPUT'],
  ['ASCII whitespace', 'random', '    ', null, '22023', 'INVALID_INPUT'],
  ['null sale', 'random', 'reason', 'NULL', '22023', 'INVALID_INPUT'],
  ['unknown sale', 'random', 'reason', `'${randomUUID()}'`, 'PT404', 'NOT_FOUND'],
  ['malformed operation', 'bad-uuid', 'reason', null, '22P02', null],
])
  test(`BF188A ${name} safely rejected without changes`, () => {
    const f = saleVoidFixture();
    unchanged(
      f,
      `${f.identity()}SET LOCAL ROLE authenticated;${f.expect(f.voidSale(op === 'random' ? randomUUID() : op, reason, f.business, target || f.saleId), code, detail)}`,
    );
  });
test('BF188A validates ASCII spaces without destructive trim or rejecting tab text', () => {
  const f = saleVoidFixture();
  const [out] = run(f, `SELECT ${f.voidSale(undefined, '\t')};`);
  assert.equal(out.correction.reason, '\t');
});
for (const action of ['void', 'read'])
  test(`BF188A ${action} foreign sale and missing sale indistinguishable`, () => {
    const f = saleVoidFixture();
    const unknown = `'${randomUUID()}'`;
    const changes = `UPDATE public.sales SET business_id='${f.foreignBusiness}' WHERE id=${f.saleId};`;
    const expr = (target) =>
      action === 'void'
        ? f.voidSale(undefined, undefined, undefined, target)
        : f.reader(undefined, target);
    unchanged(
      f,
      `${f.identity()}SET LOCAL ROLE authenticated;${f.expect(expr(f.saleId), 'PT404', 'NOT_FOUND')}${f.expect(expr(unknown), 'PT404', 'NOT_FOUND')}`,
      changes,
    );
  });
for (const variant of ['reason', 'sale', 'new-key', 'auth-loss'])
  test(`BF188A ${variant} replay rejected with no second effects`, () => {
    const f = saleVoidFixture();
    const first = `${f.identity()}SET LOCAL ROLE authenticated;SELECT ${f.voidSale()};RESET ROLE;`;
    let expr = f.voidSale();
    let code = 'PT409',
      detail = 'CONFLICT',
      changes = '';
    if (variant === 'reason') expr = f.voidSale(undefined, 'changed');
    if (variant === 'sale')
      ((expr = f.voidSale(undefined, undefined, undefined, `'${randomUUID()}'`)),
        (code = 'PT404'),
        (detail = 'NOT_FOUND'));
    if (variant === 'new-key') ((expr = f.voidSale(randomUUID())), (detail = 'INVALID_STATUS'));
    if (variant === 'auth-loss')
      ((changes = `UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`),
        (code = '42501'),
        (detail = 'ACCESS_DENIED'));
    const result = rows(
      `BEGIN;${f.setup()}${first}${changes}SELECT ${f.history};${f.identity()}SET LOCAL ROLE authenticated;${f.expect(expr, code, detail)}RESET ROLE;SELECT ${f.history};ROLLBACK;`,
    );
    assert.deepEqual(result.at(-1), result.at(-2));
  });
test('BF188A same key targeting another existing sale conflicts', () => {
  const f = saleVoidFixture();
  const result = rows(`BEGIN;${f.setup()}${f.identity()}SET LOCAL ROLE authenticated;
 SELECT ${f.voidSale()};CREATE TEMP TABLE second AS SELECT ${f.checkout(randomUUID(), { appointmentId: null, items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 1 }] })} AS outcome;
 RESET ROLE;SELECT ${f.history};${f.identity()}SET LOCAL ROLE authenticated;
 ${f.expect(f.voidSale(undefined, undefined, undefined, "((SELECT outcome FROM second)->'sale'->>'id')::uuid"), 'PT409', 'CONFLICT')}
 RESET ROLE;SELECT ${f.history};ROLLBACK;`);
  assert.deepEqual(result.at(-1), result.at(-2));
});
test('BF188A DRAFT is not voidable', () => {
  const f = saleVoidFixture();
  unchanged(
    f,
    `${f.identity()}SET LOCAL ROLE authenticated;${f.expect(f.voidSale(), 'PT409', 'INVALID_STATUS')}`,
    `UPDATE public.sales SET status='DRAFT' WHERE id=${f.saleId};`,
  );
});
for (const defect of [
  'missing-debit',
  'wrong-debit',
  'missing-payment',
  'wrong-payment',
  'wrong-total',
  'voided-without-audit',
])
  test(`BF188A incomplete ${defect} rejects instead of repairing history`, () => {
    const f = saleVoidFixture();
    let changes = '';
    if (defect.includes('debit'))
      changes = `ALTER TABLE public.stock_movements DISABLE TRIGGER stock_movements_append_only;${defect === 'missing-debit' ? `DELETE FROM public.stock_movements WHERE type='SALE' AND product_id='${f.product}';` : `UPDATE public.stock_movements SET unit_cost=999 WHERE type='SALE' AND product_id='${f.product}';`}ALTER TABLE public.stock_movements ENABLE TRIGGER stock_movements_append_only;`;
    if (defect === 'missing-payment')
      changes = `DELETE FROM public.payments WHERE sale_id=${f.saleId};`;
    if (defect === 'wrong-payment')
      changes = `UPDATE public.payments SET amount=1 WHERE sale_id=${f.saleId};`;
    if (defect === 'wrong-total')
      changes = `UPDATE public.sales SET subtotal=1,total=1 WHERE id=${f.saleId};`;
    if (defect === 'voided-without-audit')
      changes = `UPDATE public.sales SET status='VOIDED' WHERE id=${f.saleId};`;
    unchanged(
      f,
      `${f.identity()}SET LOCAL ROLE authenticated;${f.expect(f.voidSale(), 'PT409', 'INCOMPLETE_HISTORY')}${f.expect(f.reader(), 'PT409', 'INCOMPLETE_HISTORY')}`,
      changes,
    );
  });
for (const target of ['audit', 'ledger', 'sale'])
  test(`BF188A injected ${target} failure rolls back entire correction`, () => {
    const f = saleVoidFixture();
    const relation =
      target === 'audit'
        ? 'private.sale_voids'
        : target === 'ledger'
          ? 'public.stock_movements'
          : 'public.sales';
    const changes = `CREATE FUNCTION pg_temp.fail_void() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 ${target === 'ledger' ? "IF NEW.type<>'RETURN' THEN RETURN NEW;END IF; IF current_setting('bf188a.seen',true) IS DISTINCT FROM '1' THEN PERFORM set_config('bf188a.seen','1',true);RETURN NEW;END IF;" : ''}
 RAISE EXCEPTION 'injected void failure';END $$;
 CREATE TRIGGER bf188a_failure BEFORE ${target === 'sale' ? 'UPDATE' : 'INSERT'} ON ${relation} FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_void();`;
    unchanged(
      f,
      `${f.identity()}SET LOCAL ROLE authenticated;${f.expect(f.voidSale(), 'P0001')}`,
      changes,
    );
  });
for (const operation of [
  'SELECT * FROM private.sale_voids',
  'INSERT INTO private.sale_voids DEFAULT VALUES',
  'UPDATE private.sale_voids SET reason=reason',
  'DELETE FROM private.sale_voids',
  'TRUNCATE private.sale_voids',
])
  test(`BF188A authenticated cannot ${operation.split(' ')[0]} private audit`, () => {
    const f = saleVoidFixture();
    query(
      `BEGIN;${f.identity()}SET LOCAL ROLE authenticated;DO $$ DECLARE denied boolean:=false;BEGIN BEGIN ${operation};EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'audit exposed';END IF;END $$;ROLLBACK;`,
    );
  });
test('BF188A privileged UPDATE/DELETE of audit and RETURN are blocked by immutable triggers', () => {
  const f = saleVoidFixture();
  let body = `SELECT ${f.voidSale()};RESET ROLE;`;
  for (const statement of [
    'UPDATE private.sale_voids SET reason=reason',
    'DELETE FROM private.sale_voids',
    "UPDATE public.stock_movements SET notes='changed' WHERE type='RETURN'",
    "DELETE FROM public.stock_movements WHERE type='RETURN'",
  ])
    body += `DO $$ DECLARE rejected boolean:=false;BEGIN BEGIN ${statement};EXCEPTION WHEN SQLSTATE '55000' THEN rejected:=true;END;
   IF NOT rejected THEN RAISE EXCEPTION 'immutable history changed';END IF;END $$;`;
  run(f, body);
});
test('BF188A service-only free sale returns no payments or stock movements', () => {
  const f = saleVoidFixture();
  const [out] = run(f, `SELECT ${f.voidSale()};`, {
    items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 3 }],
  });
  assert.deepEqual(out.payments, []);
  assert.deepEqual(out.stockMovements, []);
  assert.equal(out.sale.total, 0);
});
test('BF188A free PRODUCT sale still restores its historical quantity', () => {
  const f = saleVoidFixture();
  const [out] = run(f, `SELECT ${f.voidSale()};`, {
    items: [{ itemType: 'PRODUCT', itemId: f.product, quantity: 2, unitPriceOverride: '0.00' }],
  });
  assert.deepEqual(out.payments, []);
  assert.equal(out.stockMovements.length, 1);
  assert.equal(out.stockMovements[0].quantity_delta, 2);
});
test('BF188A void excludes original-period effective revenue without a refund', () => {
  const f = saleVoidFixture();
  const aggregate = `SELECT jsonb_build_object('revenue',coalesce(sum(total_revenue::numeric),0)) FROM public.get_revenue_by_day('${f.business}',NULL,NULL)`;
  const [before, out, after] = run(f, `${aggregate};SELECT ${f.voidSale()};${aggregate};`);
  assert.equal(before.revenue, 20);
  assert.equal(after.revenue, 0);
  assert.equal(out.payments.length, 1);
  assert.equal(out.payments[0].amount, 20);
});
for (const defect of ['missing', 'extra', 'wrong-cost', 'wrong-audit'])
  test(`BF188A ${defect} compensation rejects reader and replay`, () => {
    const f = saleVoidFixture();
    const corrupt =
      defect === 'wrong-audit'
        ? `ALTER TABLE private.sale_voids DISABLE TRIGGER sale_voids_append_only;UPDATE private.sale_voids SET created_at=created_at-interval '1 day';ALTER TABLE private.sale_voids ENABLE TRIGGER sale_voids_append_only;`
        : defect === 'extra'
          ? `INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by) SELECT business_id,'${f.product}','RETURN',1,4,'SALE_VOID',id,created_by FROM private.sale_voids;`
          : `ALTER TABLE public.stock_movements DISABLE TRIGGER stock_movements_append_only;${defect === 'missing' ? "DELETE FROM public.stock_movements WHERE reference_type='SALE_VOID';" : "UPDATE public.stock_movements SET unit_cost=900 WHERE reference_type='SALE_VOID';"}ALTER TABLE public.stock_movements ENABLE TRIGGER stock_movements_append_only;`;
    const result =
      rows(`BEGIN;${f.setup()}${f.identity()}SET LOCAL ROLE authenticated;SELECT ${f.voidSale()};RESET ROLE;${corrupt}
 SELECT ${f.history};${f.identity()}SET LOCAL ROLE authenticated;
 ${f.expect(f.voidSale(), 'PT409', 'INCOMPLETE_HISTORY')}${f.expect(f.reader(), 'PT409', 'INCOMPLETE_HISTORY')}
 RESET ROLE;SELECT ${f.history};ROLLBACK;`);
    assert.deepEqual(result.at(-1), result.at(-2));
  });
