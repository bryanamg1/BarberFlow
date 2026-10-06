\set ON_ERROR_STOP on
BEGIN;

-- Administrative local fixtures only, including FK identities; everything rolls back.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_business_id uuid;
  v_other_business_id uuid;
  v_client_id uuid;
  v_member_id uuid;
  v_appointment_id uuid;
  v_operation_id uuid := gen_random_uuid();
  v_default_sale public.sales%ROWTYPE;
  v_full_sale public.sales%ROWTYPE;
  v_updated_sale public.sales%ROWTYPE;
  v_status text;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
  v_rejections integer := 0;
BEGIN
  -- Exact schema excludes payment, stock, counters and catalog archive fields.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sales') <> 13 THEN
    RAISE EXCEPTION 'Unexpected sales columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('business_id', 'uuid', 'NO'),
      ('client_id', 'uuid', 'YES'),
      ('appointment_id', 'uuid', 'YES'),
      ('operation_id', 'uuid', 'NO'),
      ('status', 'text', 'NO'),
      ('subtotal', 'numeric', 'NO'),
      ('discount', 'numeric', 'NO'),
      ('total', 'numeric', 'NO'),
      ('sold_at', 'timestamptz', 'YES'),
      ('created_by', 'uuid', 'NO'),
      ('created_at', 'timestamptz', 'NO'),
      ('updated_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'sales'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = v_case.is_nullable
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sales'
        AND column_name IN ('subtotal', 'discount', 'total')
        AND numeric_precision = 12 AND numeric_scale = 2) <> 3 THEN
    RAISE EXCEPTION 'All sale monetary fields must use numeric(12,2)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'sales'
               AND column_name IN ('operation_id', 'subtotal', 'total', 'created_by', 'sold_at')
               AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'Operation, actor, amounts and sale time must be explicit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sales'::regclass
                 AND conname = 'sales_pkey' AND contype = 'p') THEN
    RAISE EXCEPTION 'Sales PK missing';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('sales_business_id_fkey', 'public.businesses'),
      ('sales_client_id_fkey', 'public.clients'),
      ('sales_appointment_id_fkey', 'public.appointments'),
      ('sales_created_by_fkey', 'auth.users')
    ) AS foreign_keys(constraint_name, target_table)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sales'::regclass
                   AND conname = v_case.constraint_name AND contype = 'f'
                   AND confrelid = v_case.target_table::regclass AND confdeltype = 'r') THEN
      RAISE EXCEPTION 'Restrictive FK missing: %', v_case.constraint_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.sales'::regclass AND contype = 'u') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sales'::regclass
                    AND conname = 'sales_business_id_operation_id_key' AND contype = 'u'
                    AND pg_get_constraintdef(oid) = 'UNIQUE (business_id, operation_id)') THEN
    RAISE EXCEPTION 'Only business-scoped operation uniqueness is approved';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sales') <> 5 THEN
    RAISE EXCEPTION 'Expected PK, operation uniqueness and three history/FK indexes';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('sales_business_id_sold_at_idx', '% USING btree (business_id, sold_at)'),
      ('sales_client_id_sold_at_idx', '% USING btree (client_id, sold_at)'),
      ('sales_appointment_id_idx', '% USING btree (appointment_id)')
    ) AS indexes(index_name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sales'
                   AND indexname = v_case.index_name AND indexdef LIKE v_case.definition) THEN
      RAISE EXCEPTION 'Sale history/FK index missing: %', v_case.index_name;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sales'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales') THEN
    RAISE EXCEPTION 'Sales must have RLS enabled without policies';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.sales'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.sales'::regclass
                    AND tgname = 'sales_set_updated_at'
                    AND tgfoid = 'public.set_updated_at()'::regprocedure AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Only the existing updated_at utility is allowed';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id);
  INSERT INTO public.businesses (name) VALUES ('Temporary sales test') RETURNING id INTO v_business_id;
  INSERT INTO public.businesses (name) VALUES ('Other temporary sales test') RETURNING id INTO v_other_business_id;
  INSERT INTO public.clients (business_id, first_name) VALUES (v_business_id, 'Temporary') RETURNING id INTO v_client_id;
  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (v_business_id, v_user_id, 'BARBER') RETURNING id INTO v_member_id;
  INSERT INTO public.appointments (business_id, client_id, barber_member_id, start_at, end_at, created_by)
  VALUES (v_business_id, v_client_id, v_member_id, '2030-01-07T09:00:00-03:00',
          '2030-01-07T09:30:00-03:00', v_user_id) RETURNING id INTO v_appointment_id;
  INSERT INTO public.sales (business_id, operation_id, subtotal, total, created_by)
  VALUES (v_business_id, v_operation_id, 0, 0, v_user_id) RETURNING * INTO v_default_sale;
  IF v_default_sale.id IS NULL OR v_default_sale.operation_id IS DISTINCT FROM v_operation_id
     OR v_default_sale.status IS DISTINCT FROM 'DRAFT'
     OR v_default_sale.client_id IS NOT NULL OR v_default_sale.appointment_id IS NOT NULL
     OR v_default_sale.sold_at IS NOT NULL OR v_default_sale.discount IS DISTINCT FROM 0
     OR v_default_sale.subtotal IS DISTINCT FROM 0 OR v_default_sale.total IS DISTINCT FROM 0
     OR v_default_sale.created_by IS DISTINCT FROM v_user_id
     OR v_default_sale.created_at IS DISTINCT FROM transaction_timestamp()
     OR v_default_sale.updated_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Direct sale defaults, optional relations or audit fields failed';
  END IF;
  INSERT INTO public.sales (business_id, client_id, appointment_id, operation_id, status,
                           subtotal, discount, total, sold_at, created_by, created_at, updated_at)
  VALUES (v_business_id, v_client_id, v_appointment_id, gen_random_uuid(), 'COMPLETED',
          100, 20, 80, '2030-01-07T09:30:00-03:00', v_user_id,
          '1999-01-01T00:00:00Z', '2000-01-01T00:00:00Z') RETURNING * INTO v_full_sale;
  IF v_full_sale.client_id IS DISTINCT FROM v_client_id
     OR v_full_sale.appointment_id IS DISTINCT FROM v_appointment_id
     OR v_full_sale.subtotal IS DISTINCT FROM 100 OR v_full_sale.discount IS DISTINCT FROM 20
     OR v_full_sale.total IS DISTINCT FROM 80
     OR v_full_sale.sold_at IS DISTINCT FROM '2030-01-07T12:30:00Z'::timestamptz THEN
    RAISE EXCEPTION 'Appointment sale, monetary example 100 - 20 = 80 or timezone failed';
  END IF;
  -- Same operation in another business is allowed; same appointment may be referenced again.
  INSERT INTO public.sales (business_id, operation_id, subtotal, total, created_by)
  VALUES (v_other_business_id, v_operation_id, 10, 10, v_user_id);
  INSERT INTO public.sales (business_id, client_id, appointment_id, operation_id,
                           status, subtotal, discount, total, created_by)
  VALUES (v_business_id, v_client_id, v_appointment_id, gen_random_uuid(), 'VOIDED', 100, 100, 0, v_user_id);

  FOR v_case IN
    SELECT * FROM (VALUES
      ('business_id = gen_random_uuid()', '23503', 'sales_business_id_fkey', NULL),
      ('business_id = NULL', '23502', NULL, 'business_id'),
      ('client_id = gen_random_uuid()', '23503', 'sales_client_id_fkey', NULL),
      ('appointment_id = gen_random_uuid()', '23503', 'sales_appointment_id_fkey', NULL),
      ('created_by = gen_random_uuid()', '23503', 'sales_created_by_fkey', NULL),
      ('created_by = NULL', '23502', NULL, 'created_by'),
      ('operation_id = NULL', '23502', NULL, 'operation_id'),
      ('status = NULL', '23502', NULL, 'status'),
      ('status = ''PENDING''', '23514', 'sales_status_check', NULL),
      ('status = ''PAID''', '23514', 'sales_status_check', NULL),
      ('status = ''CANCELLED''', '23514', 'sales_status_check', NULL),
      ('status = ''REFUNDED''', '23514', 'sales_status_check', NULL),
      ('subtotal = NULL', '23502', NULL, 'subtotal'),
      ('subtotal = -1', '23514', NULL, NULL),
      ('subtotal = ''NaN''::numeric', '23514', NULL, NULL),
      ('discount = NULL', '23502', NULL, 'discount'),
      ('discount = -1', '23514', NULL, NULL),
      ('discount = ''NaN''::numeric', '23514', NULL, NULL),
      ('discount = 101', '23514', NULL, NULL),
      ('total = NULL', '23502', NULL, 'total'),
      ('total = -1', '23514', NULL, NULL),
      ('total = ''NaN''::numeric', '23514', NULL, NULL),
      ('total = 90', '23514', 'sales_total_calculation_check', NULL),
      -- NaN arithmetic can satisfy equality; the explicit NaN checks must still reject it.
      ('subtotal = ''NaN''::numeric, discount = ''NaN''::numeric, total = ''NaN''::numeric', '23514', NULL, NULL),
      ('created_at = NULL', '23502', NULL, 'created_at')
    ) AS cases(assignments, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.sales SET %s WHERE id = %L', v_case.assignments, v_full_sale.id);
      RAISE EXCEPTION 'Expected rejection for %', v_case.assignments;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      IF v_state <> v_case.expected_state
         OR (v_case.expected_constraint IS NOT NULL AND v_constraint <> v_case.expected_constraint)
         OR (v_case.expected_column IS NOT NULL AND v_column <> v_case.expected_column) THEN RAISE; END IF;
      v_rejections := v_rejections + 1;
    END;
  END LOOP;
  FOR v_case IN
    SELECT * FROM (VALUES
      (format('INSERT INTO public.sales (business_id, operation_id, subtotal, total, created_by) VALUES (%L, %L, 0, 0, %L)', v_business_id, v_operation_id, v_user_id), '23505', 'sales_business_id_operation_id_key', NULL),
      (format('INSERT INTO public.sales (business_id, subtotal, total, created_by) VALUES (%L, 0, 0, %L)', v_business_id, v_user_id), '23502', NULL, 'operation_id'),
      (format('INSERT INTO public.sales (business_id, operation_id, total, created_by) VALUES (%L, gen_random_uuid(), 0, %L)', v_business_id, v_user_id), '23502', NULL, 'subtotal'),
      (format('INSERT INTO public.sales (business_id, operation_id, subtotal, created_by) VALUES (%L, gen_random_uuid(), 0, %L)', v_business_id, v_user_id), '23502', NULL, 'total'),
      (format('INSERT INTO public.sales (business_id, operation_id, subtotal, total) VALUES (%L, gen_random_uuid(), 0, 0)', v_business_id), '23502', NULL, 'created_by'),
      (format('INSERT INTO public.sales (business_id, operation_id, subtotal, total, created_by, updated_at) VALUES (%L, gen_random_uuid(), 0, 0, %L, NULL)', v_business_id, v_user_id), '23502', NULL, 'updated_at'),
      (format('DELETE FROM public.businesses WHERE id = %L', v_other_business_id), '23503', 'sales_business_id_fkey', NULL),
      (format('DELETE FROM public.appointments WHERE id = %L', v_appointment_id), '23503', 'sales_appointment_id_fkey', NULL)
    ) AS cases(statement, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      EXECUTE v_case.statement;
      RAISE EXCEPTION 'Expected rejection: %', v_case.statement;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      IF v_state <> v_case.expected_state
         OR (v_case.expected_constraint IS NOT NULL AND v_constraint <> v_case.expected_constraint)
         OR (v_case.expected_column IS NOT NULL AND v_column <> v_case.expected_column) THEN RAISE; END IF;
      v_rejections := v_rejections + 1;
    END;
  END LOOP;

  -- No status machine is added here; future Security/RPC restricts actor-authorized transitions.
  FOREACH v_status IN ARRAY ARRAY['DRAFT', 'COMPLETED', 'VOIDED'] LOOP
    UPDATE public.sales SET status = v_status WHERE id = v_full_sale.id RETURNING * INTO v_updated_sale;
    IF v_updated_sale.status IS DISTINCT FROM v_status
       OR v_updated_sale.updated_at IS DISTINCT FROM transaction_timestamp()
       OR v_updated_sale.updated_at <= v_full_sale.updated_at
       OR v_updated_sale.created_at IS DISTINCT FROM v_full_sale.created_at
       OR v_updated_sale.sold_at IS DISTINCT FROM v_full_sale.sold_at THEN
      RAISE EXCEPTION 'Sale status representation or timestamps failed';
    END IF;
  END LOOP;
  IF (SELECT status FROM public.appointments WHERE id = v_appointment_id) IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Sales must not change appointment status';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.sales;
    IF v_count <> 0 THEN RAISE EXCEPTION '% can read sales', v_role; END IF;
    UPDATE public.sales SET status = 'DRAFT';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can update sales', v_role; END IF;
    DELETE FROM public.sales;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can delete sales', v_role; END IF;
    BEGIN
      INSERT INTO public.sales (business_id, operation_id, subtotal, total, created_by)
      VALUES (v_business_id, gen_random_uuid(), 0, 0, v_user_id);
      RAISE EXCEPTION '% can insert sales', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.sales WHERE business_id IN (v_business_id, v_other_business_id);
  SELECT * INTO v_updated_sale FROM public.sales WHERE id = v_full_sale.id;
  IF v_count <> 4 OR v_updated_sale.status IS DISTINCT FROM 'VOIDED'
     OR v_updated_sale.total IS DISTINCT FROM 80 THEN
    RAISE EXCEPTION 'Denied client writes changed the sale fixtures';
  END IF;
  RAISE NOTICE 'BF-062 passed: schema, defaults, % constraint rejections, scoped idempotency, money, statuses, timestamps and RLS', v_rejections;
END;
$$;

ROLLBACK;
