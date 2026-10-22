const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { query } = require('./helpers/local-postgres.cjs');
const { checkoutFixture } = require('./helpers/checkout-appointment-fixture.cjs');
const { randomUUID } = require('node:crypto');
const f = checkoutFixture(),
  op = randomUUID();
const body = readFileSync(
  'supabase/migrations/20261021020000_checkout_appointment_completion.sql',
  'utf8',
)
  .replace(/^BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');
const result = query(`BEGIN;${f.sql}${f.identity()}SELECT ${f.sale(op)};
  CREATE TEMP TABLE before186 AS SELECT (SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}') a,
    (SELECT jsonb_agg(to_jsonb(s)) FROM public.sales s WHERE operation_id='${op}') sales,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public') policies;
  DROP FUNCTION private.complete_checkout_appointment(uuid,uuid);${body}
  DO $$ BEGIN
    IF (SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}') IS DISTINCT FROM (SELECT a FROM before186)
      OR (SELECT jsonb_agg(to_jsonb(s)) FROM public.sales s WHERE operation_id='${op}') IS DISTINCT FROM (SELECT sales FROM before186)
      OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public') IS DISTINCT FROM (SELECT policies FROM before186)
      OR has_function_privilege('authenticated','private.complete_checkout_appointment(uuid,uuid)','EXECUTE') THEN
      RAISE EXCEPTION 'Completion migration changed history or ACL';
    END IF;
  END $$;
  SELECT 'upgrade preserved existing partial header and pending appointment';ROLLBACK;`);
assert.equal(
  result.split('\n').at(-1),
  'upgrade preserved existing partial header and pending appointment',
);
console.log(
  'PASS BF186 migration probe: existing header/appointment/policies unchanged; private stage only.',
);
