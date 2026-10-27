const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { query } = require('./helpers/local-postgres.cjs');
const { completeCheckoutFixture } = require('./helpers/complete-checkout-fixture.cjs');

const f = completeCheckoutFixture();
const migration = fs
  .readFileSync('supabase/migrations/20261027030000_top_services.sql', 'utf8')
  .replace(/^([\s\S]*?)BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');
const result = query(`BEGIN;${f.sql}
  UPDATE public.services SET price=7.50 WHERE id='${f.service}';
  ${f.identity()} SET LOCAL ROLE authenticated;
  SELECT ${f.checkout(randomUUID())};
  RESET ROLE;
  CREATE TEMP TABLE before243 AS SELECT
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s WHERE business_id='${f.business}') sales,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.business_id='${f.business}') items,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}') ledger,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) policies,
    (SELECT jsonb_agg(jsonb_build_array(p.oid,p.prosrc,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private') AND p.proname<>'get_top_services') functions;
  DROP FUNCTION public.get_top_services(uuid,timestamptz,timestamptz,integer);
  ${migration}
  SET LOCAL ROLE authenticated;
  SELECT jsonb_build_object('rows',(SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb)
      FROM public.get_top_services('${f.business}',NULL,NULL) AS r),
    'expected_name',(SELECT item_name_snapshot FROM public.sale_items WHERE service_id='${f.service}'));
  RESET ROLE;
  DO $$ BEGIN
    IF (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s WHERE business_id='${f.business}') IS DISTINCT FROM (SELECT sales FROM before243)
      OR (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.business_id='${f.business}') IS DISTINCT FROM (SELECT items FROM before243)
      OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}') IS DISTINCT FROM (SELECT ledger FROM before243)
      OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) IS DISTINCT FROM (SELECT policies FROM before243)
      OR (SELECT jsonb_agg(jsonb_build_array(p.oid,p.prosrc,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('public','private') AND p.proname<>'get_top_services') IS DISTINCT FROM (SELECT functions FROM before243)
      THEN RAISE EXCEPTION 'BF243 changed history/policies/existing functions or ACL'; END IF;
  END $$;
  SELECT 'BF243 populated upgrade preserved history/policies/existing functions';
  ROLLBACK;`);
const rows = result
  .split('\n')
  .filter((line) => line.startsWith('{'))
  .map(JSON.parse);
assert.equal(rows[0].sale.total, 27.5);
assert.deepEqual(rows[1].rows, [
  {
    service_id: f.service,
    name: rows[1].expected_name,
    quantity: 1,
    net_revenue: '7.50',
  },
]);
assert.equal(
  result.split('\n').at(-1),
  'BF243 populated upgrade preserved history/policies/existing functions',
);
console.log(
  'PASS BF243 populated migration probe: actual authenticated checkout, exact service row, unchanged history/ledger/policies/existing function bodies and ACL.',
);
