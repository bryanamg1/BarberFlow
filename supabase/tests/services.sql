\set ON_ERROR_STOP on
BEGIN;

-- Local administrative fixtures only; every change is rolled back.
DO $$
DECLARE
  v_business_id uuid;
  v_other_business_id uuid;
  v_default_service public.services%ROWTYPE;
  v_full_service public.services%ROWTYPE;
  v_updated_service public.services%ROWTYPE;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'services') <> 9 THEN
    RAISE EXCEPTION 'Unexpected services columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('business_id', 'uuid', 'NO'),
      ('name', 'text', 'NO'),
      ('description', 'text', 'YES'),
      ('price', 'numeric', 'NO'),
      ('duration_minutes', 'int4', 'NO'),
      ('is_active', 'bool', 'NO'),
      ('created_at', 'timestamptz', 'NO'),
      ('updated_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'services'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = v_case.is_nullable
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'price'
                   AND numeric_precision = 12 AND numeric_scale = 2) THEN
    RAISE EXCEPTION 'Service price must use numeric(12,2)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.services'::regclass
                 AND conname = 'services_pkey' AND contype = 'p')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.services'::regclass
                    AND conname = 'services_business_id_fkey' AND contype = 'f'
                    AND confrelid = 'public.businesses'::regclass AND confdeltype = 'r') THEN
    RAISE EXCEPTION 'Services PK or restrictive business FK missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.services'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'Service names must not have uniqueness constraints';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'services') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'services'
                    AND indexname = 'services_business_id_is_active_idx'
                    AND indexdef LIKE '% USING btree (business_id, is_active)') THEN
    RAISE EXCEPTION 'Expected PK and one business/active index';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.services'::regclass)
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'services') IS DISTINCT FROM
        ARRAY['services_insert_owners', 'services_select_members', 'services_update_owners']::text[] THEN
    RAISE EXCEPTION 'Services must have RLS and exactly the three BF-074 policies';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.services'::regclass
                 AND tgname = 'services_set_updated_at'
                 AND tgfoid = 'public.set_updated_at()'::regprocedure AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Services must reuse the existing updated_at utility';
  END IF;

  INSERT INTO public.businesses (name) VALUES ('Temporary services test') RETURNING id INTO v_business_id;
  INSERT INTO public.businesses (name) VALUES ('Other temporary services test') RETURNING id INTO v_other_business_id;
  INSERT INTO public.services (business_id, name, price, duration_minutes)
  VALUES (v_business_id, 'Shared service name', 0, 1) RETURNING * INTO v_default_service;
  IF v_default_service.id IS NULL OR v_default_service.description IS NOT NULL
     OR v_default_service.price IS DISTINCT FROM 0 OR v_default_service.duration_minutes <> 1
     OR v_default_service.is_active IS DISTINCT FROM true
     OR v_default_service.created_at IS DISTINCT FROM transaction_timestamp()
     OR v_default_service.updated_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Service zero price, optional description or defaults failed';
  END IF;
  -- Duplicate names are allowed both inside a business and across businesses.
  INSERT INTO public.services (business_id, name, description, price, duration_minutes, created_at, updated_at)
  VALUES (v_business_id, 'Shared service name', 'Full description', 15000.75, 45,
          '1999-01-01T00:00:00Z', '2000-01-01T00:00:00Z') RETURNING * INTO v_full_service;
  INSERT INTO public.services (business_id, name, price, duration_minutes)
  VALUES (v_other_business_id, 'Shared service name', 100, 30);
  IF v_full_service.price IS DISTINCT FROM 15000.75 OR v_full_service.duration_minutes <> 45
     OR v_full_service.description IS DISTINCT FROM 'Full description' THEN
    RAISE EXCEPTION 'Positive decimal price, duration or description failed';
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (gen_random_uuid(), ''Invalid'', 0, 1)', '23503', 'services_business_id_fkey', NULL),
      ('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (NULL, ''Invalid'', 0, 1)', '23502', NULL, 'business_id'),
      (format('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (%L, NULL, 0, 1)', v_business_id), '23502', NULL, 'name'),
      (format('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (%L, '''', 0, 1)', v_business_id), '23514', 'services_name_check', NULL),
      (format('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (%L, ''   '', 0, 1)', v_business_id), '23514', 'services_name_check', NULL),
      (format('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (%L, ''Invalid'', NULL, 1)', v_business_id), '23502', NULL, 'price'),
      (format('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (%L, ''Invalid'', -0.01, 1)', v_business_id), '23514', 'services_price_check', NULL),
      (format('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (%L, ''Invalid'', ''NaN'', 1)', v_business_id), '23514', 'services_price_check', NULL),
      (format('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (%L, ''Invalid'', 0, NULL)', v_business_id), '23502', NULL, 'duration_minutes'),
      (format('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (%L, ''Invalid'', 0, 0)', v_business_id), '23514', 'services_duration_minutes_check', NULL),
      (format('INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (%L, ''Invalid'', 0, -1)', v_business_id), '23514', 'services_duration_minutes_check', NULL),
      (format('UPDATE public.services SET name = '''' WHERE id = %L', v_full_service.id), '23514', 'services_name_check', NULL),
      (format('UPDATE public.services SET price = -1 WHERE id = %L', v_full_service.id), '23514', 'services_price_check', NULL),
      (format('UPDATE public.services SET duration_minutes = 0 WHERE id = %L', v_full_service.id), '23514', 'services_duration_minutes_check', NULL),
      (format('DELETE FROM public.businesses WHERE id = %L', v_business_id), '23503', 'services_business_id_fkey', NULL)
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

  UPDATE public.services SET price = 23000.25, description = 'Updated description', is_active = false
  WHERE id = v_full_service.id RETURNING * INTO v_updated_service;
  IF v_updated_service.updated_at IS DISTINCT FROM transaction_timestamp()
     OR v_updated_service.updated_at <= v_full_service.updated_at
     OR v_updated_service.created_at IS DISTINCT FROM v_full_service.created_at
     OR v_updated_service.price IS DISTINCT FROM 23000.25
     OR v_updated_service.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Catalog update, timestamps or soft archive failed';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.services;
    IF v_count <> 0 THEN
      RAISE EXCEPTION '% can read services', v_role;
    END IF;
    UPDATE public.services SET price = 0, description = 'Forbidden';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION '% can update services', v_role;
    END IF;
    DELETE FROM public.services;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION '% can delete services', v_role;
    END IF;
    BEGIN
      INSERT INTO public.services (business_id, name, price, duration_minutes)
      VALUES (v_business_id, 'Denied', 0, 1);
      RAISE EXCEPTION '% can insert services', v_role;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.services WHERE business_id IN (v_business_id, v_other_business_id);
  SELECT * INTO v_updated_service FROM public.services WHERE id = v_full_service.id;
  IF v_count <> 3 OR v_updated_service.price IS DISTINCT FROM 23000.25
     OR v_updated_service.description IS DISTINCT FROM 'Updated description'
     OR v_updated_service.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Denied client writes changed the service fixtures';
  END IF;
  RAISE NOTICE 'BF-057 passed: schema, defaults, 15 constraint rejections, duplicates, timestamps, archive and RLS';
END;
$$;

ROLLBACK;
