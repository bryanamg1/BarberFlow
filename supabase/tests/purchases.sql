\set ON_ERROR_STOP on
BEGIN;

-- Administrative local fixtures only, including FK identities; everything rolls back.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_business_id uuid;
  v_other_business_id uuid;
  v_operation_id uuid := gen_random_uuid();
  v_default_purchase public.purchases%ROWTYPE;
  v_full_purchase public.purchases%ROWTYPE;
  v_updated_purchase public.purchases%ROWTYPE;
  v_actual_purchase public.purchases%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_actual_product public.products%ROWTYPE;
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
  -- Exact columns exclude lines, stock, expenses, cost snapshots and archive fields.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'purchases') <> 11 THEN
    RAISE EXCEPTION 'Unexpected purchases columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('business_id', 'uuid', 'NO'),
      ('operation_id', 'uuid', 'NO'),
      ('supplier', 'text', 'NO'),
      ('status', 'text', 'NO'),
      ('total', 'numeric', 'NO'),
      ('purchased_at', 'timestamptz', 'YES'),
      ('notes', 'text', 'YES'),
      ('created_by', 'uuid', 'NO'),
      ('created_at', 'timestamptz', 'NO'),
      ('updated_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'purchases'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = v_case.is_nullable AND c.is_generated = 'NEVER'
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'purchases' AND column_name = 'total'
                  AND numeric_precision = 12 AND numeric_scale = 2) THEN
    RAISE EXCEPTION 'Purchase total must use numeric(12,2)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'purchases'
              AND column_name IN ('business_id', 'operation_id', 'supplier', 'total', 'purchased_at', 'notes', 'created_by')
              AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'Purchase operation, actor, supplier, total and completion time must be explicit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.purchases'::regclass
                 AND conname = 'purchases_pkey' AND contype = 'p') THEN
    RAISE EXCEPTION 'Purchases PK missing';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('purchases_business_id_fkey', 'public.businesses'),
      ('purchases_created_by_fkey', 'auth.users')
    ) AS foreign_keys(constraint_name, target_table)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.purchases'::regclass
                   AND conname = v_case.constraint_name AND contype = 'f'
                   AND confrelid = v_case.target_table::regclass AND confdeltype = 'r') THEN
      RAISE EXCEPTION 'Restrictive FK missing: %', v_case.constraint_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.purchases'::regclass AND contype = 'u') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.purchases'::regclass
                    AND conname = 'purchases_business_id_operation_id_key' AND contype = 'u'
                    AND pg_get_constraintdef(oid) = 'UNIQUE (business_id, operation_id)') THEN
    RAISE EXCEPTION 'Only business-scoped operation uniqueness is approved';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'purchases') <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'purchases'
                    AND indexname = 'purchases_business_id_purchased_at_idx'
                    AND indexdef LIKE '% USING btree (business_id, purchased_at)') THEN
    RAISE EXCEPTION 'Expected PK, operation uniqueness and one business history index';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.purchases'::regclass)
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'purchases')
        IS DISTINCT FROM ARRAY['purchases_select_owners']::text[] THEN
    RAISE EXCEPTION 'Purchases must have RLS enabled with exactly its BF-078 SELECT policy';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.purchases'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.purchases'::regclass
                    AND tgname = 'purchases_set_updated_at'
                    AND tgfoid = 'public.set_updated_at()'::regprocedure AND NOT tgisinternal
                    AND pg_get_triggerdef(oid) LIKE '% BEFORE UPDATE ON %') THEN
    RAISE EXCEPTION 'Only the existing BEFORE UPDATE timestamp utility is approved';
  END IF;
  -- Only the existing timestamp utility can run; inserts below must leave products intact.
  INSERT INTO auth.users (id) VALUES (v_user_id);
  INSERT INTO public.businesses (name) VALUES ('Temporary purchases test') RETURNING id INTO v_business_id;
  INSERT INTO public.businesses (name) VALUES ('Other temporary purchases test') RETURNING id INTO v_other_business_id;
  INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost)
  VALUES (v_business_id, 'Temporary catalog product', 200, 80) RETURNING * INTO v_product;
  INSERT INTO public.purchases (business_id, operation_id, supplier, total, created_by)
  VALUES (v_business_id, v_operation_id, 'Mayorista', 0, v_user_id) RETURNING * INTO v_default_purchase;
  IF v_default_purchase.id IS NULL OR v_default_purchase.operation_id IS DISTINCT FROM v_operation_id
     OR v_default_purchase.status IS DISTINCT FROM 'DRAFT' OR v_default_purchase.supplier IS DISTINCT FROM 'Mayorista'
     OR v_default_purchase.total IS DISTINCT FROM 0 OR v_default_purchase.notes IS NOT NULL
     OR v_default_purchase.purchased_at IS NOT NULL OR v_default_purchase.created_by IS DISTINCT FROM v_user_id
     OR v_default_purchase.created_at IS DISTINCT FROM transaction_timestamp()
     OR v_default_purchase.updated_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Purchase defaults, supplier, zero total or audit fields failed';
  END IF;
  INSERT INTO public.purchases (business_id, operation_id, supplier, status, total, purchased_at,
                                notes, created_by, created_at, updated_at)
  VALUES (v_business_id, gen_random_uuid(), 'Distribuidora', 'COMPLETED', 150,
          '2030-01-07T09:30:00-03:00', 'Manual purchase notes', v_user_id,
          '1999-01-01T00:00:00Z', '2000-01-01T00:00:00Z') RETURNING * INTO v_full_purchase;
  IF v_full_purchase.total IS DISTINCT FROM 150 OR v_full_purchase.status IS DISTINCT FROM 'COMPLETED'
     OR v_full_purchase.notes IS DISTINCT FROM 'Manual purchase notes'
     OR v_full_purchase.purchased_at IS DISTINCT FROM '2030-01-07T12:30:00Z'::timestamptz THEN
    RAISE EXCEPTION 'Positive total, notes, completed status or purchase timezone failed';
  END IF;
  -- The same operation may be reused in another business, never within the same one.
  INSERT INTO public.purchases (business_id, operation_id, supplier, total, created_by)
  VALUES (v_other_business_id, v_operation_id, 'Mayorista', 10, v_user_id);
  SELECT * INTO v_actual_product FROM public.products WHERE id = v_product.id;
  IF v_actual_product IS DISTINCT FROM v_product THEN
    RAISE EXCEPTION 'Purchase inserts changed product cost or catalog fields';
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('business_id = gen_random_uuid()', '23503', 'purchases_business_id_fkey', NULL),
      ('business_id = NULL', '23502', NULL, 'business_id'),
      ('operation_id = NULL', '23502', NULL, 'operation_id'),
      ('supplier = NULL', '23502', NULL, 'supplier'),
      ('supplier = ''''', '23514', 'purchases_supplier_check', NULL),
      ('supplier = ''   ''', '23514', 'purchases_supplier_check', NULL),
      ('status = NULL', '23502', NULL, 'status'),
      ('status = ''PENDING''', '23514', 'purchases_status_check', NULL),
      ('status = ''CANCELLED''', '23514', 'purchases_status_check', NULL),
      ('total = NULL', '23502', NULL, 'total'),
      ('total = -0.01', '23514', 'purchases_total_check', NULL),
      ('total = ''NaN''::numeric', '23514', 'purchases_total_not_nan_check', NULL),
      ('created_by = gen_random_uuid()', '23503', 'purchases_created_by_fkey', NULL),
      ('created_by = NULL', '23502', NULL, 'created_by'),
      ('created_at = NULL', '23502', NULL, 'created_at')
    ) AS cases(assignments, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.purchases SET %s WHERE id = %L', v_case.assignments, v_full_purchase.id);
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
      (format('INSERT INTO public.purchases (business_id, operation_id, supplier, total, created_by) VALUES (%L, %L, ''Duplicate'', 1, %L)', v_business_id, v_operation_id, v_user_id), '23505', 'purchases_business_id_operation_id_key', NULL),
      (format('INSERT INTO public.purchases (business_id, supplier, total, created_by) VALUES (%L, ''Missing operation'', 0, %L)', v_business_id, v_user_id), '23502', NULL, 'operation_id'),
      (format('INSERT INTO public.purchases (business_id, operation_id, total, created_by) VALUES (%L, gen_random_uuid(), 0, %L)', v_business_id, v_user_id), '23502', NULL, 'supplier'),
      (format('INSERT INTO public.purchases (business_id, operation_id, supplier, created_by) VALUES (%L, gen_random_uuid(), ''Missing total'', %L)', v_business_id, v_user_id), '23502', NULL, 'total'),
      (format('INSERT INTO public.purchases (business_id, operation_id, supplier, total) VALUES (%L, gen_random_uuid(), ''Missing actor'', 0)', v_business_id), '23502', NULL, 'created_by'),
      (format('INSERT INTO public.purchases (business_id, operation_id, supplier, total, created_by, updated_at) VALUES (%L, gen_random_uuid(), ''Missing timestamp'', 0, %L, NULL)', v_business_id, v_user_id), '23502', NULL, 'updated_at'),
      (format('DELETE FROM public.businesses WHERE id = %L', v_other_business_id), '23503', 'purchases_business_id_fkey', NULL),
      (format('DELETE FROM auth.users WHERE id = %L', v_user_id), '23503', 'purchases_created_by_fkey', NULL)
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

  -- State representation only; no transition or completed-record immutability is added here.
  FOREACH v_status IN ARRAY ARRAY['DRAFT', 'COMPLETED', 'VOIDED'] LOOP
    UPDATE public.purchases SET status = v_status WHERE id = v_full_purchase.id RETURNING * INTO v_updated_purchase;
    IF v_updated_purchase.status IS DISTINCT FROM v_status
       OR v_updated_purchase.updated_at IS DISTINCT FROM transaction_timestamp()
       OR v_updated_purchase.updated_at <= v_full_purchase.updated_at
       OR v_updated_purchase.created_at IS DISTINCT FROM v_full_purchase.created_at
       OR v_updated_purchase.purchased_at IS DISTINCT FROM v_full_purchase.purchased_at
       OR v_updated_purchase.total IS DISTINCT FROM v_full_purchase.total THEN
      RAISE EXCEPTION 'Status representation, stable purchase fields or updated_at utility failed';
    END IF;
  END LOOP;
  SELECT * INTO v_actual_product FROM public.products WHERE id = v_product.id;
  IF v_actual_product IS DISTINCT FROM v_product THEN RAISE EXCEPTION 'Status updates changed product catalog'; END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.purchases;
    IF v_count <> 0 THEN RAISE EXCEPTION '% can read purchases', v_role; END IF;
    UPDATE public.purchases SET total = 1;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can update purchases', v_role; END IF;
    DELETE FROM public.purchases;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can delete purchases', v_role; END IF;
    BEGIN
      INSERT INTO public.purchases (business_id, operation_id, supplier, total, created_by)
      VALUES (v_business_id, gen_random_uuid(), 'Denied', 1, v_user_id);
      RAISE EXCEPTION '% can insert purchases', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.purchases WHERE business_id IN (v_business_id, v_other_business_id);
  IF v_count <> 3 THEN RAISE EXCEPTION 'Denied client writes changed purchase count'; END IF;
  SELECT * INTO v_actual_purchase FROM public.purchases WHERE id = v_full_purchase.id;
  IF v_actual_purchase IS DISTINCT FROM v_updated_purchase THEN RAISE EXCEPTION 'Denied client writes changed purchase'; END IF;
  SELECT * INTO v_actual_purchase FROM public.purchases WHERE id = v_default_purchase.id;
  IF v_actual_purchase IS DISTINCT FROM v_default_purchase THEN RAISE EXCEPTION 'Draft purchase changed unexpectedly'; END IF;
  RAISE NOTICE 'BF-065 passed: schema, defaults, % constraint rejections, scoped idempotency, supplier, statuses, no side effects, timestamps and RLS', v_rejections;
END;
$$;

ROLLBACK;
