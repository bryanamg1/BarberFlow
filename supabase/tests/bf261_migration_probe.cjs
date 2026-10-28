const assert = require('node:assert/strict');
const fs = require('node:fs');
const { query } = require('./helpers/local-postgres.cjs');
const { appointmentFixture } = require('./helpers/appointment-fixture.cjs');

const f = appointmentFixture();
const migration = fs
  .readFileSync('supabase/migrations/20261028010000_next_appointment.sql', 'utf8')
  .replace(/^([\s\S]*?)BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');
const output = query(`BEGIN; ${f.sql}
  UPDATE public.appointments SET start_at=now()+interval '1 day',end_at=now()+interval '1 day 30 minutes' WHERE id='${f.appointment}';
  CREATE TEMP TABLE before261 AS SELECT
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.appointments a WHERE business_id='${f.business}') appointments,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.appointment_services a WHERE appointment_id='${f.appointment}') lines,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) policies,
    (SELECT jsonb_agg(jsonb_build_array(p.oid,p.prosrc,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.proname<>'get_next_appointment') functions;
  DROP FUNCTION IF EXISTS public.get_next_appointment(uuid);
  ${migration}
  ${f.identity()} SET LOCAL ROLE authenticated;
  SELECT public.get_next_appointment('${f.business}');
  RESET ROLE;
  DO $$ BEGIN
    IF (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.appointments a WHERE business_id='${f.business}') IS DISTINCT FROM (SELECT appointments FROM before261)
      OR (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.appointment_services a WHERE appointment_id='${f.appointment}') IS DISTINCT FROM (SELECT lines FROM before261)
      OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) IS DISTINCT FROM (SELECT policies FROM before261)
      OR (SELECT jsonb_agg(jsonb_build_array(p.oid,p.prosrc,p.proacl,p.prosecdef,p.proconfig) ORDER BY p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.proname<>'get_next_appointment') IS DISTINCT FROM (SELECT functions FROM before261)
      THEN RAISE EXCEPTION 'BF261 changed history/policies/existing functions or ACL'; END IF;
  END $$;
  ROLLBACK;`);
const result = output
  .split('\n')
  .filter((line) => line.startsWith('{'))
  .map(JSON.parse)
  .at(-1);
assert.equal(result.id, f.appointment);
assert.equal(Object.keys(result).length, 11);
console.log(
  'PASS BF261 populated upgrade: exact reader result; unchanged appointments, snapshots, policies and existing function bodies/ACL.',
);
