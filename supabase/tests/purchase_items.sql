\set ON_ERROR_STOP on
BEGIN;

-- Local administrative fixtures only, including FK identities; everything rolls back.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_business_id uuid;
  v_purchase public.purchases%ROWTYPE;
  v_actual_purchase public.purchases%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_actual_product public.products%ROWTYPE;
  v_snapshot public.purchase_items%ROWTYPE;
  v_explicit_snapshot public.purchase_items%ROWTYPE;
  v_actual_snapshot public.purchase_items%ROWTYPE;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
  v_rejections integer := 0;
BEGIN
  -- Exact columns exclude business_id, updated_at, sale prices and inventory fields.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'purchase_items') <> 8 THEN
    RAISE EXCEPTION 'Unexpected purchase_items columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid'),
      ('purchase_id', 'uuid'),
      ('product_id', 'uuid'),
      ('product_name_snapshot', 'text'),
      ('quantity', 'int4'),
      ('unit_cost_snapshot', 'numeric'),
      ('line_total', 'numeric'),
      ('created_at', 'timestamptz')
    ) AS columns(column_name, udt_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'purchase_items'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = 'NO' AND c.is_generated = 'NEVER'
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
       AND table_name = 'purchase_items' AND column_name IN ('unit_cost_snapshot', 'line_total')
       AND numeric_precision = 12 AND numeric_scale = 2) <> 2 THEN
    RAISE EXCEPTION 'Acquisition cost and line total must use numeric(12,2)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'purchase_items' AND column_name NOT IN ('id', 'created_at')
              AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'References, snapshots, quantity and line total must be explicit';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.purchase_items'::regclass) <> 7
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.purchase_items'::regclass
                    AND conname = 'purchase_items_pkey' AND contype = 'p'
                    AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') THEN
    RAISE EXCEPTION 'Expected PK, two FKs and four approved CHECKs';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('purchase_items_purchase_id_fkey', 'public.purchases', 'FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT'),
      ('purchase_items_product_id_fkey', 'public.products', 'FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT')
    ) AS foreign_keys(constraint_name, target_table, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.purchase_items'::regclass
                   AND conname = v_case.constraint_name AND contype = 'f'
                   AND confrelid = v_case.target_table::regclass AND confdeltype = 'r'
                   AND pg_get_constraintdef(oid) = v_case.definition) THEN
      RAISE EXCEPTION 'Restrictive FK missing: %', v_case.constraint_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.purchase_items'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'Duplicate purchase/product lines must remain allowed';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'purchase_items') <> 3 THEN
    RAISE EXCEPTION 'Expected PK and two reference indexes';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('purchase_items_purchase_id_idx', '% USING btree (purchase_id)'),
      ('purchase_items_product_id_idx', '% USING btree (product_id)')
    ) AS indexes(index_name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'purchase_items'
                   AND indexname = v_case.index_name AND indexdef LIKE v_case.definition) THEN
      RAISE EXCEPTION 'Reference index missing: %', v_case.index_name;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.purchase_items'::regclass)
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'purchase_items')
        IS DISTINCT FROM ARRAY['purchase_items_select_owners']::text[] THEN
    RAISE EXCEPTION 'Purchase items must have RLS enabled with exactly its BF-078 SELECT policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.purchase_items'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'No snapshot, stock, product cost, purchase total or timestamp trigger is approved';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id);
  INSERT INTO public.businesses (name) VALUES ('Temporary purchase items test') RETURNING id INTO v_business_id;
  INSERT INTO public.purchases (business_id, operation_id, supplier, total, created_by)
  VALUES (v_business_id, gen_random_uuid(), 'Mayorista', 25, v_user_id) RETURNING * INTO v_purchase;
  INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost)
  VALUES (v_business_id, 'Cera', 200, 80) RETURNING * INTO v_product;
  INSERT INTO public.purchase_items (purchase_id, product_id, product_name_snapshot, quantity,
                                     unit_cost_snapshot, line_total)
  VALUES (v_purchase.id, v_product.id, 'Cera', 10, 80, 800) RETURNING * INTO v_snapshot;
  IF v_snapshot.id IS NULL OR v_snapshot.purchase_id IS DISTINCT FROM v_purchase.id
     OR v_snapshot.product_id IS DISTINCT FROM v_product.id
     OR v_snapshot.product_name_snapshot IS DISTINCT FROM 'Cera'
     OR v_snapshot.quantity IS DISTINCT FROM 10 OR v_snapshot.unit_cost_snapshot IS DISTINCT FROM 80
     OR v_snapshot.line_total IS DISTINCT FROM 800
     OR v_snapshot.created_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Explicit historical snapshot, quantity or timestamp defaults failed';
  END IF;
  -- Cost is explicitly supplied and need not match the current catalog cost of 80.
  INSERT INTO public.purchase_items (purchase_id, product_id, product_name_snapshot, quantity,
                                     unit_cost_snapshot, line_total)
  VALUES (v_purchase.id, v_product.id, 'Acquisition snapshot', 5, 120, 600) RETURNING * INTO v_explicit_snapshot;
  IF v_explicit_snapshot.quantity IS DISTINCT FROM 5
     OR v_explicit_snapshot.unit_cost_snapshot IS DISTINCT FROM 120
     OR v_explicit_snapshot.line_total IS DISTINCT FROM 600 THEN
    RAISE EXCEPTION 'Explicit cost and exact line total 120 x 5 = 600 failed';
  END IF;
  -- Duplicate product lines, free acquisition and exact decimal multiplication are valid.
  INSERT INTO public.purchase_items (purchase_id, product_id, product_name_snapshot, quantity,
                                     unit_cost_snapshot, line_total)
  VALUES (v_purchase.id, v_product.id, 'Cera', 10, 80, 800),
         (v_purchase.id, v_product.id, 'Free acquisition', 1, 0, 0),
         (v_purchase.id, v_product.id, 'Decimal acquisition', 3, 0.10, 0.30);
  SELECT * INTO v_actual_product FROM public.products WHERE id = v_product.id;
  SELECT * INTO v_actual_purchase FROM public.purchases WHERE id = v_purchase.id;
  IF v_actual_product IS DISTINCT FROM v_product OR v_actual_purchase IS DISTINCT FROM v_purchase THEN
    RAISE EXCEPTION 'Purchase item inserts changed products or the purchase header';
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('purchase_id = gen_random_uuid()', '23503', 'purchase_items_purchase_id_fkey', NULL),
      ('purchase_id = NULL', '23502', NULL, 'purchase_id'),
      ('product_id = gen_random_uuid()', '23503', 'purchase_items_product_id_fkey', NULL),
      ('product_id = NULL', '23502', NULL, 'product_id'),
      ('product_name_snapshot = NULL', '23502', NULL, 'product_name_snapshot'),
      ('product_name_snapshot = ''''', '23514', 'purchase_items_product_name_snapshot_check', NULL),
      ('product_name_snapshot = ''   ''', '23514', 'purchase_items_product_name_snapshot_check', NULL),
      ('quantity = NULL', '23502', NULL, 'quantity'),
      ('quantity = 0', '23514', NULL, NULL),
      ('quantity = -1', '23514', NULL, NULL),
      ('unit_cost_snapshot = NULL', '23502', NULL, 'unit_cost_snapshot'),
      ('unit_cost_snapshot = -0.01', '23514', NULL, NULL),
      ('unit_cost_snapshot = ''NaN''::numeric', '23514', NULL, NULL),
      ('line_total = NULL', '23502', NULL, 'line_total'),
      ('line_total = -0.01', '23514', 'purchase_items_line_total_check', NULL),
      ('line_total = ''NaN''::numeric', '23514', 'purchase_items_line_total_check', NULL),
      ('line_total = 500', '23514', 'purchase_items_line_total_check', NULL),
      ('unit_cost_snapshot = ''NaN''::numeric, line_total = ''NaN''::numeric', '23514', NULL, NULL),
      ('unit_cost_snapshot = -120, line_total = -600', '23514', NULL, NULL),
      ('created_at = NULL', '23502', NULL, 'created_at')
    ) AS cases(assignments, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.purchase_items SET %s WHERE id = %L', v_case.assignments, v_explicit_snapshot.id);
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
      (format('INSERT INTO public.purchase_items (product_id, product_name_snapshot, quantity, unit_cost_snapshot, line_total) VALUES (%L, ''Missing purchase'', 1, 80, 80)', v_product.id), '23502', NULL, 'purchase_id'),
      (format('INSERT INTO public.purchase_items (purchase_id, product_name_snapshot, quantity, unit_cost_snapshot, line_total) VALUES (%L, ''Missing product'', 1, 80, 80)', v_purchase.id), '23502', NULL, 'product_id'),
      (format('INSERT INTO public.purchase_items (purchase_id, product_id, quantity, unit_cost_snapshot, line_total) VALUES (%L, %L, 1, 80, 80)', v_purchase.id, v_product.id), '23502', NULL, 'product_name_snapshot'),
      (format('INSERT INTO public.purchase_items (purchase_id, product_id, product_name_snapshot, unit_cost_snapshot, line_total) VALUES (%L, %L, ''Missing quantity'', 80, 80)', v_purchase.id, v_product.id), '23502', NULL, 'quantity'),
      (format('INSERT INTO public.purchase_items (purchase_id, product_id, product_name_snapshot, quantity, line_total) VALUES (%L, %L, ''Missing cost'', 1, 80)', v_purchase.id, v_product.id), '23502', NULL, 'unit_cost_snapshot'),
      (format('INSERT INTO public.purchase_items (purchase_id, product_id, product_name_snapshot, quantity, unit_cost_snapshot) VALUES (%L, %L, ''Missing total'', 1, 80)', v_purchase.id, v_product.id), '23502', NULL, 'line_total'),
      (format('DELETE FROM public.purchases WHERE id = %L', v_purchase.id), '23503', 'purchase_items_purchase_id_fkey', NULL),
      (format('DELETE FROM public.products WHERE id = %L', v_product.id), '23503', 'purchase_items_product_id_fkey', NULL)
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

  -- Catalog edits cannot rewrite acquisition snapshots, including explicit costs.
  UPDATE public.products SET name = 'Cera Premium', default_purchase_cost = 100, is_active = false
  WHERE id = v_product.id;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product.id AND name = 'Cera Premium'
                 AND default_purchase_cost = 100 AND NOT is_active) THEN
    RAISE EXCEPTION 'Catalog edit fixture failed';
  END IF;
  SELECT * INTO v_actual_snapshot FROM public.purchase_items WHERE id = v_snapshot.id;
  IF v_actual_snapshot IS DISTINCT FROM v_snapshot THEN
    RAISE EXCEPTION 'Catalog edit rewrote the Cera / 10 / 80 / 800 historical snapshot';
  END IF;
  SELECT * INTO v_actual_snapshot FROM public.purchase_items WHERE id = v_explicit_snapshot.id;
  IF v_actual_snapshot IS DISTINCT FROM v_explicit_snapshot THEN
    RAISE EXCEPTION 'Catalog edit rewrote an explicitly supplied acquisition cost';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.purchase_items;
    IF v_count <> 0 THEN RAISE EXCEPTION '% can read purchase items', v_role; END IF;
    UPDATE public.purchase_items SET product_name_snapshot = 'Forbidden';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can update purchase items', v_role; END IF;
    DELETE FROM public.purchase_items;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can delete purchase items', v_role; END IF;
    BEGIN
      INSERT INTO public.purchase_items (purchase_id, product_id, product_name_snapshot, quantity,
                                         unit_cost_snapshot, line_total)
      VALUES (v_purchase.id, v_product.id, 'Denied', 1, 80, 80);
      RAISE EXCEPTION '% can insert purchase items', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.purchase_items WHERE purchase_id = v_purchase.id;
  IF v_count <> 5 THEN RAISE EXCEPTION 'Duplicate lines were lost or denied writes changed fixtures'; END IF;
  SELECT * INTO v_actual_snapshot FROM public.purchase_items WHERE id = v_snapshot.id;
  IF v_actual_snapshot IS DISTINCT FROM v_snapshot THEN RAISE EXCEPTION 'Denied writes changed historical snapshot'; END IF;
  SELECT * INTO v_actual_snapshot FROM public.purchase_items WHERE id = v_explicit_snapshot.id;
  IF v_actual_snapshot IS DISTINCT FROM v_explicit_snapshot THEN RAISE EXCEPTION 'Denied writes changed explicit cost snapshot'; END IF;
  SELECT * INTO v_actual_purchase FROM public.purchases WHERE id = v_purchase.id;
  IF v_actual_purchase IS DISTINCT FROM v_purchase THEN RAISE EXCEPTION 'Purchase header changed unexpectedly'; END IF;
  RAISE NOTICE 'BF-066 passed: schema, explicit quantity, % constraint rejections, exact line totals, historical snapshots, duplicates, no side effects and RLS', v_rejections;
END;
$$;

ROLLBACK;
