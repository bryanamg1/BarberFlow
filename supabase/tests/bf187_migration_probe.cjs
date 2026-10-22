const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { query } = require('./helpers/local-postgres.cjs');
const { replayFixture } = require('./helpers/checkout-replay-fixture.cjs');
const { randomUUID } = require('node:crypto');
const f = replayFixture(),
  op = randomUUID();
const body = readFileSync('supabase/migrations/20261022010000_checkout_replay.sql', 'utf8')
  .replace(/^BEGIN;\s*/, '')
  .replace(/\s*COMMIT;\s*$/, '');
const result = query(`BEGIN;${f.sql}${f.identity()}${f.pipeline(op)}
  CREATE TEMP TABLE before187 AS SELECT ${f.gate(op)} outcome,
    (SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}') appointment,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}') ledger,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) policies;
  DROP FUNCTION private.get_checkout_replay(uuid,uuid);${body}
  DO $$ BEGIN
    IF ${f.gate(op)} IS DISTINCT FROM (SELECT outcome FROM before187)
      OR (SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}') IS DISTINCT FROM (SELECT appointment FROM before187)
      OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}') IS DISTINCT FROM (SELECT ledger FROM before187)
      OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','storage')) IS DISTINCT FROM (SELECT policies FROM before187)
      OR has_function_privilege('authenticated','private.get_checkout_replay(uuid,uuid)','EXECUTE')
      OR (SELECT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid='private.get_checkout_replay(uuid,uuid)'::regprocedure)
      THEN RAISE EXCEPTION 'Replay upgrade changed history or security'; END IF;
  END $$;SELECT 'upgrade preserved completed outcome, ledger, appointment, policies and private invoker boundary';ROLLBACK;`);
assert.equal(
  result.split('\n').at(-1),
  'upgrade preserved completed outcome, ledger, appointment, policies and private invoker boundary',
);
console.log(
  'PASS BF187 migration probe: populated predecessor state preserved; exact new private signature and ACL.',
);
