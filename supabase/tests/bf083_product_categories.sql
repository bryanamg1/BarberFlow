\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

-- Assert the actual reset seed; do not insert replacement category fixtures.
DO $$
DECLARE
  actual jsonb;
  expected jsonb;
  seeded_at constant timestamptz := '2026-01-01T00:00:00Z';
  target_table text;
  row_count bigint;
  checked_tables integer := 0;
BEGIN
  SELECT jsonb_agg(to_jsonb(c) ORDER BY id) INTO actual FROM public.product_categories c;
  SELECT jsonb_agg(jsonb_build_object(
    'id', v.id, 'business_id', '00000000-0000-4000-8000-000000000080',
    'name', v.name, 'is_active', true,
    'created_at', seeded_at, 'updated_at', seeded_at
  ) ORDER BY v.id) INTO expected
  FROM (VALUES
    ('00000000-0000-4000-8000-000000000831', 'Cabello'),
    ('00000000-0000-4000-8000-000000000832', 'Barba'),
    ('00000000-0000-4000-8000-000000000833', 'Accesorios')
  ) AS v(id, name);
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'BF083 requires exactly the three approved product categories and all six fields';
  END IF;
  IF (SELECT count(*) FROM public.businesses) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.businesses
                    WHERE id = '00000000-0000-4000-8000-000000000080'
                      AND name = 'BarberFlow Demo (local)')
     OR (SELECT count(*) FROM auth.users) <> 1
     OR (SELECT count(*) FROM auth.identities) <> 1
     OR (SELECT count(*) FROM public.profiles) <> 1
     OR (SELECT count(*) FROM public.business_members) <> 1
     OR (SELECT count(*) FROM public.services) <> 3 THEN
    RAISE EXCEPTION 'BF083 must preserve the single demo business, OWNER and three services';
  END IF;
  FOR target_table IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT IN ('businesses', 'profiles', 'business_members', 'services', 'product_categories')
    ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO row_count;
    IF row_count <> 0 THEN RAISE EXCEPTION 'BF083 created out-of-scope rows in %', target_table; END IF;
    checked_tables := checked_tables + 1;
  END LOOP;
  IF checked_tables <> 14 THEN RAISE EXCEPTION 'Unexpected public table inventory'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 46
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
           AND NOT c.relforcerowsecurity) <> 19 THEN
    RAISE EXCEPTION 'BF083 changed RLS/policy baseline';
  END IF;
  -- BF080/BF081/BF082 retain exact old-data oracles; product_categories.sql
  -- validates the existing constraints. Products and expense categories stay empty.
  RAISE NOTICE 'BF083 passed: exact product categories/IDs/tenant/active/timestamps, 14 unrelated empty tables, 46 policies and 19 RLS tables/FORCE off';
END;
$$;
ROLLBACK;
