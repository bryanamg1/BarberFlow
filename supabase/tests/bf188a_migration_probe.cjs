const assert = require('node:assert/strict');
const fs = require('node:fs');
const { query } = require('./helpers/local-postgres.cjs');
const { saleVoidFixture } = require('./helpers/sale-void-fixture.cjs');
const f = saleVoidFixture();
const migration = fs
  .readFileSync('supabase/migrations/20261030010000_atomic_sale_void.sql', 'utf8')
  .replace(/^BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');
const result = query(`BEGIN;${f.setup()}
  CREATE TEMP TABLE before188a AS SELECT ${f.history} AS history,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) policies,
    (SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,p.prosrc,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.proname NOT IN
        ('void_sale','get_sale_correction_detail','read_sale_void_history','prevent_sale_void_changes')) functions;
  DROP FUNCTION public.void_sale(uuid,uuid,uuid,text);
  DROP FUNCTION public.get_sale_correction_detail(uuid,uuid);
  DROP FUNCTION private.read_sale_void_history(uuid,uuid);
  DROP TABLE private.sale_voids;
  DROP FUNCTION private.prevent_sale_void_changes();
  ${migration}
  DO $$ BEGIN
    IF ${f.history} IS DISTINCT FROM (SELECT history FROM before188a)
      OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) IS DISTINCT FROM (SELECT policies FROM before188a)
      OR (SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,p.prosrc,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.proname NOT IN
          ('void_sale','get_sale_correction_detail','read_sale_void_history','prevent_sale_void_changes')) IS DISTINCT FROM (SELECT functions FROM before188a)
      THEN RAISE EXCEPTION 'BF188A modified existing history/policies/functions';END IF;
  END $$;
  ${f.identity()}SET LOCAL ROLE authenticated;
  SELECT ${f.reader()};SELECT ${f.voidSale()};RESET ROLE;ROLLBACK;`);
const rows = result
  .split('\n')
  .filter((x) => x.startsWith('{'))
  .map(JSON.parse);
assert.deepEqual(rows[0], { correction: null, stockMovements: [] });
assert.equal(rows[1].sale.status, 'VOIDED');
assert.equal(rows[1].stockMovements.length, 2);
console.log(
  'PASS BF188A populated upgrade: existing sale/items/payments/ledger/appointment/policies/function ACL and bodies preserved; reader and void work through authenticated.',
);
