\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

-- Run on the clean local reset baseline, before or after rolled-back DB suites.
DO $$
DECLARE
  demo public.businesses%ROWTYPE;
  table_name text;
  row_count bigint;
  checked_tables integer := 0;
BEGIN
  IF (SELECT count(*) FROM public.businesses) <> 1 THEN
    RAISE EXCEPTION 'BF080 expects exactly one demo business after local reset';
  END IF;
  SELECT * INTO STRICT demo FROM public.businesses
    WHERE id = '00000000-0000-4000-8000-000000000080';
  IF to_jsonb(demo) IS DISTINCT FROM jsonb_build_object(
    'id', '00000000-0000-4000-8000-000000000080',
    'name', 'BarberFlow Demo (local)',
    'phone', NULL, 'email', NULL, 'address', NULL, 'logo_path', NULL,
    'currency_code', 'ARS', 'timezone', 'America/Argentina/Buenos_Aires',
    'is_active', true,
    'created_at', TIMESTAMPTZ '2026-01-01T00:00:00Z',
    'updated_at', TIMESTAMPTZ '2026-01-01T00:00:00Z'
  ) THEN
    RAISE EXCEPTION 'BF080 demo business contents differ from the local seed contract';
  END IF;
  FOR table_name IN SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('businesses', 'profiles', 'business_members', 'services') ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO row_count;
    IF row_count <> 0 THEN
      RAISE EXCEPTION 'BF080 seeded an out-of-scope table: %', table_name;
    END IF;
    checked_tables := checked_tables + 1;
  END LOOP;
  -- BF-081 owns Auth/profile/OWNER assertions; BF-082 owns service assertions.
  -- Preserve the complete BF-080 business oracle and unrelated empty tables.
  IF checked_tables <> 15 THEN
    RAISE EXCEPTION 'Unexpected public table inventory';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 46
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
           AND NOT c.relforcerowsecurity) <> 19 THEN
    RAISE EXCEPTION 'BF080 changed the approved RLS/policy baseline';
  END IF;
  RAISE NOTICE 'BF080 passed: exact deterministic demo business, 15 unrelated empty tables, 46 policies and 19 RLS tables/FORCE off; OWNER/services validated by BF081/BF082';
END;
$$;

ROLLBACK;
