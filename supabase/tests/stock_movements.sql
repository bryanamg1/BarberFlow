\set ON_ERROR_STOP on
BEGIN;

-- Administrative local fixtures only; no application data survives the rollback.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_business_id uuid;
  v_product public.products%ROWTYPE;
  v_actual_product public.products%ROWTYPE;
  v_other_product_id uuid;
  v_sale public.sales%ROWTYPE;
  v_actual_sale public.sales%ROWTYPE;
  v_purchase public.purchases%ROWTYPE;
  v_actual_purchase public.purchases%ROWTYPE;
  v_first public.stock_movements%ROWTYPE;
  v_movement public.stock_movements%ROWTYPE;
  v_actual_movement public.stock_movements%ROWTYPE;
  v_history_ids uuid[];
  v_actual_ids uuid[];
  v_ledger_before jsonb;
  v_ledger_after jsonb;
  v_role text;
  v_count bigint;
  v_stock bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
  v_rejections integer := 0;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'stock_movements') <> 12 THEN
    RAISE EXCEPTION 'Unexpected stock_movements columns';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'), ('business_id', 'uuid', 'NO'), ('product_id', 'uuid', 'NO'),
      ('type', 'text', 'NO'), ('quantity_delta', 'int4', 'NO'), ('unit_cost', 'numeric', 'YES'),
      ('reference_type', 'text', 'YES'), ('reference_id', 'uuid', 'YES'), ('notes', 'text', 'YES'),
      ('occurred_at', 'timestamptz', 'NO'), ('created_by', 'uuid', 'NO'), ('created_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                   WHERE c.table_schema = 'public' AND c.table_name = 'stock_movements'
                     AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
                     AND c.is_nullable = v_case.is_nullable AND c.is_generated = 'NEVER') THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'stock_movements' AND column_name = 'unit_cost'
                  AND numeric_precision = 12 AND numeric_scale = 2) THEN
    RAISE EXCEPTION 'Optional cost must use numeric(12,2)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'stock_movements' AND column_name NOT IN ('id', 'occurred_at', 'created_at')
              AND column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'No implicit type, quantity, actor, references or cost is approved';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name IN ('products', 'stock_movements')
              AND column_name IN ('current_stock', 'stock', 'stock_before', 'stock_after', 'balance',
                                  'running_balance', 'quantity_on_hand', 'available_stock')) THEN
    RAISE EXCEPTION 'Stock must derive from the ledger, never a persisted balance';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.stock_movements'::regclass) <> 7
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.stock_movements'::regclass
                    AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.stock_movements'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'Expected PK, three restrictive FKs, three CHECKs and no extra uniqueness';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('stock_movements_business_id_fkey', 'FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT'),
      ('stock_movements_product_id_fkey', 'FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT'),
      ('stock_movements_created_by_fkey', 'FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT')
    ) AS foreign_keys(constraint_name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.stock_movements'::regclass
                   AND conname = v_case.constraint_name AND contype = 'f' AND confdeltype = 'r'
                   AND pg_get_constraintdef(oid) = v_case.definition) THEN
      RAISE EXCEPTION 'Restrictive FK missing: %', v_case.constraint_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'stock_movements') <> 3 THEN
    RAISE EXCEPTION 'Expected PK, business/product event history and product event history indexes';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('stock_movements_business_id_product_id_occurred_at_idx', '% USING btree (business_id, product_id, occurred_at)'),
      ('stock_movements_product_id_occurred_at_idx', '% USING btree (product_id, occurred_at)')
    ) AS indexes(index_name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'stock_movements'
                   AND indexname = v_case.index_name AND indexdef LIKE v_case.definition) THEN
      RAISE EXCEPTION 'History index missing: %', v_case.index_name;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.stock_movements'::regclass)
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'stock_movements') IS DISTINCT FROM
        ARRAY['stock_movements_select_members']::text[] THEN
    RAISE EXCEPTION 'Ledger must have RLS enabled with exactly the approved BF-076 policies';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.stock_movements'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.stock_movements'::regclass
                    AND tgname = 'stock_movements_append_only' AND tgenabled = 'O'
                    AND tgfoid = 'public.prevent_stock_movement_changes()'::regprocedure
                    AND pg_get_triggerdef(oid) LIKE '% BEFORE DELETE OR UPDATE ON %'
                    AND pg_get_triggerdef(oid) LIKE '% FOR EACH ROW %') THEN
    RAISE EXCEPTION 'Only the approved BEFORE UPDATE/DELETE append-only trigger is allowed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.prevent_stock_movement_changes()'::regprocedure
                  AND prorettype = 'trigger'::regtype AND NOT prosecdef AND proconfig = ARRAY['search_path=""'])
     OR has_function_privilege('anon', 'public.prevent_stock_movement_changes()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.prevent_stock_movement_changes()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Append-only helper must remain an invoker trigger with no client execution';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_id);
  INSERT INTO public.businesses (name) VALUES ('Temporary ledger test') RETURNING id INTO v_business_id;
  INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost, minimum_stock)
  VALUES (v_business_id, 'Cera', 200, 80, 3) RETURNING * INTO v_product;
  INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost)
  VALUES (v_business_id, 'Other ledger fixture', 10, 0) RETURNING id INTO v_other_product_id;
  INSERT INTO public.sales (business_id, operation_id, status, subtotal, total, created_by)
  VALUES (v_business_id, gen_random_uuid(), 'COMPLETED', 400, 400, v_user_id) RETURNING * INTO v_sale;
  INSERT INTO public.purchases (business_id, operation_id, supplier, status, total, created_by)
  VALUES (v_business_id, gen_random_uuid(), 'Mayorista', 'COMPLETED', 800, v_user_id) RETURNING * INTO v_purchase;
  INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, unit_cost,
                                      reference_type, reference_id, created_by)
  VALUES (v_business_id, v_product.id, 'PURCHASE', 10, 80, 'PURCHASE', v_purchase.id, v_user_id)
  RETURNING * INTO v_first;
  IF v_first.id IS NULL OR v_first.quantity_delta IS DISTINCT FROM 10 OR v_first.unit_cost IS DISTINCT FROM 80
     OR v_first.reference_type IS DISTINCT FROM 'PURCHASE' OR v_first.reference_id IS DISTINCT FROM v_purchase.id
     OR v_first.notes IS NOT NULL OR v_first.created_by IS DISTINCT FROM v_user_id
     OR v_first.occurred_at IS DISTINCT FROM transaction_timestamp()
     OR v_first.created_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Ledger defaults, optional notes, source reference or acquisition cost failed';
  END IF;
  v_history_ids := ARRAY[v_first.id];
  FOR v_case IN
    SELECT * FROM (VALUES
      ('SALE', -2, 'SALE', v_sale.id, NULL, 2),
      ('LOSS', -1, NULL, NULL, 'Damaged item', 3),
      ('ADJUSTMENT', 3, NULL, NULL, NULL, 4),
      ('RETURN', 2, 'SALE', v_sale.id, 'Compensates the sale', 5),
      ('ADJUSTMENT', -2, NULL, NULL, 'Manual correction', 6)
    ) AS movements(type, delta, reference_type, reference_id, notes, sequence)
  LOOP
    INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta,
                                        reference_type, reference_id, notes, occurred_at, created_by, created_at)
    VALUES (v_business_id, v_product.id, v_case.type, v_case.delta, v_case.reference_type, v_case.reference_id,
            v_case.notes, v_first.occurred_at + v_case.sequence * interval '1 hour',
            v_user_id, v_first.created_at + v_case.sequence * interval '1 hour')
    RETURNING * INTO v_movement;
    IF v_movement.unit_cost IS NOT NULL OR v_movement.quantity_delta IS DISTINCT FROM v_case.delta
       OR v_movement.type IS DISTINCT FROM v_case.type
       OR v_movement.reference_type IS DISTINCT FROM v_case.reference_type
       OR v_movement.reference_id IS DISTINCT FROM v_case.reference_id
       OR v_movement.notes IS DISTINCT FROM v_case.notes
       OR v_movement.created_at IS DISTINCT FROM v_movement.occurred_at THEN
      RAISE EXCEPTION 'Movement type, signed quantity, optional fields or explicit timestamps failed';
    END IF;
    v_history_ids := array_append(v_history_ids, v_movement.id);
    IF v_case.sequence = 4 THEN
      SELECT sum(quantity_delta) INTO v_stock FROM public.stock_movements WHERE product_id = v_product.id;
      IF v_stock IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'Ledger +10 -2 -1 +3 must equal 10'; END IF;
    END IF;
  END LOOP;
  SELECT sum(quantity_delta), count(*) INTO v_stock, v_count FROM public.stock_movements WHERE product_id = v_product.id;
  IF v_stock IS DISTINCT FROM 10 OR v_count <> 6 THEN RAISE EXCEPTION 'Return/correction ledger failed'; END IF;
  SELECT array_agg(id ORDER BY occurred_at) INTO v_actual_ids FROM public.stock_movements WHERE product_id = v_product.id;
  IF v_actual_ids IS DISTINCT FROM v_history_ids THEN RAISE EXCEPTION 'Event history order failed'; END IF;
  SELECT array_agg(id ORDER BY created_at) INTO v_actual_ids FROM public.stock_movements WHERE product_id = v_product.id;
  IF v_actual_ids IS DISTINCT FROM v_history_ids THEN RAISE EXCEPTION 'Audit history order failed'; END IF;
  SELECT * INTO v_actual_movement FROM public.stock_movements WHERE id = v_first.id;
  IF v_actual_movement IS DISTINCT FROM v_first THEN RAISE EXCEPTION 'Later inserts rewrote the initial movement'; END IF;

  -- No type-specific sign, reference pairing, reference enum or source FK is approved here.
  FOR v_case IN SELECT unnest(ARRAY['PURCHASE', 'SALE', 'LOSS', 'ADJUSTMENT', 'RETURN']) AS type LOOP
    INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, unit_cost,
                                        reference_type, created_by)
    VALUES (v_business_id, v_other_product_id, v_case.type, 1, 0, 'Explicit custom source', v_user_id),
           (v_business_id, v_other_product_id, v_case.type, -1, NULL, NULL, v_user_id);
  END LOOP;
  INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, reference_id, created_by)
  VALUES (v_business_id, v_other_product_id, 'ADJUSTMENT', 1, gen_random_uuid(), v_user_id);
  -- Aggregate no-negative-stock enforcement belongs to future transactional workflows.
  INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, created_by)
  VALUES (v_business_id, v_other_product_id, 'LOSS', -2, v_user_id);
  SELECT sum(quantity_delta) INTO v_stock FROM public.stock_movements WHERE product_id = v_other_product_id;
  IF v_stock IS DISTINCT FROM -1 THEN RAISE EXCEPTION 'Unexpected aggregate stock enforcement'; END IF;

  -- Invalid INSERTs test constraints without trying to mutate the append-only ledger.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('gen_random_uuid()', '%PRODUCT%', '''ADJUSTMENT''', '1', '0', '%USER%', 'now()', 'now()', '23503', 'stock_movements_business_id_fkey', NULL),
      ('NULL', '%PRODUCT%', '''ADJUSTMENT''', '1', '0', '%USER%', 'now()', 'now()', '23502', NULL, 'business_id'),
      ('%BUSINESS%', 'gen_random_uuid()', '''ADJUSTMENT''', '1', '0', '%USER%', 'now()', 'now()', '23503', 'stock_movements_product_id_fkey', NULL),
      ('%BUSINESS%', 'NULL', '''ADJUSTMENT''', '1', '0', '%USER%', 'now()', 'now()', '23502', NULL, 'product_id'),
      ('%BUSINESS%', '%PRODUCT%', 'NULL', '1', '0', '%USER%', 'now()', 'now()', '23502', NULL, 'type'),
      ('%BUSINESS%', '%PRODUCT%', '''OTHER''', '1', '0', '%USER%', 'now()', 'now()', '23514', 'stock_movements_type_check', NULL),
      ('%BUSINESS%', '%PRODUCT%', '''ADJUSTMENT''', 'NULL', '0', '%USER%', 'now()', 'now()', '23502', NULL, 'quantity_delta'),
      ('%BUSINESS%', '%PRODUCT%', '''ADJUSTMENT''', '0', '0', '%USER%', 'now()', 'now()', '23514', 'stock_movements_quantity_delta_check', NULL),
      ('%BUSINESS%', '%PRODUCT%', '''ADJUSTMENT''', '1', '-0.01', '%USER%', 'now()', 'now()', '23514', 'stock_movements_unit_cost_check', NULL),
      ('%BUSINESS%', '%PRODUCT%', '''ADJUSTMENT''', '1', '''NaN''::numeric', '%USER%', 'now()', 'now()', '23514', 'stock_movements_unit_cost_check', NULL),
      ('%BUSINESS%', '%PRODUCT%', '''ADJUSTMENT''', '1', '0', 'gen_random_uuid()', 'now()', 'now()', '23503', 'stock_movements_created_by_fkey', NULL),
      ('%BUSINESS%', '%PRODUCT%', '''ADJUSTMENT''', '1', '0', 'NULL', 'now()', 'now()', '23502', NULL, 'created_by'),
      ('%BUSINESS%', '%PRODUCT%', '''ADJUSTMENT''', '1', '0', '%USER%', 'NULL', 'now()', '23502', NULL, 'occurred_at'),
      ('%BUSINESS%', '%PRODUCT%', '''ADJUSTMENT''', '1', '0', '%USER%', 'now()', 'NULL', '23502', NULL, 'created_at')
    ) AS cases(business_value, product_value, type_value, delta_value, cost_value, actor_value,
               occurred_value, created_value, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      EXECUTE format('INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, unit_cost, created_by, occurred_at, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
        replace(v_case.business_value, '%BUSINESS%', quote_literal(v_business_id)),
        replace(v_case.product_value, '%PRODUCT%', quote_literal(v_product.id)), v_case.type_value,
        v_case.delta_value, v_case.cost_value, replace(v_case.actor_value, '%USER%', quote_literal(v_user_id)),
        v_case.occurred_value, v_case.created_value);
      RAISE EXCEPTION 'Expected invalid movement INSERT to fail';
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
      (format('INSERT INTO public.stock_movements (product_id, type, quantity_delta, created_by) VALUES (%L, ''ADJUSTMENT'', 1, %L)', v_product.id, v_user_id), '23502', NULL, 'business_id'),
      (format('INSERT INTO public.stock_movements (business_id, type, quantity_delta, created_by) VALUES (%L, ''ADJUSTMENT'', 1, %L)', v_business_id, v_user_id), '23502', NULL, 'product_id'),
      (format('INSERT INTO public.stock_movements (business_id, product_id, quantity_delta, created_by) VALUES (%L, %L, 1, %L)', v_business_id, v_product.id, v_user_id), '23502', NULL, 'type'),
      (format('INSERT INTO public.stock_movements (business_id, product_id, type, created_by) VALUES (%L, %L, ''ADJUSTMENT'', %L)', v_business_id, v_product.id, v_user_id), '23502', NULL, 'quantity_delta'),
      (format('INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta) VALUES (%L, %L, ''ADJUSTMENT'', 1)', v_business_id, v_product.id), '23502', NULL, 'created_by'),
      (format('DELETE FROM public.products WHERE id = %L', v_product.id), '23503', 'stock_movements_product_id_fkey', NULL),
      (format('DELETE FROM public.businesses WHERE id = %L', v_business_id), '23503', NULL, NULL),
      (format('DELETE FROM auth.users WHERE id = %L', v_user_id), '23503', NULL, NULL),
      (format('UPDATE public.stock_movements SET notes = ''Forbidden'' WHERE id = %L', v_first.id), '55000', NULL, NULL),
      (format('DELETE FROM public.stock_movements WHERE id = %L', v_first.id), '55000', NULL, NULL),
      ('UPDATE public.stock_movements SET quantity_delta = quantity_delta', '55000', NULL, NULL),
      ('DELETE FROM public.stock_movements', '55000', NULL, NULL)
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

  -- Bypassing RLS does not bypass the approved append-only trigger.
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.stock_movements SET notes = 'Forbidden privileged update' WHERE id = v_first.id;
    RAISE EXCEPTION 'service_role can update the ledger';
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejections := v_rejections + 1;
  END;
  BEGIN
    DELETE FROM public.stock_movements WHERE id = v_first.id;
    RAISE EXCEPTION 'service_role can delete from the ledger';
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejections := v_rejections + 1;
  END;
  RESET ROLE;

  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO v_ledger_before FROM public.stock_movements m;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.stock_movements;
    IF v_count <> 0 THEN RAISE EXCEPTION '% can read stock movements', v_role; END IF;
    UPDATE public.stock_movements SET notes = 'Forbidden';
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can update stock movements', v_role; END IF;
    DELETE FROM public.stock_movements;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can delete stock movements', v_role; END IF;
    BEGIN
      INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, created_by)
      VALUES (v_business_id, v_product.id, 'ADJUSTMENT', 1, v_user_id);
      RAISE EXCEPTION '% can insert stock movements', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO v_ledger_after FROM public.stock_movements m;
  SELECT * INTO v_actual_product FROM public.products WHERE id = v_product.id;
  SELECT * INTO v_actual_sale FROM public.sales WHERE id = v_sale.id;
  SELECT * INTO v_actual_purchase FROM public.purchases WHERE id = v_purchase.id;
  SELECT * INTO v_actual_movement FROM public.stock_movements WHERE id = v_first.id;
  IF v_ledger_after IS DISTINCT FROM v_ledger_before OR v_actual_movement IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'Rejected mutations changed ledger history';
  END IF;
  IF v_actual_product IS DISTINCT FROM v_product OR v_actual_sale IS DISTINCT FROM v_sale
     OR v_actual_purchase IS DISTINCT FROM v_purchase THEN
    RAISE EXCEPTION 'Ledger inserts changed product, sale or purchase fields';
  END IF;
  RAISE NOTICE 'BF-067 passed: schema, % rejections, five types, signed ledger SUM=10, optional references/cost, ordered history, append-only, no side effects and RLS', v_rejections;
END;
$$;

ROLLBACK;
