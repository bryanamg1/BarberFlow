\set ON_ERROR_STOP on
BEGIN;

-- Temporary administrative fixtures only; no real categories or seeds are persisted.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_business_id uuid;
  v_other_business_id uuid;
  v_default_category public.expense_categories%ROWTYPE;
  v_full_category public.expense_categories%ROWTYPE;
  v_updated_category public.expense_categories%ROWTYPE;
  v_actual_category public.expense_categories%ROWTYPE;
  v_inactive_category public.expense_categories%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_actual_product public.products%ROWTYPE;
  v_purchase public.purchases%ROWTYPE;
  v_actual_purchase public.purchases%ROWTYPE;
  v_movement public.stock_movements%ROWTYPE;
  v_actual_movement public.stock_movements%ROWTYPE;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
  v_rejections integer := 0;
BEGIN
  -- Exactly the catalog fields: no derived amounts, counters, budgets or expense links.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'expense_categories') <> 6 THEN
    RAISE EXCEPTION 'Unexpected expense_categories columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid'), ('business_id', 'uuid'), ('name', 'text'),
      ('is_active', 'bool'), ('created_at', 'timestamptz'), ('updated_at', 'timestamptz')
    ) AS columns(column_name, udt_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                   WHERE c.table_schema = 'public' AND c.table_name = 'expense_categories'
                     AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
                     AND c.is_nullable = 'NO' AND c.is_generated = 'NEVER') THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'expense_categories' AND column_name IN ('business_id', 'name')
              AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'Category ownership and name must be explicit';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.expense_categories'::regclass) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.expense_categories'::regclass
                    AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.expense_categories'::regclass
                    AND conname = 'expense_categories_business_id_fkey' AND contype = 'f'
                    AND confrelid = 'public.businesses'::regclass AND confdeltype = 'r'
                    AND pg_get_constraintdef(oid) = 'FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.expense_categories'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'Expected PK, restrictive business FK and name CHECK without uniqueness';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'expense_categories') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'expense_categories'
                    AND indexname = 'expense_categories_business_id_is_active_idx'
                    AND indexdef LIKE '% USING btree (business_id, is_active)') THEN
    RAISE EXCEPTION 'Expected PK and one business/active index';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.expense_categories'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'expense_categories') THEN
    RAISE EXCEPTION 'Expense categories must have RLS enabled without policies';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.expense_categories'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.expense_categories'::regclass
                    AND tgname = 'expense_categories_set_updated_at' AND tgenabled = 'O'
                    AND tgfoid = 'public.set_updated_at()'::regprocedure
                    AND pg_get_triggerdef(oid) LIKE '% BEFORE UPDATE ON %'
                    AND pg_get_triggerdef(oid) LIKE '% FOR EACH ROW %') THEN
    RAISE EXCEPTION 'Only the existing BEFORE UPDATE timestamp utility is approved';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id);
  INSERT INTO public.businesses (name) VALUES ('Temporary expense category test') RETURNING id INTO v_business_id;
  INSERT INTO public.businesses (name) VALUES ('Other expense category test') RETURNING id INTO v_other_business_id;
  INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost, minimum_stock)
  VALUES (v_business_id, 'Temporary catalog fixture', 200, 80, 3) RETURNING * INTO v_product;
  INSERT INTO public.purchases (business_id, operation_id, supplier, total, created_by)
  VALUES (v_business_id, gen_random_uuid(), 'Temporary supplier', 800, v_user_id) RETURNING * INTO v_purchase;
  INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, unit_cost, created_by)
  VALUES (v_business_id, v_product.id, 'PURCHASE', 10, 80, v_user_id) RETURNING * INTO v_movement;

  INSERT INTO public.expense_categories (business_id, name)
  VALUES (v_business_id, 'Temporary shared category') RETURNING * INTO v_default_category;
  IF v_default_category.id IS NULL OR v_default_category.is_active IS DISTINCT FROM true
     OR v_default_category.business_id IS DISTINCT FROM v_business_id
     OR v_default_category.name IS DISTINCT FROM 'Temporary shared category'
     OR v_default_category.created_at IS DISTINCT FROM transaction_timestamp()
     OR v_default_category.updated_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Category UUID, active flag, name, ownership or timestamp defaults failed';
  END IF;
  -- Same name is valid both within a business and across different businesses.
  INSERT INTO public.expense_categories (business_id, name, created_at, updated_at)
  VALUES (v_business_id, 'Temporary shared category', '1999-01-01T00:00:00Z', '2000-01-01T00:00:00Z')
  RETURNING * INTO v_full_category;
  INSERT INTO public.expense_categories (business_id, name)
  VALUES (v_other_business_id, 'Temporary shared category');
  INSERT INTO public.expense_categories (business_id, name, is_active)
  VALUES (v_business_id, 'Temporary inactive category', false) RETURNING * INTO v_inactive_category;
  IF v_inactive_category.is_active IS DISTINCT FROM false THEN RAISE EXCEPTION 'Explicit archive flag was lost'; END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('INSERT INTO public.expense_categories (business_id, name) VALUES (gen_random_uuid(), ''Invalid'')', '23503', 'expense_categories_business_id_fkey', NULL),
      ('INSERT INTO public.expense_categories (business_id, name) VALUES (NULL, ''Invalid'')', '23502', NULL, 'business_id'),
      (format('INSERT INTO public.expense_categories (business_id, name) VALUES (%L, NULL)', v_business_id), '23502', NULL, 'name'),
      (format('INSERT INTO public.expense_categories (business_id, name) VALUES (%L, '''')', v_business_id), '23514', 'expense_categories_name_check', NULL),
      (format('INSERT INTO public.expense_categories (business_id, name) VALUES (%L, ''   '')', v_business_id), '23514', 'expense_categories_name_check', NULL),
      (format('UPDATE public.expense_categories SET name = '''' WHERE id = %L', v_full_category.id), '23514', 'expense_categories_name_check', NULL),
      (format('DELETE FROM public.businesses WHERE id = %L', v_other_business_id), '23503', 'expense_categories_business_id_fkey', NULL),
      (format('INSERT INTO public.expense_categories (business_id, name, is_active) VALUES (%L, ''Invalid'', NULL)', v_business_id), '23502', NULL, 'is_active'),
      (format('INSERT INTO public.expense_categories (business_id, name, created_at) VALUES (%L, ''Invalid'', NULL)', v_business_id), '23502', NULL, 'created_at'),
      (format('INSERT INTO public.expense_categories (business_id, name, updated_at) VALUES (%L, ''Invalid'', NULL)', v_business_id), '23502', NULL, 'updated_at'),
      ('INSERT INTO public.expense_categories (name) VALUES (''Missing business'')', '23502', NULL, 'business_id'),
      (format('INSERT INTO public.expense_categories (business_id) VALUES (%L)', v_business_id), '23502', NULL, 'name'),
      (format('INSERT INTO public.expense_categories (id, business_id, name) VALUES (NULL, %L, ''Invalid'')', v_business_id), '23502', NULL, 'id')
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

  UPDATE public.expense_categories SET name = 'Temporary archived category', is_active = false
  WHERE id = v_full_category.id RETURNING * INTO v_updated_category;
  IF v_updated_category.updated_at IS DISTINCT FROM transaction_timestamp()
     OR v_updated_category.updated_at <= v_full_category.updated_at
     OR v_updated_category.created_at IS DISTINCT FROM v_full_category.created_at
     OR v_updated_category.name IS DISTINCT FROM 'Temporary archived category'
     OR v_updated_category.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Category rename, timestamps or soft archive failed';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.expense_categories;
    IF v_count <> 0 THEN RAISE EXCEPTION '% can read expense categories', v_role; END IF;
    UPDATE public.expense_categories SET name = 'Forbidden', is_active = true;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can update expense categories', v_role; END IF;
    DELETE FROM public.expense_categories;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can delete expense categories', v_role; END IF;
    BEGIN
      INSERT INTO public.expense_categories (business_id, name) VALUES (v_business_id, 'Denied');
      RAISE EXCEPTION '% can insert expense categories', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.expense_categories WHERE business_id IN (v_business_id, v_other_business_id);
  IF v_count <> 4 THEN RAISE EXCEPTION 'Duplicate categories lost or denied writes changed fixtures'; END IF;
  SELECT * INTO v_actual_category FROM public.expense_categories WHERE id = v_full_category.id;
  IF v_actual_category IS DISTINCT FROM v_updated_category THEN RAISE EXCEPTION 'Denied writes changed archived category'; END IF;
  SELECT * INTO v_actual_category FROM public.expense_categories WHERE id = v_default_category.id;
  IF v_actual_category IS DISTINCT FROM v_default_category THEN RAISE EXCEPTION 'Default category changed unexpectedly'; END IF;
  SELECT * INTO v_actual_product FROM public.products WHERE id = v_product.id;
  SELECT * INTO v_actual_purchase FROM public.purchases WHERE id = v_purchase.id;
  SELECT * INTO v_actual_movement FROM public.stock_movements WHERE id = v_movement.id;
  SELECT count(*) INTO v_count FROM public.stock_movements;
  IF v_actual_product IS DISTINCT FROM v_product OR v_actual_purchase IS DISTINCT FROM v_purchase
     OR v_actual_movement IS DISTINCT FROM v_movement OR v_count <> 1 THEN
    RAISE EXCEPTION 'Category insertion/archive changed products, purchases or inventory ledger';
  END IF;
  RAISE NOTICE 'BF-068 passed: catalog schema, % rejections, duplicates, active defaults, timestamps, soft archive, no derived data/side effects and RLS', v_rejections;
END;
$$;

ROLLBACK;
