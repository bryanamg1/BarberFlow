const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { query } = require('./helpers/local-postgres.cjs');
const { completeCheckoutFixture } = require('./helpers/complete-checkout-fixture.cjs');

const f = completeCheckoutFixture();
const migration = fs
  .readFileSync('supabase/migrations/20261027010000_dashboard_summary.sql', 'utf8')
  .replace(/^([\s\S]*?)BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');
const result = query(`BEGIN;${f.sql}${f.identity()}
  SET LOCAL ROLE authenticated;
  SELECT ${f.checkout(randomUUID())};
  RESET ROLE;
  CREATE TEMP TABLE before240 AS SELECT
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s WHERE business_id='${f.business}') sales,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.business_id='${f.business}') items,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}') ledger,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) policies,
    (SELECT jsonb_agg(jsonb_build_array(p.oid,p.prosrc,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private') AND p.proname<>'get_dashboard_summary') functions;
  DROP FUNCTION public.get_dashboard_summary(uuid,timestamptz,timestamptz);
  ${migration}
  SET LOCAL ROLE authenticated;
  SELECT public.get_dashboard_summary('${f.business}',NULL,NULL);
  RESET ROLE;
  DO $$ BEGIN
    IF (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s WHERE business_id='${f.business}') IS DISTINCT FROM (SELECT sales FROM before240)
      OR (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.business_id='${f.business}') IS DISTINCT FROM (SELECT items FROM before240)
      OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}') IS DISTINCT FROM (SELECT ledger FROM before240)
      OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) IS DISTINCT FROM (SELECT policies FROM before240)
      OR (SELECT jsonb_agg(jsonb_build_array(p.oid,p.prosrc,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('public','private') AND p.proname<>'get_dashboard_summary') IS DISTINCT FROM (SELECT functions FROM before240)
      THEN RAISE EXCEPTION 'BF240 changed history/policies/existing functions or ACL'; END IF;
  END $$;
  SELECT 'BF240 populated upgrade preserved history/policies/existing functions';
  ROLLBACK;`);
const rows = result
  .split('\n')
  .filter((line) => line.startsWith('{'))
  .map(JSON.parse);
const checkout = rows[0],
  summary = rows[1];
assert.equal(checkout.sale.total, 20);
assert.equal(summary.total_revenue, '20.00');
assert.equal(summary.service_revenue, '0.00');
assert.equal(summary.product_revenue, '20.00');
assert.equal(summary.profit, '12.00');
assert.equal(summary.products_sold, '2');
assert.equal(summary.average_ticket, '20.00');
assert.deepEqual(Object.keys(summary).sort(), [
  'active_clients',
  'appointments',
  'average_ticket',
  'cancellations',
  'expenses',
  'merchandise_purchases',
  'no_shows',
  'product_revenue',
  'products_sold',
  'profit',
  'service_revenue',
  'total_revenue',
]);
assert.equal(
  result.split('\n').at(-1),
  'BF240 populated upgrade preserved history/policies/existing functions',
);
console.log(
  'PASS BF240 migration probe: real checkout history, authenticated exact JSON contract, unchanged snapshots/ledger/policies/existing functions and ACL.',
);
