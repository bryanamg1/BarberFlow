\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

-- Inspect the reset seed itself; no replacement clients or generated history.
DO $$
DECLARE
  actual jsonb;
  expected jsonb;
  seeded_at constant timestamptz := '2026-01-01T00:00:00Z';
  target_table text;
  row_count bigint;
  checked_tables integer := 0;
BEGIN
  SELECT jsonb_agg(to_jsonb(c) ORDER BY id) INTO actual FROM public.clients c;
  SELECT jsonb_agg(jsonb_build_object(
    'id', v.id, 'business_id', '00000000-0000-4000-8000-000000000080',
    'first_name', v.first_name, 'last_name', v.last_name,
    'phone', NULL, 'email', NULL, 'instagram', NULL, 'birth_date', NULL,
    'notes', NULL, 'preferences', NULL, 'is_active', v.is_active,
    'created_at', seeded_at, 'updated_at', seeded_at
  ) ORDER BY v.id) INTO expected
  FROM (VALUES
    ('00000000-0000-4000-8000-000000000851', 'Martín', 'Pérez', true),
    ('00000000-0000-4000-8000-000000000852', 'Lucía', 'Gómez', true),
    ('00000000-0000-4000-8000-000000000853', 'Diego', NULL, true),
    ('00000000-0000-4000-8000-000000000854', 'Valentina', 'Ríos', false)
  ) AS v(id, first_name, last_name, is_active);
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'BF085 requires exactly four approved clients and all thirteen fields';
  END IF;
  IF (SELECT count(*) FROM public.businesses) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.businesses
                    WHERE id = '00000000-0000-4000-8000-000000000080'
                      AND name = 'BarberFlow Demo (local)')
     OR (SELECT count(*) FROM auth.users) <> 1
     OR (SELECT count(*) FROM auth.identities) <> 1
     OR (SELECT count(*) FROM public.profiles) <> 1
     OR (SELECT count(*) FROM public.business_members) <> 1
     OR (SELECT count(*) FROM public.services) <> 3
     OR (SELECT count(*) FROM public.product_categories) <> 3
     OR (SELECT count(*) FROM public.products) <> 6 THEN
    RAISE EXCEPTION 'BF085 must preserve the demo business, OWNER and all previous catalogs';
  END IF;
  FOR target_table IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT IN ('businesses', 'profiles', 'business_members', 'services', 'product_categories', 'products', 'clients')
    ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO row_count;
    IF row_count <> 0 THEN RAISE EXCEPTION 'BF085 created out-of-scope rows in %', target_table; END IF;
    checked_tables := checked_tables + 1;
  END LOOP;
  IF checked_tables <> 12 THEN RAISE EXCEPTION 'Unexpected public table inventory'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 46
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
           AND NOT c.relforcerowsecurity) <> 19 THEN
    RAISE EXCEPTION 'BF085 changed RLS/policy baseline';
  END IF;
  -- BF080–BF084 retain exact old-data oracles; clients.sql covers constraints.
  RAISE NOTICE 'BF085 passed: exact four clients, active/named, NULL surname, inactive, optional NULL fields, deterministic tenant/IDs/dates, no transactions, RLS preserved';
END;
$$;
ROLLBACK;
