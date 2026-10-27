const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { query } = require('./helpers/local-postgres.cjs');
const { completeCheckoutFixture } = require('./helpers/complete-checkout-fixture.cjs');

const f = completeCheckoutFixture();
const migration = fs
  .readFileSync('supabase/migrations/20261027020000_revenue_by_day.sql', 'utf8')
  .replace(/^([\s\S]*?)BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');
const result = query(`BEGIN;${f.sql}${f.identity()}
  SET LOCAL ROLE authenticated;
  SELECT ${f.checkout(randomUUID())};
  RESET ROLE;
  CREATE TEMP TABLE before241 AS SELECT
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s WHERE business_id='${f.business}') sales,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.business_id='${f.business}') items,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}') ledger,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) policies,
    (SELECT jsonb_agg(jsonb_build_array(p.oid,p.prosrc,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private') AND p.proname<>'get_revenue_by_day') functions;
  DROP FUNCTION public.get_revenue_by_day(uuid,timestamptz,timestamptz);
  ${migration}
  SET LOCAL ROLE authenticated;
  SELECT jsonb_build_object('rows',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.date),'[]'::jsonb)
      FROM public.get_revenue_by_day('${f.business}',NULL,NULL) AS r),
    'expected_date',(SELECT (s.sold_at AT TIME ZONE b.timezone)::date FROM public.sales s
      JOIN public.businesses b ON b.id=s.business_id WHERE s.business_id='${f.business}'));
  RESET ROLE;
  DO $$ BEGIN
    IF (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s WHERE business_id='${f.business}') IS DISTINCT FROM (SELECT sales FROM before241)
      OR (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.business_id='${f.business}') IS DISTINCT FROM (SELECT items FROM before241)
      OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}') IS DISTINCT FROM (SELECT ledger FROM before241)
      OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) IS DISTINCT FROM (SELECT policies FROM before241)
      OR (SELECT jsonb_agg(jsonb_build_array(p.oid,p.prosrc,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('public','private') AND p.proname<>'get_revenue_by_day') IS DISTINCT FROM (SELECT functions FROM before241)
      THEN RAISE EXCEPTION 'BF241 changed history/policies/existing functions or ACL'; END IF;
  END $$;
  SELECT 'BF241 populated upgrade preserved history/policies/existing functions';
  ROLLBACK;`);
const rows = result
  .split('\n')
  .filter((line) => line.startsWith('{'))
  .map(JSON.parse);
const checkout = rows[0],
  wire = rows[1];
assert.equal(checkout.sale.total, 20);
assert.equal(wire.rows.length, 1);
assert.deepEqual(wire.rows[0], {
  date: wire.expected_date,
  service_revenue: '0.00',
  product_revenue: '20.00',
  total_revenue: '20.00',
});
assert.match(wire.rows[0].date, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(
  result.split('\n').at(-1),
  'BF241 populated upgrade preserved history/policies/existing functions',
);
console.log(
  'PASS BF241 migration probe: populated real checkout, authenticated four-field daily rows, preserved history/ledger/policies/existing function bodies and ACL.',
);
