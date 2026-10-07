\set ON_ERROR_STOP on
BEGIN;

-- Local administrative fixtures only; every change is rolled back.
DO $$
DECLARE
  v_business_id uuid;
  v_other_business_id uuid;
  v_category_id uuid;
  v_default_product public.products%ROWTYPE;
  v_full_product public.products%ROWTYPE;
  v_updated_product public.products%ROWTYPE;
  v_role text;
  v_count bigint;
  v_affected bigint;
  v_state text;
  v_constraint text;
  v_column text;
  v_case record;
  v_rejections integer := 0;
BEGIN
  -- Exact columns also exclude snapshots, currency and any other stock aliases.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products') <> 12 THEN
    RAISE EXCEPTION 'Unexpected products columns';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'products'
               AND column_name IN ('current_stock', 'stock', 'quantity_on_hand',
                                   'available_stock', 'inventory_quantity')) THEN
    RAISE EXCEPTION 'ADR-005 forbids storing current stock in products';
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('id', 'uuid', 'NO'),
      ('business_id', 'uuid', 'NO'),
      ('category_id', 'uuid', 'YES'),
      ('name', 'text', 'NO'),
      ('description', 'text', 'YES'),
      ('sku', 'text', 'YES'),
      ('sale_price', 'numeric', 'NO'),
      ('default_purchase_cost', 'numeric', 'NO'),
      ('minimum_stock', 'int4', 'NO'),
      ('is_active', 'bool', 'NO'),
      ('created_at', 'timestamptz', 'NO'),
      ('updated_at', 'timestamptz', 'NO')
    ) AS columns(column_name, udt_name, is_nullable)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'products'
        AND c.column_name = v_case.column_name AND c.udt_name = v_case.udt_name
        AND c.is_nullable = v_case.is_nullable
    ) THEN
      RAISE EXCEPTION 'Type/nullability mismatch for %', v_case.column_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
        AND column_name IN ('sale_price', 'default_purchase_cost')
        AND numeric_precision = 12 AND numeric_scale = 2 AND column_default IS NULL) <> 2 THEN
    RAISE EXCEPTION 'Prices and costs must be numeric(12,2) without defaults';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.products'::regclass
                 AND conname = 'products_pkey' AND contype = 'p')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.products'::regclass
                    AND conname = 'products_business_id_fkey' AND contype = 'f'
                    AND confrelid = 'public.businesses'::regclass AND confdeltype = 'r')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.products'::regclass
                    AND conname = 'products_category_id_fkey' AND contype = 'f'
                    AND confrelid = 'public.product_categories'::regclass AND confdeltype = 'r') THEN
    RAISE EXCEPTION 'Products PK or restrictive business/category FK missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.products'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'Product names and SKUs must not have uniqueness constraints';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'products') <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'products'
                    AND indexname = 'products_business_id_is_active_idx'
                    AND indexdef LIKE '% USING btree (business_id, is_active)')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'products'
                    AND indexname = 'products_category_id_idx'
                    AND indexdef LIKE '% USING btree (category_id)') THEN
    RAISE EXCEPTION 'Expected PK, business/active and category indexes only';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.products'::regclass)
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'products') IS DISTINCT FROM
        ARRAY['products_insert_owners', 'products_select_members', 'products_update_owners']::text[] THEN
    RAISE EXCEPTION 'Products must have RLS enabled with exactly the approved BF-076 policies';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.products'::regclass AND NOT tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.products'::regclass
                    AND tgname = 'products_set_updated_at'
                    AND tgfoid = 'public.set_updated_at()'::regprocedure AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Products must reuse only the existing updated_at utility';
  END IF;

  INSERT INTO public.businesses (name) VALUES ('Temporary products test') RETURNING id INTO v_business_id;
  INSERT INTO public.businesses (name) VALUES ('Other temporary products test') RETURNING id INTO v_other_business_id;
  INSERT INTO public.product_categories (business_id, name)
  VALUES (v_business_id, 'Temporary category') RETURNING id INTO v_category_id;
  INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost)
  VALUES (v_business_id, 'Shared product', 0, 0) RETURNING * INTO v_default_product;
  IF v_default_product.id IS NULL OR v_default_product.is_active IS DISTINCT FROM true
     OR v_default_product.minimum_stock IS DISTINCT FROM 0
     OR v_default_product.category_id IS NOT NULL OR v_default_product.description IS NOT NULL
     OR v_default_product.sku IS NOT NULL OR v_default_product.sale_price IS DISTINCT FROM 0
     OR v_default_product.default_purchase_cost IS DISTINCT FROM 0
     OR v_default_product.created_at IS DISTINCT FROM transaction_timestamp()
     OR v_default_product.updated_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION 'Product defaults, nullable category/details or zero prices failed';
  END IF;
  INSERT INTO public.products
    (business_id, category_id, name, description, sku, sale_price, default_purchase_cost,
     minimum_stock, created_at, updated_at)
  VALUES (v_business_id, v_category_id, 'Shared product', 'Catalog description', 'SHARED-SKU',
          12.34, 5.67, 5, '1999-01-01T00:00:00Z', '2000-01-01T00:00:00Z')
  RETURNING * INTO v_full_product;
  IF v_full_product.category_id IS DISTINCT FROM v_category_id
     OR v_full_product.description IS DISTINCT FROM 'Catalog description'
     OR v_full_product.sku IS DISTINCT FROM 'SHARED-SKU'
     OR v_full_product.sale_price IS DISTINCT FROM 12.34
     OR v_full_product.default_purchase_cost IS DISTINCT FROM 5.67
     OR v_full_product.minimum_stock IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'Product category, details or positive catalog values failed';
  END IF;
  -- Names and SKUs may repeat within one business and across businesses.
  INSERT INTO public.products (business_id, name, sku, sale_price, default_purchase_cost)
  VALUES (v_business_id, 'Shared product', 'SHARED-SKU', 1, 1);
  INSERT INTO public.products (business_id, name, sku, sale_price, default_purchase_cost)
  VALUES (v_other_business_id, 'Shared product', 'SHARED-SKU', 1, 1);

  FOR v_case IN
    SELECT * FROM (VALUES
      ('business_id', 'gen_random_uuid()', '23503', 'products_business_id_fkey', NULL),
      ('business_id', 'NULL', '23502', NULL, 'business_id'),
      ('category_id', 'gen_random_uuid()', '23503', 'products_category_id_fkey', NULL),
      ('name', 'NULL', '23502', NULL, 'name'),
      ('name', '''''', '23514', 'products_name_check', NULL),
      ('name', '''   ''', '23514', 'products_name_check', NULL),
      ('sale_price', 'NULL', '23502', NULL, 'sale_price'),
      ('sale_price', '-0.01', '23514', 'products_sale_price_check', NULL),
      ('sale_price', '''NaN''::numeric', '23514', 'products_sale_price_check', NULL),
      ('default_purchase_cost', 'NULL', '23502', NULL, 'default_purchase_cost'),
      ('default_purchase_cost', '-0.01', '23514', 'products_default_purchase_cost_check', NULL),
      ('default_purchase_cost', '''NaN''::numeric', '23514', 'products_default_purchase_cost_check', NULL),
      ('minimum_stock', 'NULL', '23502', NULL, 'minimum_stock'),
      ('minimum_stock', '-1', '23514', 'products_minimum_stock_check', NULL),
      ('is_active', 'NULL', '23502', NULL, 'is_active'),
      ('created_at', 'NULL', '23502', NULL, 'created_at')
    ) AS cases(column_name, expression, expected_state, expected_constraint, expected_column)
  LOOP
    BEGIN
      EXECUTE format('UPDATE public.products SET %I = %s WHERE id = %L',
                     v_case.column_name, v_case.expression, v_full_product.id);
      RAISE EXCEPTION 'Expected rejection for % = %', v_case.column_name, v_case.expression;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      IF v_state <> v_case.expected_state
         OR (v_case.expected_constraint IS NOT NULL AND v_constraint <> v_case.expected_constraint)
         OR (v_case.expected_column IS NOT NULL AND v_column <> v_case.expected_column) THEN
        RAISE;
      END IF;
      v_rejections := v_rejections + 1;
    END;
  END LOOP;
  FOR v_case IN
    SELECT * FROM (VALUES
      (format('INSERT INTO public.products (business_id, name, default_purchase_cost) VALUES (%L, ''Missing price'', 1)', v_business_id), '23502', NULL, 'sale_price'),
      (format('INSERT INTO public.products (business_id, name, sale_price) VALUES (%L, ''Missing cost'', 1)', v_business_id), '23502', NULL, 'default_purchase_cost'),
      (format('INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost, updated_at) VALUES (%L, ''Invalid timestamp'', 1, 1, NULL)', v_business_id), '23502', NULL, 'updated_at'),
      (format('DELETE FROM public.product_categories WHERE id = %L', v_category_id), '23503', 'products_category_id_fkey', NULL),
      (format('DELETE FROM public.businesses WHERE id = %L', v_other_business_id), '23503', 'products_business_id_fkey', NULL)
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
      v_rejections := v_rejections + 1;
    END;
  END LOOP;

  UPDATE public.product_categories SET is_active = false WHERE id = v_category_id;
  SELECT * INTO v_updated_product FROM public.products WHERE id = v_full_product.id;
  IF v_updated_product.id IS DISTINCT FROM v_full_product.id
     OR v_updated_product.category_id IS DISTINCT FROM v_category_id
     OR v_updated_product.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Category archive must preserve its products';
  END IF;
  UPDATE public.products SET name = 'Archived product', is_active = false
  WHERE id = v_full_product.id RETURNING * INTO v_updated_product;
  IF v_updated_product.updated_at IS DISTINCT FROM transaction_timestamp()
     OR v_updated_product.updated_at <= v_full_product.updated_at
     OR v_updated_product.created_at IS DISTINCT FROM v_full_product.created_at
     OR v_updated_product.name IS DISTINCT FROM 'Archived product'
     OR v_updated_product.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Product rename, timestamps or soft archive failed';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    SELECT count(*) INTO v_count FROM public.products;
    IF v_count <> 0 THEN RAISE EXCEPTION '% can read products', v_role; END IF;
    UPDATE public.products SET name = 'Forbidden', is_active = true;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can update products', v_role; END IF;
    DELETE FROM public.products;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 0 THEN RAISE EXCEPTION '% can delete products', v_role; END IF;
    BEGIN
      INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost)
      VALUES (v_business_id, 'Denied', 1, 1);
      RAISE EXCEPTION '% can insert products', v_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.products WHERE business_id IN (v_business_id, v_other_business_id);
  SELECT * INTO v_updated_product FROM public.products WHERE id = v_full_product.id;
  IF v_count <> 4 OR v_updated_product.name IS DISTINCT FROM 'Archived product'
     OR v_updated_product.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Denied client writes changed the product fixtures';
  END IF;
  RAISE NOTICE 'BF-061 passed: schema, no stock, defaults, % constraint rejections, pricing, duplicates, archive, timestamps and RLS', v_rejections;
END;
$$;

ROLLBACK;
