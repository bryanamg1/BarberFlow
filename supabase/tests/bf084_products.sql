\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

-- Consume the actual clean reset seed, without inserting replacement products.
DO $$
DECLARE
  actual jsonb;
  expected jsonb;
  seeded_at constant timestamptz := '2026-01-01T00:00:00Z';
  target_table text;
  row_count bigint;
  checked_tables integer := 0;
BEGIN
  SELECT jsonb_agg(to_jsonb(p) ORDER BY id) INTO actual FROM public.products p;
  SELECT jsonb_agg(jsonb_build_object(
    'id', v.id, 'business_id', '00000000-0000-4000-8000-000000000080',
    'category_id', v.category_id, 'name', v.name, 'description', NULL,
    'sku', v.sku, 'sale_price', v.sale_price,
    'default_purchase_cost', v.purchase_cost, 'minimum_stock', v.minimum_stock,
    'is_active', true, 'created_at', seeded_at, 'updated_at', seeded_at
  ) ORDER BY v.id) INTO expected
  FROM (VALUES
    ('00000000-0000-4000-8000-000000000841', '00000000-0000-4000-8000-000000000831',
     'Cera mate', 'BF-CAB-001', 12000.00::numeric, 6500.00::numeric, 3),
    ('00000000-0000-4000-8000-000000000842', '00000000-0000-4000-8000-000000000831',
     'Shampoo', 'BF-CAB-002', 10000.00::numeric, 5500.00::numeric, 3),
    ('00000000-0000-4000-8000-000000000843', '00000000-0000-4000-8000-000000000832',
     'Aceite para barba', 'BF-BAR-001', 11000.00::numeric, 6000.00::numeric, 2),
    ('00000000-0000-4000-8000-000000000844', '00000000-0000-4000-8000-000000000832',
     'Bálsamo para barba', 'BF-BAR-002', 13000.00::numeric, 7000.00::numeric, 2),
    ('00000000-0000-4000-8000-000000000845', '00000000-0000-4000-8000-000000000833',
     'Peine profesional', 'BF-ACC-001', 6000.00::numeric, 3000.00::numeric, 4),
    ('00000000-0000-4000-8000-000000000846', '00000000-0000-4000-8000-000000000833',
     'Cepillo para barba', 'BF-ACC-002', 9000.00::numeric, 4500.00::numeric, 3)
  ) AS v(id, category_id, name, sku, sale_price, purchase_cost, minimum_stock);
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'BF084 requires exactly six approved products and all twelve fields';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products p
             LEFT JOIN public.product_categories c ON c.id = p.category_id
             WHERE c.id IS NULL OR c.business_id IS DISTINCT FROM p.business_id)
     OR EXISTS (SELECT 1 FROM public.products GROUP BY business_id, sku HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'BF084 requires same-tenant categories and distinct fixture SKUs per business';
  END IF;
  IF (SELECT count(*) FROM public.businesses) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.businesses
                    WHERE id = '00000000-0000-4000-8000-000000000080'
                      AND name = 'BarberFlow Demo (local)' AND currency_code = 'ARS')
     OR (SELECT count(*) FROM auth.users) <> 1
     OR (SELECT count(*) FROM auth.identities) <> 1
     OR (SELECT count(*) FROM public.profiles) <> 1
     OR (SELECT count(*) FROM public.business_members) <> 1
     OR (SELECT count(*) FROM public.services) <> 3
     OR (SELECT count(*) FROM public.product_categories) <> 3 THEN
    RAISE EXCEPTION 'BF084 must preserve the demo business, OWNER, services and categories';
  END IF;
  FOR target_table IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT IN ('businesses', 'profiles', 'business_members', 'services', 'product_categories', 'products', 'clients')
    ORDER BY tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO row_count;
    IF row_count <> 0 THEN RAISE EXCEPTION 'BF084 created out-of-scope rows in %', target_table; END IF;
    checked_tables := checked_tables + 1;
  END LOOP;
  IF checked_tables <> 12 THEN RAISE EXCEPTION 'Unexpected public table inventory'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 46
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
           AND NOT c.relforcerowsecurity) <> 19 THEN
    RAISE EXCEPTION 'BF084 changed RLS/policy baseline';
  END IF;
  -- BF080–BF083 retain old-data oracles; BF085 owns clients; products.sql covers constraints.
  -- SKU uniqueness is a fixture assertion, not a new database UNIQUE constraint.
  RAISE NOTICE 'BF084 passed: exact six products, same-tenant categories, distinct fixture SKUs, deterministic fields, no stock/transactions, RLS baseline preserved';
END;
$$;
ROLLBACK;
