\set ON_ERROR_STOP on
BEGIN;

-- Local administrative fixtures only; every change is rolled back.
DO $$
DECLARE
  v_business_id uuid;
  v_other_business_id uuid;
  v_default_category public.product_categories%ROWTYPE;
  v_full_category public.product_categories%ROWTYPE;
  v_updated_category public.product_categories%ROWTYPE;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'product_categories') <> 6 THEN
    RAISE EXCEPTION 'Unexpected product_categories columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid'),
      ('business_id', 'uuid'),
      ('name', 'text'),
      ('is_active', 'bool'),
      ('created_at', 'timestamptz'),
      ('updated_at', 'timestamptz')
    ) AS columns(column_name, udt_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'product_categories'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.product_categories'::regclass
                 AND conname = 'product_categories_pkey' AND contype = 'p')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.product_categories'::regclass
                    AND conname = 'product_categories_business_id_fkey' AND contype = 'f'
                    AND confrelid = 'public.businesses'::regclass AND confdeltype = 'r') THEN
    RAISE EXCEPTION 'Product categories PK or restrictive business FK missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.product_categories'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'Category names must not have uniqueness constraints';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'product_categories') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'product_categories'
                    AND indexname = 'product_categories_business_id_is_active_idx'
                    AND indexdef LIKE '% USING btree (business_id, is_active)') THEN
    RAISE EXCEPTION 'Expected PK and one business/active index';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.product_categories'::regclass)
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'product_categories') IS DISTINCT FROM
        ARRAY['product_categories_insert_owners', 'product_categories_select_members', 'product_categories_update_owners']::text[] THEN
    RAISE EXCEPTION 'Product categories must have RLS enabled with exactly the approved BF-076 policies';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.product_categories'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.product_categories'::regclass
                    AND tgname = 'product_categories_set_updated_at'
                    AND tgfoid = 'public.set_updated_at()'::regprocedure AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Product categories must reuse only the existing updated_at utility';
  END IF;

  INSERT INTO public.businesses (name) VALUES ('Temporary categories test') RETURNING id INTO v_business_id;
  INSERT INTO public.businesses (name) VALUES ('Other temporary categories test') RETURNING id INTO v_other_business_id;
  INSERT INTO public.product_categories (business_id, name)
  VALUES (v_business_id, 'Shared category') RETURNING * INTO v_default_category;
  IF v_default_category.id IS NULL OR v_default_category.is_active IS DISTINCT FROM true
     OR v_default_category.created_at IS DISTINCT FROM transaction_timestamp()
     OR v_default_category.updated_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Category UUID, active flag or timestamp defaults failed';
  END IF;
  -- Duplicate names are valid inside one business and across businesses.
  INSERT INTO public.product_categories (business_id, name, created_at, updated_at)
  VALUES (v_business_id, 'Shared category', '1999-01-01T00:00:00Z', '2000-01-01T00:00:00Z')
  RETURNING * INTO v_full_category;
  INSERT INTO public.product_categories (business_id, name) VALUES (v_other_business_id, 'Shared category');

  FOR v_case IN
    SELECT * FROM (VALUES
      ('INSERT INTO public.product_categories (business_id, name) VALUES (gen_random_uuid(), ''Invalid'')', '23503', 'product_categories_business_id_fkey', NULL),
      ('INSERT INTO public.product_categories (business_id, name) VALUES (NULL, ''Invalid'')', '23502', NULL, 'business_id'),
      (format('INSERT INTO public.product_categories (business_id, name) VALUES (%L, NULL)', v_business_id), '23502', NULL, 'name'),
      (format('INSERT INTO public.product_categories (business_id, name) VALUES (%L, '''')', v_business_id), '23514', 'product_categories_name_check', NULL),
      (format('INSERT INTO public.product_categories (business_id, name) VALUES (%L, ''   '')', v_business_id), '23514', 'product_categories_name_check', NULL),
      (format('UPDATE public.product_categories SET name = '''' WHERE id = %L', v_full_category.id), '23514', 'product_categories_name_check', NULL),
      (format('DELETE FROM public.businesses WHERE id = %L', v_business_id), '23503', 'product_categories_business_id_fkey', NULL),
      (format('INSERT INTO public.product_categories (business_id, name, is_active) VALUES (%L, ''Invalid'', NULL)', v_business_id), '23502', NULL, 'is_active'),
      (format('INSERT INTO public.product_categories (business_id, name, created_at) VALUES (%L, ''Invalid'', NULL)', v_business_id), '23502', NULL, 'created_at'),
      (format('INSERT INTO public.product_categories (business_id, name, updated_at) VALUES (%L, ''Invalid'', NULL)', v_business_id), '23502', NULL, 'updated_at')
    ) AS cases(statement, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      EXECUTE v_case.statement;
      RAISE EXCEPTION 'Expected rejection: %', v_case.statement;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      IF v_state <> v_case.expected_state
         OR (v_case.expected_constraint IS NOT NULL AND v_constraint <> v_case.expected_constraint)
         OR (v_case.expected_column IS NOT NULL AND v_column <> v_case.expected_column) THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  UPDATE public.product_categories SET name = 'Archived category', is_active = false
  WHERE id = v_full_category.id RETURNING * INTO v_updated_category;
  IF v_updated_category.updated_at IS DISTINCT FROM transaction_timestamp()
     OR v_updated_category.updated_at <= v_full_category.updated_at
     OR v_updated_category.created_at IS DISTINCT FROM v_full_category.created_at
     OR v_updated_category.name IS DISTINCT FROM 'Archived category'
     OR v_updated_category.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Category rename, timestamps or soft archive failed';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.product_categories;
    IF v_count <> 0 THEN
      RAISE EXCEPTION '% can read product categories', v_role;
    END IF;
    UPDATE public.product_categories SET name = 'Forbidden', is_active = true;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION '% can update product categories', v_role;
    END IF;
    DELETE FROM public.product_categories;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION '% can delete product categories', v_role;
    END IF;
    BEGIN
      INSERT INTO public.product_categories (business_id, name) VALUES (v_business_id, 'Denied');
      RAISE EXCEPTION '% can insert product categories', v_role;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.product_categories WHERE business_id IN (v_business_id, v_other_business_id);
  SELECT * INTO v_updated_category FROM public.product_categories WHERE id = v_full_category.id;
  IF v_count <> 3 OR v_updated_category.name IS DISTINCT FROM 'Archived category'
     OR v_updated_category.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Denied client writes changed the category fixtures';
  END IF;
  RAISE NOTICE 'BF-060 passed: schema, defaults, 10 constraint rejections, duplicates, timestamps, archive and RLS';
END;
$$;

ROLLBACK;
