const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { query } = require('./helpers/local-postgres.cjs');
const { completeCheckoutFixture } = require('./helpers/complete-checkout-fixture.cjs');
const f = completeCheckoutFixture(),
  op = randomUUID();
const body = fs
  .readFileSync('supabase/migrations/20261022181656_complete_checkout.sql', 'utf8')
  .replace(/^BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');
const result = query(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}
  CREATE TEMP TABLE before188 AS SELECT ${f.gate(op)} outcome,
    (SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}') appointment,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}') ledger,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) policies;
  GRANT SELECT ON before188 TO authenticated;
  DROP FUNCTION public.complete_checkout(uuid,uuid,uuid,uuid,numeric,text,jsonb);${body}
  SET LOCAL ROLE authenticated;
  DO $$ BEGIN IF ${f.checkout(op, { items: null, method: null, discount: null })} IS DISTINCT FROM (SELECT outcome FROM before188)
    THEN RAISE EXCEPTION 'Upgrade replay changed persisted outcome';END IF;END $$;
  RESET ROLE;
  DO $$ BEGIN IF (SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}') IS DISTINCT FROM (SELECT appointment FROM before188)
    OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}') IS DISTINCT FROM (SELECT ledger FROM before188)
    OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) IS DISTINCT FROM (SELECT policies FROM before188)
    THEN RAISE EXCEPTION 'Migration modified prior history/policies';END IF;END $$;
  SELECT 'populated upgrade preserved outcome/history/policies';ROLLBACK;`);
assert.equal(result.split('\n').at(-1), 'populated upgrade preserved outcome/history/policies');
console.log(
  'PASS BF188 migration probe: populated predecessor, exact public function, replay through authenticated and unchanged history/policies.',
);
