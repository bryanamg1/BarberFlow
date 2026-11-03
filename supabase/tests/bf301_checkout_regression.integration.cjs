const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { query } = require('./helpers/local-postgres.cjs');
const { completeCheckoutFixture } = require('./helpers/complete-checkout-fixture.cjs');

const rows = (sql) =>
  query(sql)
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map(JSON.parse);
const initial = { sales: 0, items: 0, payments: 0, debits: 0, stock: 2, appointment: 'PENDING' };
const completed = {
  sales: 1,
  items: 3,
  payments: 1,
  debits: 2,
  stock: 0,
  appointment: 'COMPLETED',
};
const ordered = (items) => items.slice().sort((a, b) => a.id.localeCompare(b.id));

test('BF301 committed checkout → catalog change → replay → actual void → replay preserves one historical effect set', () => {
  const f = completeCheckoutFixture();
  const operation = randomUUID();
  const correction = randomUUID();
  const [original] = rows(`BEGIN;${f.sql}${f.identity()}SET LOCAL ROLE authenticated;
    SELECT ${f.checkout(operation)};COMMIT;`);
  assert.equal(original.sale.status, 'COMPLETED');
  assert.equal(original.sale.subtotal, 20);
  assert.equal(original.sale.total, 20);
  assert.equal(original.sale.created_by, f.owner);
  assert.equal(original.sale.client_id, f.client);
  assert.equal(original.payments[0].amount, 20);
  assert.equal(original.payments[0].payment_method, 'CASH');
  assert.deepEqual(rows(f.stats + ';')[0], completed);

  const [replay, voided, replayVoided, replayCorrection, stats] = rows(`BEGIN;
    UPDATE public.products SET name='Later product',sale_price=99,default_purchase_cost=88,is_active=false WHERE id='${f.product}';
    UPDATE public.services SET name='Later service',price=77,is_active=false WHERE id='${f.service}';
    ${f.identity()}SET LOCAL ROLE authenticated;
    SELECT ${f.checkout(operation, { items: null, method: null, discount: null })};
    SELECT public.void_sale('${f.business}','${correction}','${original.sale.id}','  BF301 correction  ');
    SELECT ${f.checkout(operation, { items: [], method: null, discount: null })};
    SELECT public.void_sale('${f.business}','${correction}','${original.sale.id}','  BF301 correction  ');
    RESET ROLE;${f.stats};COMMIT;`);
  assert.deepEqual(replay, original);
  assert.equal(voided.sale.status, 'VOIDED');
  assert.deepEqual(ordered(voided.items), ordered(original.items));
  assert.deepEqual(voided.payments, original.payments);
  assert.deepEqual(replayVoided.items, original.items);
  assert.deepEqual(replayVoided.payments, original.payments);
  assert.equal(replayVoided.sale.status, 'VOIDED');
  assert.equal(replayVoided.sale.sold_at, original.sale.sold_at);
  assert.equal(replayVoided.sale.total, original.sale.total);
  assert.deepEqual(replayCorrection, voided);
  assert.equal(voided.correction.reason, '  BF301 correction  ');
  assert.equal(voided.stockMovements.length, 2);
  for (const movement of voided.stockMovements) {
    assert.equal(movement.type, 'RETURN');
    assert.equal(movement.quantity_delta, 1);
    assert.equal(movement.unit_cost, 4);
    assert.equal(movement.reference_id, voided.correction.id);
  }
  assert.deepEqual(stats, { ...completed, stock: 2 });
  const [history] = rows(`SELECT jsonb_build_object(
    'sale_debits',(SELECT count(*) FROM public.stock_movements WHERE business_id='${f.business}' AND type='SALE'),
    'returns',(SELECT count(*) FROM public.stock_movements WHERE business_id='${f.business}' AND reference_type='SALE_VOID'),
    'corrections',(SELECT count(*) FROM private.sale_voids WHERE business_id='${f.business}'),
    'reference_cost',(SELECT default_purchase_cost::text FROM public.products WHERE id='${f.product}'));`);
  assert.deepEqual(history, {
    sale_debits: 2,
    returns: 2,
    corrections: 1,
    reference_cost: '88.00',
  });
});

for (const stage of ['sales', 'sale_items', 'payments', 'stock_movements', 'appointments']) {
  test(`BF301 failure after ${stage} leaves operation reusable with exactly one successful retry`, () => {
    const f = completeCheckoutFixture();
    const operation = randomUUID();
    const event = stage === 'appointments' ? 'UPDATE' : 'INSERT';
    const when =
      stage === 'appointments'
        ? "WHEN (NEW.status='COMPLETED')"
        : stage === 'stock_movements'
          ? "WHEN (NEW.type='SALE')"
          : '';
    const [afterFailure, retry, afterRetry] = rows(`BEGIN;${f.sql}
      CREATE FUNCTION pg_temp.bf301_fail() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION USING ERRCODE='ZT301',MESSAGE='Controlled BF301 fault';END $$;
      CREATE TRIGGER bf301_fault AFTER ${event} ON public.${stage} FOR EACH ROW ${when} EXECUTE FUNCTION pg_temp.bf301_fail();
      ${f.identity()}SET LOCAL ROLE authenticated;
      ${f.expect(`PERFORM ${f.checkout(operation)}`, 'ZT301')}
      RESET ROLE;${f.stats};DROP TRIGGER bf301_fault ON public.${stage};
      SET LOCAL ROLE authenticated;SELECT ${f.checkout(operation)};RESET ROLE;${f.stats};ROLLBACK;`);
    assert.deepEqual(afterFailure, initial);
    assert.equal(retry.sale.operation_id, operation);
    assert.equal(retry.sale.total, 20);
    assert.deepEqual(afterRetry, completed);
  });
}

test('BF301 caller rollback cancels a successful checkout and permits later commit of the same operation', () => {
  const f = completeCheckoutFixture();
  const operation = randomUUID();
  query(`BEGIN;${f.sql}COMMIT;`);
  const [rolledBack] = rows(`BEGIN;${f.identity()}SET LOCAL ROLE authenticated;
    SELECT ${f.checkout(operation)};ROLLBACK;`);
  assert.equal(rolledBack.sale.status, 'COMPLETED');
  assert.deepEqual(rows(f.stats + ';')[0], initial);
  const [committed] = rows(`BEGIN;${f.identity()}SET LOCAL ROLE authenticated;
    SELECT ${f.checkout(operation)};COMMIT;`);
  assert.notEqual(committed.sale.id, rolledBack.sale.id);
  assert.equal(committed.sale.operation_id, operation);
  assert.deepEqual(rows(f.stats + ';')[0], completed);
});

for (const free of [false, true]) {
  test(`BF301 zero total (${free ? 'free catalog' : 'full global discount'}) keeps stock/completion without manufacturing a payment`, () => {
    const f = completeCheckoutFixture();
    const [out, replay, stats] = rows(`BEGIN;${f.sql}
      ${free ? `UPDATE public.products SET sale_price=0 WHERE id='${f.product}';` : ''}
      ${f.identity()}SET LOCAL ROLE authenticated;
      SELECT ${f.checkout(f.business, { discount: free ? '0.00' : '20.00' })};
      SELECT ${f.checkout(f.business, { items: null, method: null, discount: null })};
      RESET ROLE;${f.stats};ROLLBACK;`);
    assert.equal(out.sale.total, 0);
    assert.deepEqual(out.payments, []);
    assert.deepEqual(replay, out);
    assert.equal(out.items.filter((item) => item.item_type === 'PRODUCT').length, 2);
    assert(
      out.items
        .filter((item) => item.item_type === 'PRODUCT')
        .every((item) => item.unit_cost_snapshot === 4),
    );
    assert.deepEqual(stats, { ...completed, payments: 0 });
  });
}

test('BF301 cent discount remains global while gross immutable lines and exact payment reconcile', () => {
  const f = completeCheckoutFixture();
  const items = ['SERVICE', 'PRODUCT', 'SERVICE', 'PRODUCT'].map((itemType) => ({
    itemType,
    itemId: itemType === 'SERVICE' ? f.service : f.product,
    quantity: 1,
  }));
  const [out, money] = rows(`BEGIN;${f.sql}
    UPDATE public.services SET price=0.01 WHERE id='${f.service}';
    UPDATE public.products SET sale_price=0.01 WHERE id='${f.product}';
    ${f.identity()}SET LOCAL ROLE authenticated;
    SELECT ${f.checkout(f.business, { discount: '0.02', items })};
    RESET ROLE;SELECT jsonb_build_object(
      'gross',(SELECT sum(i.line_total)::text FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.business_id='${f.business}'),
      'subtotal',(SELECT subtotal::text FROM public.sales WHERE business_id='${f.business}'),
      'discount',(SELECT discount::text FROM public.sales WHERE business_id='${f.business}'),
      'total',(SELECT total::text FROM public.sales WHERE business_id='${f.business}'),
      'paid',(SELECT sum(amount)::text FROM public.payments WHERE business_id='${f.business}'));ROLLBACK;`);
  assert.deepEqual(money, {
    gross: '0.04',
    subtotal: '0.04',
    discount: '0.02',
    total: '0.02',
    paid: '0.02',
  });
  assert.equal(out.items.length, 4);
  assert(out.items.every((item) => item.line_total === 0.01));
  assert.equal(out.payments.length, 1);
});
