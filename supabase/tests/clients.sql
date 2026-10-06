\set ON_ERROR_STOP on
BEGIN;

-- Local administrative fixtures only; the transaction leaves no permanent data.
DO $$
DECLARE
  v_business_id uuid;
  v_other_business_id uuid;
  v_default_client public.clients%ROWTYPE;
  v_full_client public.clients%ROWTYPE;
  v_updated_client public.clients%ROWTYPE;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients') <> 13 THEN
    RAISE EXCEPTION 'Unexpected clients columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('business_id', 'uuid', 'NO'),
      ('first_name', 'text', 'NO'),
      ('last_name', 'text', 'YES'),
      ('phone', 'text', 'YES'),
      ('email', 'text', 'YES'),
      ('instagram', 'text', 'YES'),
      ('birth_date', 'date', 'YES'),
      ('notes', 'text', 'YES'),
      ('preferences', 'text', 'YES'),
      ('is_active', 'bool', 'NO'),
      ('created_at', 'timestamptz', 'NO'),
      ('updated_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'clients'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = v_case.is_nullable
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.clients'::regclass
                 AND conname = 'clients_pkey' AND contype = 'p')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.clients'::regclass
                    AND conname = 'clients_business_id_fkey' AND contype = 'f'
                    AND confrelid = 'public.businesses'::regclass AND confdeltype = 'r') THEN
    RAISE EXCEPTION 'Clients PK or restrictive business FK missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.clients'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'Clients must not have contact uniqueness constraints';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'clients') <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'clients'
                    AND indexname = 'clients_business_id_is_active_idx'
                    AND indexdef LIKE '% USING btree (business_id, is_active)')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'clients'
                    AND indexname = 'clients_business_id_phone_idx'
                    AND indexdef LIKE '% USING btree (business_id, phone)') THEN
    RAISE EXCEPTION 'Expected PK and two business-scoped indexes';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.clients'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clients') THEN
    RAISE EXCEPTION 'Clients must have RLS enabled without policies';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.clients'::regclass
                 AND tgname = 'clients_set_updated_at'
                 AND tgfoid = 'public.set_updated_at()'::regprocedure AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Clients must reuse the existing updated_at utility';
  END IF;

  INSERT INTO public.businesses (name) VALUES ('Temporary clients test') RETURNING id INTO v_business_id;
  INSERT INTO public.businesses (name) VALUES ('Other temporary clients test') RETURNING id INTO v_other_business_id;
  INSERT INTO public.clients (business_id, first_name)
  VALUES (v_business_id, 'First') RETURNING * INTO v_default_client;
  IF v_default_client.id IS NULL OR v_default_client.is_active IS DISTINCT FROM true
     OR v_default_client.created_at IS DISTINCT FROM transaction_timestamp()
     OR v_default_client.updated_at IS DISTINCT FROM transaction_timestamp()
     OR v_default_client.last_name IS NOT NULL OR v_default_client.phone IS NOT NULL
     OR v_default_client.email IS NOT NULL OR v_default_client.instagram IS NOT NULL
     OR v_default_client.birth_date IS NOT NULL OR v_default_client.notes IS NOT NULL
     OR v_default_client.preferences IS NOT NULL THEN
    RAISE EXCEPTION 'Clients defaults or optional fields failed';
  END IF;
  INSERT INTO public.clients (
    business_id, first_name, last_name, phone, email, instagram, birth_date, notes,
    preferences, created_at, updated_at
  ) VALUES (
    v_business_id, 'Full', 'Client', 'Shared phone', 'shared@example.invalid', 'shared_handle',
    DATE '1990-02-03', 'Initial notes', 'Texto libre: tijera, sin perfume.',
    '1999-01-01T00:00:00Z', '2000-01-01T00:00:00Z'
  ) RETURNING * INTO v_full_client;
  IF v_full_client.birth_date IS DISTINCT FROM DATE '1990-02-03'
     OR v_full_client.preferences IS DISTINCT FROM 'Texto libre: tijera, sin perfume.' THEN
    RAISE EXCEPTION 'Civil birth date or free-text preferences failed';
  END IF;
  -- Shared contacts are valid within one business and across businesses.
  INSERT INTO public.clients (business_id, first_name, phone, email, instagram)
  VALUES (v_business_id, 'Same business', 'Shared phone', 'shared@example.invalid', 'shared_handle'),
         (v_other_business_id, 'Other business', 'Shared phone', 'shared@example.invalid', 'shared_handle');

  FOR v_case IN
    SELECT * FROM (VALUES
      ('INSERT INTO public.clients (business_id, first_name) VALUES (gen_random_uuid(), ''Missing business'')', '23503', 'clients_business_id_fkey', NULL),
      ('INSERT INTO public.clients (business_id, first_name) VALUES (NULL, ''Missing business'')', '23502', NULL, 'business_id'),
      (format('INSERT INTO public.clients (business_id, first_name) VALUES (%L, NULL)', v_business_id), '23502', NULL, 'first_name'),
      (format('INSERT INTO public.clients (business_id, first_name) VALUES (%L, '''')', v_business_id), '23514', 'clients_first_name_check', NULL),
      (format('INSERT INTO public.clients (business_id, first_name) VALUES (%L, ''   '')', v_business_id), '23514', 'clients_first_name_check', NULL),
      (format('UPDATE public.clients SET first_name = '''' WHERE id = %L', v_full_client.id), '23514', 'clients_first_name_check', NULL),
      (format('DELETE FROM public.businesses WHERE id = %L', v_business_id), '23503', 'clients_business_id_fkey', NULL)
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

  UPDATE public.clients SET notes = 'Updated notes', is_active = false
  WHERE id = v_full_client.id RETURNING * INTO v_updated_client;
  IF v_updated_client.updated_at IS DISTINCT FROM transaction_timestamp()
     OR v_updated_client.updated_at <= v_full_client.updated_at
     OR v_updated_client.created_at IS DISTINCT FROM v_full_client.created_at
     OR v_updated_client.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Updated timestamp, preserved creation time or soft archive failed';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.clients;
    IF v_count <> 0 THEN
      RAISE EXCEPTION '% can read clients', v_role;
    END IF;
    UPDATE public.clients SET notes = 'Forbidden';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION '% can update clients', v_role;
    END IF;
    DELETE FROM public.clients;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN
      RAISE EXCEPTION '% can delete clients', v_role;
    END IF;
    BEGIN
      INSERT INTO public.clients (business_id, first_name) VALUES (v_business_id, 'Denied');
      RAISE EXCEPTION '% can insert clients', v_role;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.clients WHERE business_id IN (v_business_id, v_other_business_id);
  SELECT * INTO v_updated_client FROM public.clients WHERE id = v_full_client.id;
  IF v_count <> 4 OR v_updated_client.notes IS DISTINCT FROM 'Updated notes'
     OR v_updated_client.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Denied client writes changed the fixtures';
  END IF;
  RAISE NOTICE 'BF-056 passed: schema, defaults, 7 constraint rejections, contacts, timestamps, archive and RLS';
END;
$$;

ROLLBACK;
