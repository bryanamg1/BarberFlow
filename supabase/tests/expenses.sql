\set ON_ERROR_STOP on
BEGIN;

-- Administrative local fixtures only; no expense, receipt file or seed is persisted.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_expense_user_id uuid := gen_random_uuid();
  v_business_id uuid;
  v_category public.expense_categories%ROWTYPE;
  v_actual_category public.expense_categories%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_actual_product public.products%ROWTYPE;
  v_purchase public.purchases%ROWTYPE;
  v_actual_purchase public.purchases%ROWTYPE;
  v_movement public.stock_movements%ROWTYPE;
  v_actual_movement public.stock_movements%ROWTYPE;
  v_manual public.expenses%ROWTYPE;
  v_generated public.expenses%ROWTYPE;
  v_zero public.expenses%ROWTYPE;
  v_updated public.expenses%ROWTYPE;
  v_actual_expense public.expenses%ROWTYPE;
  v_method text;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_stock bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
  v_rejections integer := 0;
BEGIN
  -- Exact metadata excludes soft delete, extra ownership, currency and derived metrics.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'expenses') <> 14 THEN
    RAISE EXCEPTION 'Unexpected expenses columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'), ('business_id', 'uuid', 'NO'), ('category_id', 'uuid', 'NO'),
      ('source_type', 'text', 'NO'), ('purchase_id', 'uuid', 'YES'), ('description', 'text', 'NO'),
      ('amount', 'numeric', 'NO'), ('payment_method', 'text', 'NO'), ('expense_date', 'date', 'NO'),
      ('receipt_path', 'text', 'YES'), ('notes', 'text', 'YES'), ('created_by', 'uuid', 'NO'),
      ('created_at', 'timestamptz', 'NO'), ('updated_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                   WHERE c.table_schema = 'public' AND c.table_name = 'expenses'
                     AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
                     AND c.is_nullable = v_case.is_nullable AND c.is_generated = 'NEVER') THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'expenses' AND column_name = 'amount'
                  AND numeric_precision = 12 AND numeric_scale = 2)
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'expenses' AND column_name NOT IN ('id', 'created_at', 'updated_at')
                 AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'Expected numeric(12,2) and explicit expense data without defaults';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.expenses'::regclass) <> 10
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.expenses'::regclass
                    AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') THEN
    RAISE EXCEPTION 'Expected PK, four FKs, purchase uniqueness and four CHECKs';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('expenses_business_id_fkey', 'public.businesses', 'business_id'),
      ('expenses_category_id_fkey', 'public.expense_categories', 'category_id'),
      ('expenses_purchase_id_fkey', 'public.purchases', 'purchase_id'),
      ('expenses_created_by_fkey', 'auth.users', 'created_by')
    ) AS foreign_keys(constraint_name, target_table, column_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                   WHERE c.conrelid = 'public.expenses'::regclass
                     AND c.conname = v_case.constraint_name AND c.contype = 'f'
                     AND c.confrelid = v_case.target_table::regclass AND c.confdeltype = 'r'
                     AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                           WHERE attrelid = 'public.expenses'::regclass
                                             AND attname = v_case.column_name)]::smallint[]
                     AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute
                                            WHERE attrelid = v_case.target_table::regclass
                                              AND attname = 'id')]::smallint[]) THEN
      RAISE EXCEPTION 'Restrictive FK mismatch: %', v_case.constraint_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.expenses'::regclass AND contype = 'u') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.expenses'::regclass
                    AND conname = 'expenses_purchase_id_key' AND contype = 'u'
                    AND pg_get_constraintdef(oid) = 'UNIQUE (purchase_id)')
     OR (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'expenses') <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'expenses'
                    AND indexname = 'expenses_business_id_expense_date_idx'
                    AND indexdef LIKE '% USING btree (business_id, expense_date)') THEN
    RAISE EXCEPTION 'Only PK, purchase uniqueness and business/date index are approved';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.expenses'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'expenses') THEN
    RAISE EXCEPTION 'Expenses must have RLS enabled without policies';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.expenses'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.expenses'::regclass
                    AND tgname = 'expenses_set_updated_at' AND tgenabled = 'O'
                    AND tgfoid = 'public.set_updated_at()'::regprocedure
                    AND pg_get_triggerdef(oid) LIKE '% BEFORE UPDATE ON %'
                    AND pg_get_triggerdef(oid) LIKE '% FOR EACH ROW %') THEN
    RAISE EXCEPTION 'Only the existing timestamp utility is approved';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id), (v_expense_user_id);
  INSERT INTO public.businesses (name) VALUES ('Temporary expenses test') RETURNING id INTO v_business_id;
  INSERT INTO public.expense_categories (business_id, name)
  VALUES (v_business_id, 'Temporary expense category') RETURNING * INTO v_category;
  INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost, minimum_stock)
  VALUES (v_business_id, 'Temporary product', 200, 80, 3) RETURNING * INTO v_product;
  INSERT INTO public.purchases (business_id, operation_id, supplier, total, created_by)
  VALUES (v_business_id, gen_random_uuid(), 'Temporary supplier', 800, v_user_id) RETURNING * INTO v_purchase;
  INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, unit_cost, created_by)
  VALUES (v_business_id, v_product.id, 'PURCHASE', 10, 80, v_user_id) RETURNING * INTO v_movement;
  IF EXISTS (SELECT 1 FROM public.expenses) THEN RAISE EXCEPTION 'Purchase automatically created an expense'; END IF;

  INSERT INTO public.expenses (business_id, category_id, source_type, description, amount,
                               payment_method, expense_date, created_by)
  VALUES (v_business_id, v_category.id, 'MANUAL', 'Temporary manual expense', 12.34,
          'CASH', '2026-10-07', v_expense_user_id) RETURNING * INTO v_manual;
  IF v_manual.id IS NULL OR v_manual.business_id IS DISTINCT FROM v_business_id
     OR v_manual.category_id IS DISTINCT FROM v_category.id OR v_manual.source_type IS DISTINCT FROM 'MANUAL'
     OR v_manual.purchase_id IS NOT NULL OR v_manual.receipt_path IS NOT NULL OR v_manual.notes IS NOT NULL
     OR v_manual.amount IS DISTINCT FROM 12.34 OR v_manual.payment_method IS DISTINCT FROM 'CASH'
     OR v_manual.expense_date IS DISTINCT FROM '2026-10-07'::date
     OR v_manual.created_by IS DISTINCT FROM v_expense_user_id
     OR v_manual.created_at IS DISTINCT FROM transaction_timestamp()
     OR v_manual.updated_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Manual expense, optional fields, civil date or audit defaults failed';
  END IF;
  -- Explicit purchase expense only; amount is not automatically synchronized with total.
  INSERT INTO public.expenses (business_id, category_id, source_type, purchase_id, description,
                               amount, payment_method, expense_date, receipt_path, notes,
                               created_by, created_at, updated_at)
  VALUES (v_business_id, v_category.id, 'PURCHASE', v_purchase.id, 'Temporary purchase expense',
          50, 'TRANSFER', '2026-10-06', 'temporary/receipt.png', 'Temporary note',
          v_expense_user_id, '1999-01-01T00:00:00Z', '2000-01-01T00:00:00Z') RETURNING * INTO v_generated;
  IF v_generated.source_type IS DISTINCT FROM 'PURCHASE' OR v_generated.purchase_id IS DISTINCT FROM v_purchase.id
     OR v_generated.amount IS DISTINCT FROM 50 OR v_generated.receipt_path IS DISTINCT FROM 'temporary/receipt.png'
     OR v_generated.notes IS DISTINCT FROM 'Temporary note' OR v_generated.expense_date IS DISTINCT FROM '2026-10-06'::date
     OR v_generated.created_at IS DISTINCT FROM '1999-01-01T00:00:00Z'::timestamptz
     OR v_generated.updated_at IS DISTINCT FROM '2000-01-01T00:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'Explicit purchase relation, receipt, notes or timestamps failed';
  END IF;
  -- Zero, empty descriptions/notes and duplicate manual data are deliberately allowed.
  INSERT INTO public.expenses (business_id, category_id, source_type, description, amount,
                               payment_method, expense_date, notes, created_by, created_at, updated_at)
  VALUES (v_business_id, v_category.id, 'MANUAL', '', 0, 'OTHER', '2026-10-07', '',
          v_expense_user_id, '1998-01-01T00:00:00Z', '2000-01-01T00:00:00Z') RETURNING * INTO v_zero;
  IF v_zero.amount IS DISTINCT FROM 0 OR v_zero.description IS DISTINCT FROM '' OR v_zero.notes IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'Approved zero amount or unrestricted text failed';
  END IF;
  FOREACH v_method IN ARRAY ARRAY['CASH', 'TRANSFER', 'DEBIT', 'CREDIT', 'OTHER'] LOOP
    INSERT INTO public.expenses (business_id, category_id, source_type, description, amount,
                                 payment_method, expense_date, created_by)
    VALUES (v_business_id, v_category.id, 'MANUAL', 'Temporary manual expense', 12.34,
            v_method, '2026-10-07', v_expense_user_id);
  END LOOP;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('id = NULL', '23502', NULL, 'id'),
      ('business_id = gen_random_uuid()', '23503', 'expenses_business_id_fkey', NULL),
      ('business_id = NULL', '23502', NULL, 'business_id'),
      ('category_id = gen_random_uuid()', '23503', 'expenses_category_id_fkey', NULL),
      ('category_id = NULL', '23502', NULL, 'category_id'),
      ('source_type = NULL', '23502', NULL, 'source_type'),
      ('source_type = ''OTHER''', '23514', NULL, NULL),
      ('source_type = ''manual''', '23514', NULL, NULL),
      ('source_type = ''''', '23514', NULL, NULL),
      ('source_type = ''PURCHASE''', '23514', 'expenses_purchase_source_check', NULL),
      (format('purchase_id = %L', v_purchase.id), '23514', 'expenses_purchase_source_check', NULL),
      ('description = NULL', '23502', NULL, 'description'),
      ('amount = NULL', '23502', NULL, 'amount'),
      ('amount = -0.01', '23514', 'expenses_amount_check', NULL),
      ('amount = ''NaN''::numeric', '23514', 'expenses_amount_check', NULL),
      ('amount = 10000000000', '22003', NULL, NULL),
      ('payment_method = NULL', '23502', NULL, 'payment_method'),
      ('payment_method = ''CARD''', '23514', 'expenses_payment_method_check', NULL),
      ('payment_method = ''cash''', '23514', 'expenses_payment_method_check', NULL),
      ('expense_date = NULL', '23502', NULL, 'expense_date'),
      ('expense_date = ''2026-02-30''', '22008', NULL, NULL),
      ('created_by = gen_random_uuid()', '23503', 'expenses_created_by_fkey', NULL),
      ('created_by = NULL', '23502', NULL, 'created_by'),
      ('created_at = NULL', '23502', NULL, 'created_at')
    ) AS cases(assignments, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.expenses SET %s WHERE id = %L', v_case.assignments, v_manual.id);
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
      (format('UPDATE public.expenses SET purchase_id = gen_random_uuid() WHERE id = %L', v_generated.id), '23503', 'expenses_purchase_id_fkey', NULL),
      (format('UPDATE public.expenses SET purchase_id = NULL WHERE id = %L', v_generated.id), '23514', 'expenses_purchase_source_check', NULL),
      (format('UPDATE public.expenses SET source_type = ''MANUAL'' WHERE id = %L', v_generated.id), '23514', 'expenses_purchase_source_check', NULL),
      (format('INSERT INTO public.expenses (business_id, category_id, source_type, purchase_id, description, amount, payment_method, expense_date, created_by) SELECT business_id, category_id, source_type, purchase_id, description, amount, payment_method, expense_date, created_by FROM public.expenses WHERE id = %L', v_generated.id), '23505', 'expenses_purchase_id_key', NULL),
      (format('DELETE FROM public.purchases WHERE id = %L', v_purchase.id), '23503', 'expenses_purchase_id_fkey', NULL),
      (format('DELETE FROM public.expense_categories WHERE id = %L', v_category.id), '23503', 'expenses_category_id_fkey', NULL),
      (format('DELETE FROM auth.users WHERE id = %L', v_expense_user_id), '23503', 'expenses_created_by_fkey', NULL),
      (format('INSERT INTO public.expenses (business_id, category_id, source_type, description, amount, payment_method, expense_date, created_by, updated_at) SELECT business_id, category_id, source_type, description, amount, payment_method, expense_date, created_by, NULL FROM public.expenses WHERE id = %L', v_manual.id), '23502', NULL, 'updated_at')
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
  -- Each required input must be supplied; only UUID and timestamps have defaults.
  FOREACH v_column IN ARRAY ARRAY['business_id', 'category_id', 'source_type', 'description',
                                  'amount', 'payment_method', 'expense_date', 'created_by'] LOOP
    BEGIN
      EXECUTE format('INSERT INTO public.expenses (%1$s) SELECT %1$s FROM public.expenses WHERE id = %2$L',
        (SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal)
           FROM unnest(ARRAY['business_id', 'category_id', 'source_type', 'description', 'amount', 'payment_method', 'expense_date', 'created_by']) WITH ORDINALITY AS fields(column_name, ordinal)
          WHERE column_name <> v_column), v_manual.id);
      RAISE EXCEPTION 'Expected missing input rejection for %', v_column;
    EXCEPTION WHEN not_null_violation THEN
      GET STACKED DIAGNOSTICS v_state = COLUMN_NAME;
      IF v_state <> v_column THEN RAISE; END IF;
      v_rejections := v_rejections + 1;
    END;
  END LOOP;

  UPDATE public.expenses SET description = 'Updated manual description', notes = 'Updated note'
  WHERE id = v_zero.id RETURNING * INTO v_updated;
  IF v_updated.updated_at IS DISTINCT FROM transaction_timestamp() OR v_updated.updated_at <= v_zero.updated_at
     OR v_updated.created_at IS DISTINCT FROM v_zero.created_at OR v_updated.amount IS DISTINCT FROM 0
     OR v_updated.description IS DISTINCT FROM 'Updated manual description'
     OR v_updated.notes IS DISTINCT FROM 'Updated note' THEN
    RAISE EXCEPTION 'Manual update, updated_at or stable created_at failed';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.expenses;
    IF v_count <> 0 THEN RAISE EXCEPTION '% can read expenses', v_role; END IF;
    UPDATE public.expenses SET amount = 1;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can update expenses', v_role; END IF;
    DELETE FROM public.expenses;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can delete expenses', v_role; END IF;
    BEGIN
      INSERT INTO public.expenses (business_id, category_id, source_type, description, amount,
                                   payment_method, expense_date, created_by)
      VALUES (v_business_id, v_category.id, 'MANUAL', 'Denied', 1, 'CASH', '2026-10-07', v_expense_user_id);
      RAISE EXCEPTION '% can insert expenses', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.expenses;
  IF v_count <> 8 THEN RAISE EXCEPTION 'Manual duplicates lost, auto expense created or denied writes changed rows'; END IF;
  SELECT * INTO v_actual_expense FROM public.expenses WHERE id = v_manual.id;
  IF v_actual_expense IS DISTINCT FROM v_manual THEN RAISE EXCEPTION 'Manual expense changed unexpectedly'; END IF;
  SELECT * INTO v_actual_expense FROM public.expenses WHERE id = v_generated.id;
  IF v_actual_expense IS DISTINCT FROM v_generated THEN RAISE EXCEPTION 'Purchase expense changed unexpectedly'; END IF;
  SELECT * INTO v_actual_expense FROM public.expenses WHERE id = v_zero.id;
  IF v_actual_expense IS DISTINCT FROM v_updated THEN RAISE EXCEPTION 'Denied writes changed updated manual expense'; END IF;
  SELECT * INTO v_actual_category FROM public.expense_categories WHERE id = v_category.id;
  SELECT count(*) INTO v_count FROM public.expense_categories;
  IF v_count <> 1 OR v_actual_category IS DISTINCT FROM v_category THEN RAISE EXCEPTION 'Expense changed categories'; END IF;
  SELECT * INTO v_actual_purchase FROM public.purchases WHERE id = v_purchase.id;
  SELECT * INTO v_actual_product FROM public.products WHERE id = v_product.id;
  SELECT * INTO v_actual_movement FROM public.stock_movements WHERE id = v_movement.id;
  SELECT count(*), sum(quantity_delta) INTO v_count, v_stock FROM public.stock_movements;
  IF v_actual_purchase IS DISTINCT FROM v_purchase OR v_actual_product IS DISTINCT FROM v_product
     OR v_actual_movement IS DISTINCT FROM v_movement OR v_count <> 1 OR v_stock <> 10 THEN
    RAISE EXCEPTION 'Expenses changed purchase, product, stock or inventory ledger';
  END IF;
  RAISE NOTICE 'BF-069 passed: schema, % rejections, MANUAL/PURCHASE, unique purchase, zero amount, civil date, audit, timestamps, no side effects and RLS', v_rejections;
END;
$$;

ROLLBACK;
