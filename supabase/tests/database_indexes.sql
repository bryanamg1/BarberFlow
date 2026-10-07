\set ON_ERROR_STOP on
BEGIN;

-- Metadata only: no persistent fixtures and no dependency on planner cost estimates.
DO $$
DECLARE
  v_expected record;
  v_index record;
  v_duplicate record;
  v_verified integer := 0;
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('profiles', 'profiles_pkey', 'id', 'p'),
      ('businesses', 'businesses_pkey', 'id', 'p'),
      ('business_members', 'business_members_pkey', 'id', 'p'),
      ('business_settings', 'business_settings_pkey', 'business_id', 'p'),
      ('business_hours', 'business_hours_pkey', 'id', 'p'),
      ('clients', 'clients_pkey', 'id', 'p'),
      ('services', 'services_pkey', 'id', 'p'),
      ('appointments', 'appointments_pkey', 'id', 'p'),
      ('appointment_services', 'appointment_services_pkey', 'id', 'p'),
      ('product_categories', 'product_categories_pkey', 'id', 'p'),
      ('products', 'products_pkey', 'id', 'p'),
      ('sales', 'sales_pkey', 'id', 'p'),
      ('sale_items', 'sale_items_pkey', 'id', 'p'),
      ('payments', 'payments_pkey', 'id', 'p'),
      ('purchases', 'purchases_pkey', 'id', 'p'),
      ('purchase_items', 'purchase_items_pkey', 'id', 'p'),
      ('stock_movements', 'stock_movements_pkey', 'id', 'p'),
      ('expense_categories', 'expense_categories_pkey', 'id', 'p'),
      ('expenses', 'expenses_pkey', 'id', 'p'),
      ('business_members', 'business_members_business_user_key', 'business_id,user_id', 'u'),
      ('business_hours', 'business_hours_business_day_key', 'business_id,day_of_week', 'u'),
      ('sales', 'sales_business_id_operation_id_key', 'business_id,operation_id', 'u'),
      ('purchases', 'purchases_business_id_operation_id_key', 'business_id,operation_id', 'u'),
      ('expenses', 'expenses_purchase_id_key', 'purchase_id', 'u'),
      ('business_members', 'business_members_user_id_idx', 'user_id', 'i'),
      ('clients', 'clients_business_id_is_active_idx', 'business_id,is_active', 'i'),
      ('clients', 'clients_business_id_phone_idx', 'business_id,phone', 'i'),
      ('services', 'services_business_id_is_active_idx', 'business_id,is_active', 'i'),
      ('appointments', 'appointments_business_id_start_at_idx', 'business_id,start_at', 'i'),
      ('appointments', 'appointments_business_id_barber_member_id_start_at_idx', 'business_id,barber_member_id,start_at', 'i'),
      ('appointments', 'appointments_business_id_client_id_start_at_idx', 'business_id,client_id,start_at', 'i'),
      ('appointments', 'appointments_barber_member_id_start_at_idx', 'barber_member_id,start_at', 'i'),
      ('appointments', 'appointments_client_id_start_at_idx', 'client_id,start_at', 'i'),
      ('appointment_services', 'appointment_services_appointment_id_idx', 'appointment_id', 'i'),
      ('appointment_services', 'appointment_services_service_id_idx', 'service_id', 'i'),
      ('product_categories', 'product_categories_business_id_is_active_idx', 'business_id,is_active', 'i'),
      ('products', 'products_business_id_is_active_idx', 'business_id,is_active', 'i'),
      ('products', 'products_category_id_idx', 'category_id', 'i'),
      ('sales', 'sales_business_id_sold_at_idx', 'business_id,sold_at', 'i'),
      ('sales', 'sales_client_id_sold_at_idx', 'client_id,sold_at', 'i'),
      ('sales', 'sales_appointment_id_idx', 'appointment_id', 'i'),
      ('sale_items', 'sale_items_sale_id_idx', 'sale_id', 'i'),
      ('sale_items', 'sale_items_service_id_idx', 'service_id', 'i'),
      ('sale_items', 'sale_items_product_id_idx', 'product_id', 'i'),
      ('payments', 'payments_sale_id_idx', 'sale_id', 'i'),
      ('purchases', 'purchases_business_id_purchased_at_idx', 'business_id,purchased_at', 'i'),
      ('purchase_items', 'purchase_items_purchase_id_idx', 'purchase_id', 'i'),
      ('purchase_items', 'purchase_items_product_id_idx', 'product_id', 'i'),
      ('stock_movements', 'stock_movements_business_id_product_id_occurred_at_idx', 'business_id,product_id,occurred_at', 'i'),
      ('stock_movements', 'stock_movements_product_id_occurred_at_idx', 'product_id,occurred_at', 'i'),
      ('expense_categories', 'expense_categories_business_id_is_active_idx', 'business_id,is_active', 'i'),
      ('expenses', 'expenses_business_id_expense_date_idx', 'business_id,expense_date', 'i'),
      ('expenses', 'expenses_category_id_idx', 'category_id', 'i')
    ) AS expected(table_name, index_name, columns, kind)
  LOOP
    SELECT i.*, am.amname,
           ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS keys(attnum, position)
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = keys.attnum
                 ORDER BY keys.position) AS column_names
    INTO v_index
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_am am ON am.oid = idx.relam
    WHERE n.nspname = 'public' AND t.relname = v_expected.table_name AND idx.relname = v_expected.index_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'Index missing or on wrong table: %', v_expected.index_name; END IF;
    IF v_index.column_names IS DISTINCT FROM string_to_array(v_expected.columns, ',')
       OR v_index.indisunique IS DISTINCT FROM (v_expected.kind IN ('p', 'u'))
       OR v_index.indisprimary IS DISTINCT FROM (v_expected.kind = 'p')
       OR v_index.amname <> 'btree' OR NOT v_index.indisvalid OR NOT v_index.indisready
       OR NOT v_index.indislive OR v_index.indpred IS NOT NULL OR v_index.indexprs IS NOT NULL
       OR v_index.indnatts <> v_index.indnkeyatts OR v_index.indnullsnotdistinct
       OR EXISTS (SELECT 1 FROM unnest(v_index.indoption) AS options(value) WHERE value <> 0) THEN
      RAISE EXCEPTION 'Index keys, order, uniqueness, validity or method mismatch: %', v_expected.index_name;
    END IF;
    IF v_expected.kind IN ('p', 'u') AND NOT EXISTS (
      SELECT 1 FROM pg_constraint c WHERE c.conrelid = v_index.indrelid
        AND c.conindid = v_index.indexrelid AND c.conname = v_expected.index_name
        AND c.contype::text = v_expected.kind AND c.convalidated
    ) THEN
      RAISE EXCEPTION 'PK/UNIQUE constraint backing index lost: %', v_expected.index_name;
    END IF;
    IF v_expected.kind = 'i' AND EXISTS (
      SELECT 1 FROM pg_constraint c WHERE c.conrelid = v_index.indrelid
        AND c.conindid = v_index.indexrelid AND c.contype IN ('p', 'u', 'x')
    ) THEN
      RAISE EXCEPTION 'Explicit lookup index unexpectedly adds a constraint: %', v_expected.index_name;
    END IF;
    v_verified := v_verified + 1;
  END LOOP;
  IF v_verified <> 53 THEN RAISE EXCEPTION 'Incomplete BF-070 index inventory'; END IF;

  -- Also catches a nonunique copy of a PK/UNIQUE index under a different name.
  SELECT t.relname AS table_name, array_agg(idx.relname ORDER BY idx.relname) AS names
  INTO v_duplicate
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_class idx ON idx.oid = i.indexrelid
  WHERE n.nspname = 'public'
  GROUP BY t.relname, idx.relam, i.indkey, i.indclass, i.indcollation, i.indoption,
           i.indnkeyatts, i.indnullsnotdistinct,
           pg_get_expr(i.indpred, i.indrelid), pg_get_expr(i.indexprs, i.indrelid)
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Duplicate indexes on %: %', v_duplicate.table_name, v_duplicate.names; END IF;
  RAISE NOTICE 'BF-070 passed: 53 expected indexes, 19 PKs, 5 UNIQUEs, 29 explicit lookups, valid ordered keys and no exact duplicates';
END;
$$;

ROLLBACK;
