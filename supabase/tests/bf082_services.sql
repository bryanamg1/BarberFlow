\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

-- Consume the reset seed, never create replacement services to satisfy checks.
DO $$
DECLARE
  actual jsonb;
  expected jsonb;
  seeded_at constant timestamptz := '2026-01-01T00:00:00Z';
  target_table text;
  row_count bigint;
  checked_tables integer := 0;
BEGIN
  SELECT jsonb_agg(to_jsonb(s) ORDER BY id) INTO actual FROM public.services s;
  SELECT jsonb_agg(jsonb_build_object(
    'id', v.id, 'business_id', '00000000-0000-4000-8000-000000000080',
    'name', v.name, 'description', NULL, 'price', v.price,
    'duration_minutes', v.duration_minutes, 'is_active', true,
    'created_at', seeded_at, 'updated_at', seeded_at
  ) ORDER BY v.id) INTO expected
  FROM (VALUES
    ('00000000-0000-4000-8000-000000000821', 'Corte clásico', 10000.00::numeric, 30),
    ('00000000-0000-4000-8000-000000000822', 'Barba', 5000.00::numeric, 15),
    ('00000000-0000-4000-8000-000000000823', 'Corte + barba', 14000.00::numeric, 45)
  ) AS v(id, name, price, duration_minutes);
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'BF082 requires exactly the three approved service rows and all their fields';
  END IF;
  IF (SELECT count(*) FROM public.businesses) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.businesses
                    WHERE id = '00000000-0000-4000-8000-000000000080'
                      AND name = 'BarberFlow Demo (local)' AND currency_code = 'ARS')
     OR (SELECT count(*) FROM auth.users) <> 1
     OR (SELECT count(*) FROM auth.identities) <> 1
     OR (SELECT count(*) FROM public.profiles) <> 1
     OR (SELECT count(*) FROM public.business_members) <> 1 THEN
    RAISE EXCEPTION 'BF082 must preserve the existing single demo business and OWNER';
  END IF;
  FOR target_table IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT IN ('businesses', 'profiles', 'business_members', 'services', 'product_categories', 'products') ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO row_count;
    IF row_count <> 0 THEN RAISE EXCEPTION 'BF082 created out-of-scope rows in %', target_table; END IF;
    checked_tables := checked_tables + 1;
  END LOOP;
  IF checked_tables <> 13 THEN RAISE EXCEPTION 'Unexpected public table inventory'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 46
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
           AND NOT c.relforcerowsecurity) <> 19 THEN
    RAISE EXCEPTION 'BF082 changed RLS/policy baseline';
  END IF;
  -- Existing services.sql checks all table constraints. BF080/BF081 retain their
  -- full business/Auth/profile/membership oracles; BF083/BF084 own categories/products.
  RAISE NOTICE 'BF082 passed: exact three approved services, fixed IDs/tenant/prices/durations/NULL descriptions/timestamps, no extra entities, RLS baseline preserved';
END;
$$;
ROLLBACK;
