const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { query } = require('./helpers/local-postgres.cjs');
const { appointmentFixture } = require('./helpers/appointment-fixture.cjs');
const f = appointmentFixture();
const migration = readFileSync(
  'supabase/migrations/20261021010000_appointment_operational_mutations.sql',
  'utf8',
)
  .replace(/^BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');
const result = query(`BEGIN;${f.sql}
  CREATE TEMP TABLE before147a AS SELECT (SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}') appointment,
    (SELECT jsonb_agg(to_jsonb(s)) FROM public.appointment_services s WHERE appointment_id='${f.appointment}') snapshots,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public') policies;
  DROP FUNCTION public.reschedule_appointment(uuid,uuid,uuid,timestamptz,integer),public.update_appointment_notes(uuid,uuid,text),
    public.change_appointment_status(uuid,uuid,text),private.lock_operational_appointment(uuid,uuid,uuid);
  ${migration}
  DO $$ BEGIN
    IF (SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}') IS DISTINCT FROM (SELECT appointment FROM before147a)
      OR (SELECT jsonb_agg(to_jsonb(s)) FROM public.appointment_services s WHERE appointment_id='${f.appointment}') IS DISTINCT FROM (SELECT snapshots FROM before147a)
      OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public') IS DISTINCT FROM (SELECT policies FROM before147a)
      OR NOT has_function_privilege('authenticated','public.change_appointment_status(uuid,uuid,text)','EXECUTE')
      OR has_any_column_privilege('authenticated','public.appointments','UPDATE') THEN
      RAISE EXCEPTION 'Operational migration changed history/policies/write fence';
    END IF;
  END $$;SELECT 'upgrade preserved history and exact ACL';ROLLBACK;`);
assert.equal(result, 'upgrade preserved history and exact ACL');
console.log(
  'PASS BF147A migration probe: real prior-state upgrade; history, snapshots, policies and DML fence preserved.',
);
