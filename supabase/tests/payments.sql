\set ON_ERROR_STOP on
BEGIN;

-- Administrative local fixtures only, including FK identities; everything rolls back.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_payment_user_id uuid := gen_random_uuid();
  v_business_id uuid;
  v_sale public.sales%ROWTYPE;
  v_actual_sale public.sales%ROWTYPE;
  v_cash public.payments%ROWTYPE;
  v_transfer public.payments%ROWTYPE;
  v_actual_payment public.payments%ROWTYPE;
  v_method text;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_total numeric;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
  v_rejections integer := 0;
BEGIN
  -- Exact columns exclude reference, updated_at, archive, providers and refunds.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'payments') <> 9 THEN
    RAISE EXCEPTION 'Unexpected payments columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('business_id', 'uuid', 'NO'),
      ('sale_id', 'uuid', 'NO'),
      ('payment_method', 'text', 'NO'),
      ('amount', 'numeric', 'NO'),
      ('notes', 'text', 'YES'),
      ('paid_at', 'timestamptz', 'NO'),
      ('created_by', 'uuid', 'NO'),
      ('created_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'payments'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = v_case.is_nullable AND c.is_generated = 'NEVER'
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'payments' AND column_name = 'amount'
                  AND numeric_precision = 12 AND numeric_scale = 2) THEN
    RAISE EXCEPTION 'Payment amount must use numeric(12,2)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'payments'
              AND column_name IN ('business_id', 'sale_id', 'payment_method', 'amount', 'notes', 'created_by')
              AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'Payment relations, method, amount, notes and actor must have no defaults';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payments'::regclass
                 AND conname = 'payments_pkey' AND contype = 'p') THEN
    RAISE EXCEPTION 'Payments PK missing';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('payments_business_id_fkey', 'public.businesses'),
      ('payments_sale_id_fkey', 'public.sales'),
      ('payments_created_by_fkey', 'auth.users')
    ) AS foreign_keys(constraint_name, target_table)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payments'::regclass
                   AND conname = v_case.constraint_name AND contype = 'f'
                   AND confrelid = v_case.target_table::regclass AND confdeltype = 'r') THEN
      RAISE EXCEPTION 'Restrictive FK missing: %', v_case.constraint_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payments'::regclass AND contype = 'u')
     OR (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payments') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'payments'
                    AND indexname = 'payments_sale_id_idx' AND indexdef LIKE '% USING btree (sale_id)') THEN
    RAISE EXCEPTION 'Only PK and nonunique sale lookup index are approved';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payments'::regclass)
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'payments')
        IS DISTINCT FROM ARRAY['payments_select_authorized']::text[] THEN
    RAISE EXCEPTION 'Payments must have RLS enabled with exactly its BF-077 SELECT policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.payments'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'No payment aggregate, completion, timestamp or commerce trigger is approved';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id), (v_payment_user_id);
  INSERT INTO public.businesses (name) VALUES ('Temporary payments test') RETURNING id INTO v_business_id;
  INSERT INTO public.sales (business_id, operation_id, subtotal, total, created_by, updated_at)
  VALUES (v_business_id, gen_random_uuid(), 100, 100, v_user_id, '2000-01-01T00:00:00Z') RETURNING * INTO v_sale;
  INSERT INTO public.payments (business_id, sale_id, payment_method, amount, created_by)
  VALUES (v_business_id, v_sale.id, 'CASH', 60, v_payment_user_id) RETURNING * INTO v_cash;
  IF v_cash.id IS NULL OR v_cash.amount IS DISTINCT FROM 60 OR v_cash.notes IS NOT NULL
     OR v_cash.created_by IS DISTINCT FROM v_payment_user_id
     OR v_cash.paid_at IS DISTINCT FROM transaction_timestamp()
     OR v_cash.created_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Payment identity, positive amount, optional notes or audit defaults failed';
  END IF;
  SELECT * INTO v_actual_sale FROM public.sales WHERE id = v_sale.id;
  IF v_actual_sale IS DISTINCT FROM v_sale THEN RAISE EXCEPTION 'Partial payment changed sale'; END IF;
  INSERT INTO public.payments (business_id, sale_id, payment_method, amount, notes, paid_at, created_by, created_at)
  VALUES (v_business_id, v_sale.id, 'TRANSFER', 40, 'Manual transfer reference',
          '2030-01-07T09:30:00-03:00', v_payment_user_id, '1999-01-01T00:00:00Z') RETURNING * INTO v_transfer;
  IF v_transfer.notes IS DISTINCT FROM 'Manual transfer reference'
     OR v_transfer.paid_at IS DISTINCT FROM '2030-01-07T12:30:00Z'::timestamptz
     OR v_transfer.created_at IS DISTINCT FROM '1999-01-01T00:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'Explicit notes, paid_at timezone or creation time failed';
  END IF;
  SELECT count(*), sum(amount) INTO v_count, v_total FROM public.payments WHERE sale_id = v_sale.id;
  IF v_count <> 2 OR v_total IS DISTINCT FROM 100 THEN RAISE EXCEPTION 'Split payments 60 + 40 failed'; END IF;
  SELECT * INTO v_actual_sale FROM public.sales WHERE id = v_sale.id;
  IF v_actual_sale IS DISTINCT FROM v_sale THEN RAISE EXCEPTION 'Full payment automatically completed or changed sale'; END IF;
  -- Every documented method works; repeated methods and overpayment are not restricted here.
  FOREACH v_method IN ARRAY ARRAY['CASH', 'DEBIT', 'CREDIT', 'OTHER'] LOOP
    INSERT INTO public.payments (business_id, sale_id, payment_method, amount, notes, created_by)
    VALUES (v_business_id, v_sale.id, v_method, 0.01, '', v_payment_user_id);
  END LOOP;
  SELECT count(*), sum(amount) INTO v_count, v_total FROM public.payments WHERE sale_id = v_sale.id;
  IF v_count <> 6 OR v_total IS DISTINCT FROM 100.04 THEN RAISE EXCEPTION 'Methods, repeated payments or no aggregate validation failed'; END IF;
  SELECT * INTO v_actual_sale FROM public.sales WHERE id = v_sale.id;
  IF v_actual_sale IS DISTINCT FROM v_sale OR v_actual_sale.status IS DISTINCT FROM 'DRAFT'
     OR v_actual_sale.sold_at IS NOT NULL OR v_actual_sale.total IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'Payments must not change sale status, sold_at, totals or timestamps';
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('business_id = gen_random_uuid()', '23503', 'payments_business_id_fkey', NULL),
      ('business_id = NULL', '23502', NULL, 'business_id'),
      ('sale_id = gen_random_uuid()', '23503', 'payments_sale_id_fkey', NULL),
      ('sale_id = NULL', '23502', NULL, 'sale_id'),
      ('payment_method = NULL', '23502', NULL, 'payment_method'),
      ('payment_method = ''CARD''', '23514', 'payments_payment_method_check', NULL),
      ('payment_method = ''cash''', '23514', 'payments_payment_method_check', NULL),
      ('payment_method = ''''', '23514', 'payments_payment_method_check', NULL),
      ('amount = NULL', '23502', NULL, 'amount'),
      ('amount = 0', '23514', 'payments_amount_check', NULL),
      ('amount = -0.01', '23514', 'payments_amount_check', NULL),
      ('amount = ''NaN''::numeric', '23514', 'payments_amount_check', NULL),
      ('paid_at = NULL', '23502', NULL, 'paid_at'),
      ('created_by = gen_random_uuid()', '23503', 'payments_created_by_fkey', NULL),
      ('created_by = NULL', '23502', NULL, 'created_by'),
      ('created_at = NULL', '23502', NULL, 'created_at')
    ) AS cases(assignments, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.payments SET %s WHERE id = %L', v_case.assignments, v_cash.id);
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
      (format('INSERT INTO public.payments (business_id, sale_id, amount, created_by) VALUES (%L, %L, 1, %L)', v_business_id, v_sale.id, v_payment_user_id), '23502', NULL, 'payment_method'),
      (format('INSERT INTO public.payments (business_id, sale_id, payment_method, created_by) VALUES (%L, %L, ''CASH'', %L)', v_business_id, v_sale.id, v_payment_user_id), '23502', NULL, 'amount'),
      (format('INSERT INTO public.payments (business_id, sale_id, payment_method, amount) VALUES (%L, %L, ''CASH'', 1)', v_business_id, v_sale.id), '23502', NULL, 'created_by'),
      (format('DELETE FROM public.sales WHERE id = %L', v_sale.id), '23503', 'payments_sale_id_fkey', NULL),
      (format('DELETE FROM auth.users WHERE id = %L', v_payment_user_id), '23503', 'payments_created_by_fkey', NULL)
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

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.payments;
    IF v_count <> 0 THEN RAISE EXCEPTION '% can read payments', v_role; END IF;
    UPDATE public.payments SET amount = 1;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can update payments', v_role; END IF;
    DELETE FROM public.payments;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can delete payments', v_role; END IF;
    BEGIN
      INSERT INTO public.payments (business_id, sale_id, payment_method, amount, created_by)
      VALUES (v_business_id, v_sale.id, 'CASH', 1, v_payment_user_id);
      RAISE EXCEPTION '% can insert payments', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.payments WHERE sale_id = v_sale.id;
  IF v_count <> 6 THEN RAISE EXCEPTION 'Denied client writes changed payment count'; END IF;
  SELECT * INTO v_actual_payment FROM public.payments WHERE id = v_cash.id;
  IF v_actual_payment IS DISTINCT FROM v_cash THEN RAISE EXCEPTION 'Denied client writes changed cash payment'; END IF;
  SELECT * INTO v_actual_payment FROM public.payments WHERE id = v_transfer.id;
  IF v_actual_payment IS DISTINCT FROM v_transfer THEN RAISE EXCEPTION 'Denied client writes changed transfer payment'; END IF;
  SELECT * INTO v_actual_sale FROM public.sales WHERE id = v_sale.id;
  IF v_actual_sale IS DISTINCT FROM v_sale THEN RAISE EXCEPTION 'Sale header was changed'; END IF;
  RAISE NOTICE 'BF-064 passed: schema, defaults, % constraint rejections, five methods, split payments, no auto-completion and RLS', v_rejections;
END;
$$;

ROLLBACK;
