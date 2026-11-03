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
const fixed = (n) => `00000304-0000-4000-8000-${String(n).padStart(12, '0')}`;
const day = ['2026-09-20T03:00:00Z', '2026-09-21T03:00:00Z'];

function fixture() {
  const f = completeCheckoutFixture();
  const category = randomUUID();
  const sale = (n, at, discount, lines, state = 'COMPLETED') => {
    const data = f.literal(JSON.stringify(lines));
    return `INSERT INTO public.sales(id,business_id,operation_id,client_id,status,subtotal,discount,total,sold_at,created_by)
      SELECT '${fixed(n)}','${f.business}','${fixed(n + 50)}','${f.client}','${state}',
        sum((x->>'price')::numeric*COALESCE((x->>'quantity')::integer,1)),${discount},
        sum((x->>'price')::numeric*COALESCE((x->>'quantity')::integer,1))-${discount},'${at}','${f.owner}'
      FROM jsonb_array_elements(${data}::jsonb) AS v(x);
      INSERT INTO public.sale_items(id,sale_id,item_type,service_id,product_id,item_name_snapshot,unit_price_snapshot,quantity,line_total,unit_cost_snapshot)
      SELECT ('00000304-0000-4000-8000-'||lpad((${n}*100+ordinal)::text,12,'0'))::uuid,'${fixed(n)}',x->>'kind',
        CASE WHEN x->>'kind'='SERVICE' THEN '${f.service}'::uuid END,
        CASE WHEN x->>'kind'='PRODUCT' THEN '${f.product}'::uuid END,
        CASE WHEN x->>'kind'='SERVICE' THEN 'BF304 historical service' ELSE 'BF304 historical product' END,
        (x->>'price')::numeric,COALESCE((x->>'quantity')::integer,1),
        (x->>'price')::numeric*COALESCE((x->>'quantity')::integer,1),
        CASE WHEN x->>'kind'='PRODUCT' THEN (x->>'cost')::numeric END
      FROM jsonb_array_elements(${data}::jsonb) WITH ORDINALITY AS v(x,ordinal);`;
  };
  const service = (price) => ({ kind: 'SERVICE', price });
  const product = (price, cost, quantity = 1) => ({ kind: 'PRODUCT', price, cost, quantity });
  // Trusted LOCAL historical fixtures exercise existing readers; BF301 tests actual checkout writers.
  const setup = `${f.sql}
    UPDATE public.businesses SET timezone='America/Argentina/Buenos_Aires' WHERE id='${f.business}';
    INSERT INTO public.expense_categories(id,business_id,name) VALUES('${category}','${f.business}','BF304 Goods');
    ${f.identity()}SET LOCAL ROLE authenticated;
    CREATE TEMP TABLE bf304_purchase AS SELECT public.complete_purchase('${f.business}','${fixed(900)}','BF304 Supplier',
      '${category}','CASH','2026-09-20T12:00:00Z',NULL,
      '[{"productId":"${f.product}","quantity":1,"unitCost":"20.00"}]'::jsonb) AS outcome;
    RESET ROLE;
    INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
      VALUES('${f.business}','${category}','MANUAL','BF304 Manual',7.50,'CASH','2026-09-20','${f.owner}');
    ${sale(1, day[0], '4.00', [service('10.00'), product('10.00', '4.00', 3)])}
    ${sale(2, '2026-09-20T12:00Z', '0.02', [service('0.01'), product('0.01', '0.00'), service('0.01'), product('0.01', '0.00')])}
    ${sale(3, '2026-09-20T13:00Z', '0.00', [product('0.00', '2.00')])}
    ${sale(4, '2026-09-20T14:00Z', '10.00', [service('10.00')])}
    ${sale(5, '2026-09-20T02:59:59.999999Z', '0.00', [service('100.00')])}
    ${sale(6, day[1], '0.00', [service('20.00')])}
    ${sale(7, '2026-09-20T15:00Z', '0.00', [service('999.00')], 'DRAFT')}
    ${sale(8, '2026-09-20T16:00Z', '0.00', [product('999.00', '999.00')], 'VOIDED')}`;
  const readers = (from = day[0], to = day[1]) => {
    const range = `${from === null ? 'NULL' : f.literal(from)},${to === null ? 'NULL' : f.literal(to)}`;
    return `SELECT jsonb_build_object(
      'summary',public.get_dashboard_summary('${f.business}',${range}),
      'daily',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.date),'[]'::jsonb) FROM public.get_revenue_by_day('${f.business}',${range}) r),
      'expenses',public.get_expense_summary('${f.business}',${range}),
      'services',(SELECT COALESCE(jsonb_agg(jsonb_build_object('quantity',r.quantity::text,'net_revenue',r.net_revenue,'name',r.name)),'[]'::jsonb) FROM public.get_top_services('${f.business}',${range},100) r),
      'products',(SELECT COALESCE(jsonb_agg(jsonb_build_object('quantity',r.quantity::text,'net_revenue',r.net_revenue,'cogs',r.cogs,'gross_profit',r.gross_profit,'name',r.name)),'[]'::jsonb) FROM public.get_top_products('${f.business}',${range},100) r),
      'client',(SELECT jsonb_build_object('total_spent',c.total_spent::text) FROM public.get_client_stats('${f.business}','${f.client}') c));`;
  };
  const run = (body) =>
    rows(`BEGIN;${setup}${f.identity()}SET LOCAL ROLE authenticated;${body}ROLLBACK;`);
  return { ...f, category, setup, readers, run };
}

test('BF304 six readers reconcile exact day totals, residual cents, historical COGS and separate purchase expense', () => {
  const f = fixture();
  const [out] = f.run(f.readers());
  assert.equal(out.summary.total_revenue, '36.02');
  assert.equal(out.summary.service_revenue, '9.00');
  assert.equal(out.summary.product_revenue, '27.02');
  assert.equal(out.summary.expenses, '7.50');
  assert.equal(out.summary.merchandise_purchases, '20.00');
  assert.equal(out.summary.profit, '14.52');
  assert.equal(out.summary.average_ticket, '9.01');
  assert.equal(out.summary.products_sold, '6');
  assert.deepEqual(out.daily, [
    {
      date: '2026-09-20',
      service_revenue: '9.00',
      product_revenue: '27.02',
      total_revenue: '36.02',
    },
  ]);
  assert.equal(out.expenses.manual_total, '7.50');
  assert.equal(out.expenses.purchase_total, '20.00');
  assert.equal(out.expenses.total, '27.50');
  assert.deepEqual(out.services, [
    { quantity: '4', net_revenue: '9.00', name: 'BF304 historical service' },
  ]);
  assert.deepEqual(out.products, [
    {
      quantity: '6',
      net_revenue: '27.02',
      cogs: '14.00',
      gross_profit: '13.02',
      name: 'BF304 historical product',
    },
  ]);
  // Client stats are lifetime, not the requested Finance range.
  assert.equal(out.client.total_spent, '156.02');
});

for (const [label, from, to, total] of [
  ['TODAY', ...day, '36.02'],
  ['WEEK', '2026-09-14T03:00Z', '2026-09-21T03:00Z', '136.02'],
  ['MONTH', '2026-09-01T03:00Z', '2026-10-01T03:00Z', '156.02'],
  ['YEAR', '2026-01-01T03:00Z', '2027-01-01T03:00Z', '156.02'],
]) {
  test(`BF304 explicit ${label} business-civil interval reconciles daily sum without including exclusive end`, () => {
    const f = fixture();
    const [out] = f.run(`SELECT jsonb_build_object(
      'summary',public.get_dashboard_summary('${f.business}','${from}','${to}')->>'total_revenue',
      'daily',(SELECT sum(r.total_revenue::numeric)::text FROM public.get_revenue_by_day('${f.business}','${from}','${to}') r),
      'items',(SELECT sum(n)::text FROM (
        SELECT net_revenue::numeric n FROM public.get_top_services('${f.business}','${from}','${to}',100)
        UNION ALL SELECT net_revenue::numeric FROM public.get_top_products('${f.business}','${from}','${to}',100)) amounts));`);
    assert.deepEqual(out, { summary: total, daily: total, items: total });
  });
}

test('BF304 ALL_TIME reconciles lifetime client spend; session timezone and current catalog cannot rewrite history', () => {
  const f = fixture();
  const [bounded, allTime, changed] = f.run(`${f.readers()}${f.readers(null, null)}
    RESET ROLE;
    UPDATE public.products SET name='Current renamed',sale_price=999,default_purchase_cost=888,is_active=false WHERE id='${f.product}';
    UPDATE public.services SET name='Current renamed',price=999,is_active=false WHERE id='${f.service}';
    SET LOCAL TimeZone='Asia/Tokyo';SET LOCAL ROLE authenticated;${f.readers()}`);
  assert.deepEqual(changed, bounded);
  assert.equal(allTime.summary.total_revenue, '156.02');
  assert.equal(allTime.summary.total_revenue, allTime.client.total_spent);
  assert.equal(allTime.summary.average_ticket, '26.00');
  assert.deepEqual(
    allTime.daily.map((r) => [r.date, r.total_revenue]),
    [
      ['2026-09-19', '100.00'],
      ['2026-09-20', '36.02'],
      ['2026-09-21', '20.00'],
    ],
  );
});

test('BF304 actual purchase void rectifies effective expense only, preserving history, reference cost and profit', () => {
  const f = fixture();
  const [before, original, correction, after, history] = f.run(`${f.readers()}
    SELECT jsonb_build_object('expense',(SELECT to_jsonb(e) FROM public.expenses e WHERE e.purchase_id=(SELECT (outcome->'purchase'->>'id')::uuid FROM bf304_purchase)));
    SELECT public.void_purchase('${f.business}','${randomUUID()}',(SELECT (outcome->'purchase'->>'id')::uuid FROM bf304_purchase),'BF304 correction');
    ${f.readers()}
    SELECT jsonb_build_object('expense',(SELECT to_jsonb(e) FROM public.expenses e WHERE e.purchase_id=(SELECT (outcome->'purchase'->>'id')::uuid FROM bf304_purchase)),
      'reference_cost',(SELECT default_purchase_cost::text FROM public.products WHERE id='${f.product}'));`);
  assert.equal(correction.purchase.status, 'VOIDED');
  assert.equal(before.expenses.purchase_total, '20.00');
  assert.equal(after.expenses.purchase_total, '0.00');
  assert.equal(after.expenses.total, '7.50');
  assert.equal(after.summary.merchandise_purchases, '0.00');
  assert.equal(after.summary.profit, before.summary.profit);
  assert.equal(after.summary.expenses, before.summary.expenses);
  assert.deepEqual(after.products, before.products);
  assert.deepEqual(history.expense, original.expense);
  assert.equal(history.reference_cost, '20.00');
});

test('BF304 signed profit and no-sales NULL average retain exact decimal semantics', () => {
  const f = fixture();
  const category = randomUUID();
  const [negative, empty] =
    f.run(`UPDATE public.expenses SET amount=100 WHERE business_id='${f.business}' AND source_type='MANUAL';
    ${f.readers()}
    RESET ROLE;INSERT INTO public.business_members(business_id,user_id,role) VALUES('${f.foreignBusiness}','${f.owner}','OWNER');
    INSERT INTO public.expense_categories(id,business_id,name) VALUES('${category}','${f.foreignBusiness}','BF304 Empty');
    INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
      VALUES('${f.foreignBusiness}','${category}','MANUAL','No sales',4.20,'CASH','2026-09-20','${f.owner}');
    SET LOCAL ROLE authenticated;SELECT public.get_dashboard_summary('${f.foreignBusiness}',NULL,NULL);`);
  assert.equal(negative.summary.profit, '-77.98');
  assert.equal(negative.summary.average_ticket, '9.01');
  assert.equal(empty.profit, '-4.20');
  assert.equal(empty.average_ticket, null);
  assert.equal(empty.total_revenue, '0.00');
});

test('BF304 actual sale correction removes effective revenue/COGS/client spend but preserves payment history', () => {
  const f = completeCheckoutFixture();
  const [checkout, before, correction, after] =
    rows(`BEGIN;${f.sql}${f.identity()}SET LOCAL ROLE authenticated;
    CREATE TEMP TABLE bf304_sale AS SELECT ${f.checkout(randomUUID())} AS outcome;
    SELECT outcome FROM bf304_sale;
    SELECT public.get_dashboard_summary('${f.business}',NULL,NULL);
    SELECT public.void_sale('${f.business}','${randomUUID()}',(SELECT (outcome->'sale'->>'id')::uuid FROM bf304_sale),'BF304 sale correction');
    SELECT jsonb_build_object('summary',public.get_dashboard_summary('${f.business}',NULL,NULL),
      'daily',(SELECT sum(total_revenue::numeric)::text FROM public.get_revenue_by_day('${f.business}',NULL,NULL)),
      'products',(SELECT count(*) FROM public.get_top_products('${f.business}',NULL,NULL,100)),
      'client',(SELECT total_spent::text FROM public.get_client_stats('${f.business}','${f.client}')));ROLLBACK;`);
  assert.equal(before.total_revenue, '20.00');
  assert.equal(before.profit, '12.00');
  assert.equal(correction.sale.status, 'VOIDED');
  assert.deepEqual(correction.payments, checkout.payments);
  assert.equal(after.summary.total_revenue, '0.00');
  assert.equal(after.summary.profit, '0.00');
  assert.equal(after.summary.average_ticket, null);
  assert.equal(after.daily, null); // ALL_TIME with no effective sales has no daily rows.
  assert.equal(after.products, 0);
  assert.equal(after.client, '0.00');
});
