\set ON_ERROR_STOP on
BEGIN;

-- Local administrative fixtures only, including FK identities; everything rolls back.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_business_id uuid;
  v_sale public.sales%ROWTYPE;
  v_actual_sale public.sales%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_actual_product public.products%ROWTYPE;
  v_service_snapshot public.sale_items%ROWTYPE;
  v_product_snapshot public.sale_items%ROWTYPE;
  v_multiple public.sale_items%ROWTYPE;
  v_actual_snapshot public.sale_items%ROWTYPE;
  v_target_id uuid;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
  v_rejections integer := 0;
BEGIN
  -- Exact columns exclude business_id, updated_at, discounts and derived metrics.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sale_items') <> 11 THEN
    RAISE EXCEPTION 'Unexpected sale_items columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('sale_id', 'uuid', 'NO'),
      ('item_type', 'text', 'NO'),
      ('service_id', 'uuid', 'YES'),
      ('product_id', 'uuid', 'YES'),
      ('item_name_snapshot', 'text', 'NO'),
      ('unit_price_snapshot', 'numeric', 'NO'),
      ('quantity', 'int4', 'NO'),
      ('line_total', 'numeric', 'NO'),
      ('unit_cost_snapshot', 'numeric', 'YES'),
      ('created_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'sale_items'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = v_case.is_nullable
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
       AND table_name = 'sale_items' AND column_name IN ('unit_price_snapshot', 'unit_cost_snapshot', 'line_total')
       AND numeric_precision = 12 AND numeric_scale = 2) <> 3 THEN
    RAISE EXCEPTION 'All monetary snapshots must use numeric(12,2)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'sale_items'
              AND column_name IN ('item_type', 'item_name_snapshot', 'unit_price_snapshot', 'unit_cost_snapshot', 'line_total')
              AND (column_default IS NOT NULL OR is_generated <> 'NEVER')) THEN
    RAISE EXCEPTION 'Types, snapshots and gross line totals must be supplied explicitly';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sale_items'::regclass
                 AND conname = 'sale_items_pkey' AND contype = 'p') THEN
    RAISE EXCEPTION 'Sale items PK missing';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('sale_items_sale_id_fkey', 'public.sales'),
      ('sale_items_service_id_fkey', 'public.services'),
      ('sale_items_product_id_fkey', 'public.products')
    ) AS foreign_keys(constraint_name, target_table)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sale_items'::regclass
                   AND conname = v_case.constraint_name AND contype = 'f'
                   AND confrelid = v_case.target_table::regclass AND confdeltype = 'r') THEN
      RAISE EXCEPTION 'Restrictive FK missing: %', v_case.constraint_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sale_items'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'Duplicate sale/service and sale/product pairs must remain allowed';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sale_items') <> 4 THEN
    RAISE EXCEPTION 'Expected PK and three reference indexes';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('sale_items_sale_id_idx', '% USING btree (sale_id)'),
      ('sale_items_service_id_idx', '% USING btree (service_id)'),
      ('sale_items_product_id_idx', '% USING btree (product_id)')
    ) AS indexes(index_name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'sale_items'
                   AND indexname = v_case.index_name AND indexdef LIKE v_case.definition) THEN
      RAISE EXCEPTION 'Reference index missing: %', v_case.index_name;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sale_items'::regclass)
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'sale_items')
        IS DISTINCT FROM ARRAY['sale_items_select_authorized']::text[] THEN
    RAISE EXCEPTION 'Sale items must have RLS enabled with exactly its BF-077 SELECT policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.sale_items'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'No snapshot, stock, sale totals or updated_at trigger is approved';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id);
  INSERT INTO public.businesses (name) VALUES ('Temporary sale items test') RETURNING id INTO v_business_id;
  INSERT INTO public.sales (business_id, operation_id, status, subtotal, discount, total, created_by)
  VALUES (v_business_id, gen_random_uuid(), 'COMPLETED', 900, 20, 880, v_user_id) RETURNING * INTO v_sale;
  INSERT INTO public.services (business_id, name, price, duration_minutes)
  VALUES (v_business_id, 'Corte', 100, 30) RETURNING * INTO v_service;
  INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost)
  VALUES (v_business_id, 'Cera', 200, 80) RETURNING * INTO v_product;
  -- Quantity is omitted to exercise DEFAULT 1 for each item type.
  INSERT INTO public.sale_items (sale_id, item_type, service_id, item_name_snapshot, unit_price_snapshot, line_total)
  VALUES (v_sale.id, 'SERVICE', v_service.id, 'Corte', 100, 100) RETURNING * INTO v_service_snapshot;
  INSERT INTO public.sale_items (sale_id, item_type, product_id, item_name_snapshot, unit_price_snapshot,
                                 unit_cost_snapshot, line_total)
  VALUES (v_sale.id, 'PRODUCT', v_product.id, 'Cera', 200, 80, 200) RETURNING * INTO v_product_snapshot;
  IF v_service_snapshot.id IS NULL OR v_product_snapshot.id IS NULL
     OR v_service_snapshot.quantity IS DISTINCT FROM 1 OR v_product_snapshot.quantity IS DISTINCT FROM 1
     OR v_service_snapshot.product_id IS NOT NULL OR v_service_snapshot.unit_cost_snapshot IS NOT NULL
     OR v_product_snapshot.service_id IS NOT NULL OR v_product_snapshot.unit_cost_snapshot IS DISTINCT FROM 80
     OR v_service_snapshot.created_at IS DISTINCT FROM transaction_timestamp()
     OR v_product_snapshot.created_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Service/product snapshots, quantity, cost or timestamp defaults failed';
  END IF;
  INSERT INTO public.sale_items (sale_id, item_type, service_id, item_name_snapshot,
                                 unit_price_snapshot, quantity, line_total)
  VALUES (v_sale.id, 'SERVICE', v_service.id, 'Explicit price', 150, 2, 300) RETURNING * INTO v_multiple;
  IF v_multiple.quantity <> 2 OR v_multiple.unit_price_snapshot IS DISTINCT FROM 150
     OR v_multiple.line_total IS DISTINCT FROM 300 THEN
    RAISE EXCEPTION 'Explicit snapshot and exact line total 150 x 2 = 300 failed';
  END IF;
  -- Repeated catalog references and free items are valid for both item types.
  INSERT INTO public.sale_items (sale_id, item_type, service_id, item_name_snapshot, unit_price_snapshot, line_total)
  VALUES (v_sale.id, 'SERVICE', v_service.id, 'Corte', 100, 100),
         (v_sale.id, 'SERVICE', v_service.id, 'Free service', 0, 0);
  INSERT INTO public.sale_items (sale_id, item_type, product_id, item_name_snapshot, unit_price_snapshot,
                                 unit_cost_snapshot, line_total)
  VALUES (v_sale.id, 'PRODUCT', v_product.id, 'Cera', 200, 80, 200),
         (v_sale.id, 'PRODUCT', v_product.id, 'Free product', 0, 0, 0);
  SELECT * INTO v_actual_sale FROM public.sales WHERE id = v_sale.id;
  SELECT * INTO v_actual_product FROM public.products WHERE id = v_product.id;
  IF v_actual_sale IS DISTINCT FROM v_sale OR v_actual_product IS DISTINCT FROM v_product THEN
    RAISE EXCEPTION 'Inserting sale lines must not change sale totals or catalog products';
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('SERVICE', 'sale_id = gen_random_uuid()', '23503', 'sale_items_sale_id_fkey', NULL),
      ('SERVICE', 'sale_id = NULL', '23502', NULL, 'sale_id'),
      ('SERVICE', 'service_id = gen_random_uuid()', '23503', 'sale_items_service_id_fkey', NULL),
      ('PRODUCT', 'product_id = gen_random_uuid()', '23503', 'sale_items_product_id_fkey', NULL),
      ('SERVICE', 'item_type = NULL', '23502', NULL, 'item_type'),
      ('SERVICE', 'item_type = ''OTHER''', '23514', NULL, NULL),
      ('SERVICE', 'item_type = ''PRODUCT''', '23514', NULL, NULL),
      ('PRODUCT', 'item_type = ''SERVICE''', '23514', NULL, NULL),
      ('SERVICE', format('product_id = %L', v_product.id), '23514', 'sale_items_item_reference_check', NULL),
      ('PRODUCT', format('service_id = %L', v_service.id), '23514', 'sale_items_item_reference_check', NULL),
      ('SERVICE', 'service_id = NULL', '23514', 'sale_items_item_reference_check', NULL),
      ('PRODUCT', 'product_id = NULL', '23514', 'sale_items_item_reference_check', NULL),
      ('SERVICE', format('service_id = NULL, product_id = %L', v_product.id), '23514', 'sale_items_item_reference_check', NULL),
      ('PRODUCT', format('product_id = NULL, service_id = %L', v_service.id), '23514', 'sale_items_item_reference_check', NULL),
      ('PRODUCT', 'unit_cost_snapshot = NULL', '23514', 'sale_items_unit_cost_snapshot_check', NULL),
      ('SERVICE', 'unit_cost_snapshot = 0', '23514', 'sale_items_unit_cost_snapshot_check', NULL),
      ('PRODUCT', 'unit_cost_snapshot = -0.01', '23514', 'sale_items_unit_cost_snapshot_check', NULL),
      ('PRODUCT', 'unit_cost_snapshot = ''NaN''::numeric', '23514', 'sale_items_unit_cost_snapshot_check', NULL),
      ('SERVICE', 'item_name_snapshot = NULL', '23502', NULL, 'item_name_snapshot'),
      ('SERVICE', 'item_name_snapshot = ''''', '23514', 'sale_items_item_name_snapshot_check', NULL),
      ('SERVICE', 'item_name_snapshot = ''   ''', '23514', 'sale_items_item_name_snapshot_check', NULL),
      ('SERVICE', 'unit_price_snapshot = NULL', '23502', NULL, 'unit_price_snapshot'),
      ('SERVICE', 'unit_price_snapshot = -0.01', '23514', NULL, NULL),
      ('SERVICE', 'unit_price_snapshot = ''NaN''::numeric', '23514', NULL, NULL),
      ('SERVICE', 'quantity = NULL', '23502', NULL, 'quantity'),
      ('SERVICE', 'quantity = 0', '23514', NULL, NULL),
      ('SERVICE', 'quantity = -1', '23514', NULL, NULL),
      ('SERVICE', 'line_total = NULL', '23502', NULL, 'line_total'),
      ('SERVICE', 'line_total = -0.01', '23514', 'sale_items_line_total_check', NULL),
      ('SERVICE', 'line_total = ''NaN''::numeric', '23514', 'sale_items_line_total_check', NULL),
      ('MULTIPLE', 'line_total = 250', '23514', 'sale_items_line_total_check', NULL),
      ('SERVICE', 'unit_price_snapshot = ''NaN''::numeric, line_total = ''NaN''::numeric', '23514', NULL, NULL),
      ('SERVICE', 'created_at = NULL', '23502', NULL, 'created_at')
    ) AS cases(source_type, assignments, expected_state, expected_constraint, expected_column)
  LOOP
    v_target_id := CASE v_case.source_type WHEN 'PRODUCT' THEN v_product_snapshot.id
                     WHEN 'MULTIPLE' THEN v_multiple.id ELSE v_service_snapshot.id END;
    BEGIN
      EXECUTE format('UPDATE public.sale_items SET %s WHERE id = %L', v_case.assignments, v_target_id);
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
      (format('INSERT INTO public.sale_items (sale_id, service_id, item_name_snapshot, unit_price_snapshot, line_total) VALUES (%L, %L, ''Missing type'', 100, 100)', v_sale.id, v_service.id), '23502', NULL, 'item_type'),
      (format('INSERT INTO public.sale_items (sale_id, item_type, service_id, unit_price_snapshot, line_total) VALUES (%L, ''SERVICE'', %L, 100, 100)', v_sale.id, v_service.id), '23502', NULL, 'item_name_snapshot'),
      (format('INSERT INTO public.sale_items (sale_id, item_type, service_id, item_name_snapshot, line_total) VALUES (%L, ''SERVICE'', %L, ''Missing price'', 100)', v_sale.id, v_service.id), '23502', NULL, 'unit_price_snapshot'),
      (format('INSERT INTO public.sale_items (sale_id, item_type, service_id, item_name_snapshot, unit_price_snapshot) VALUES (%L, ''SERVICE'', %L, ''Missing total'', 100)', v_sale.id, v_service.id), '23502', NULL, 'line_total'),
      (format('INSERT INTO public.sale_items (sale_id, item_type, product_id, item_name_snapshot, unit_price_snapshot, line_total) VALUES (%L, ''PRODUCT'', %L, ''Missing cost'', 200, 200)', v_sale.id, v_product.id), '23514', 'sale_items_unit_cost_snapshot_check', NULL),
      (format('DELETE FROM public.sales WHERE id = %L', v_sale.id), '23503', 'sale_items_sale_id_fkey', NULL),
      (format('DELETE FROM public.services WHERE id = %L', v_service.id), '23503', 'sale_items_service_id_fkey', NULL),
      (format('DELETE FROM public.products WHERE id = %L', v_product.id), '23503', 'sale_items_product_id_fkey', NULL)
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

  -- Catalog edits and archive must not rewrite any historical snapshot or cost.
  UPDATE public.services SET name = 'Corte Premium', price = 150, is_active = false WHERE id = v_service.id;
  UPDATE public.products SET name = 'Cera Premium', sale_price = 250, default_purchase_cost = 100,
                             is_active = false WHERE id = v_product.id;
  IF NOT EXISTS (SELECT 1 FROM public.services WHERE id = v_service.id AND name = 'Corte Premium'
                 AND price = 150 AND NOT is_active)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product.id AND name = 'Cera Premium'
                    AND sale_price = 250 AND default_purchase_cost = 100 AND NOT is_active) THEN
    RAISE EXCEPTION 'Catalog edit fixtures failed';
  END IF;
  SELECT * INTO v_actual_snapshot FROM public.sale_items WHERE id = v_service_snapshot.id;
  IF v_actual_snapshot IS DISTINCT FROM v_service_snapshot THEN
    RAISE EXCEPTION 'Service catalog edit rewrote the Corte / 100 historical snapshot';
  END IF;
  SELECT * INTO v_actual_snapshot FROM public.sale_items WHERE id = v_product_snapshot.id;
  IF v_actual_snapshot IS DISTINCT FROM v_product_snapshot THEN
    RAISE EXCEPTION 'Product catalog edit rewrote the Cera / 200 / 80 historical snapshot';
  END IF;
  SELECT * INTO v_actual_snapshot FROM public.sale_items WHERE id = v_multiple.id;
  IF v_actual_snapshot IS DISTINCT FROM v_multiple THEN
    RAISE EXCEPTION 'Catalog edit rewrote an explicitly supplied price snapshot';
  END IF;
  SELECT * INTO v_actual_sale FROM public.sales WHERE id = v_sale.id;
  IF v_actual_sale IS DISTINCT FROM v_sale THEN RAISE EXCEPTION 'Sale header was changed'; END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.sale_items;
    IF v_count <> 0 THEN RAISE EXCEPTION '% can read sale items', v_role; END IF;
    UPDATE public.sale_items SET item_name_snapshot = 'Forbidden';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can update sale items', v_role; END IF;
    DELETE FROM public.sale_items;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can delete sale items', v_role; END IF;
    BEGIN
      INSERT INTO public.sale_items (sale_id, item_type, service_id, item_name_snapshot, unit_price_snapshot, line_total)
      VALUES (v_sale.id, 'SERVICE', v_service.id, 'Denied', 100, 100);
      RAISE EXCEPTION '% can insert sale items', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.sale_items WHERE sale_id = v_sale.id;
  IF v_count <> 7 THEN RAISE EXCEPTION 'Duplicate lines were lost or denied writes changed fixtures'; END IF;
  SELECT * INTO v_actual_snapshot FROM public.sale_items WHERE id = v_service_snapshot.id;
  IF v_actual_snapshot IS DISTINCT FROM v_service_snapshot THEN RAISE EXCEPTION 'Denied service snapshot writes succeeded'; END IF;
  SELECT * INTO v_actual_snapshot FROM public.sale_items WHERE id = v_product_snapshot.id;
  IF v_actual_snapshot IS DISTINCT FROM v_product_snapshot THEN RAISE EXCEPTION 'Denied product snapshot writes succeeded'; END IF;
  RAISE NOTICE 'BF-063 passed: schema, defaults, % constraint rejections, XOR, costs, line totals, historical snapshots, duplicates and RLS', v_rejections;
END;
$$;

ROLLBACK;
