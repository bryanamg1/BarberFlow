\set ON_ERROR_STOP on
BEGIN;

-- BF-071 table baseline plus the two explicitly approved BF-072 definers:
-- 19 known tables, exactly BF-073/BF-074/BF-075/BF-076/BF-077/BF-078/BF-079 policies, no FORCE RLS and two invoker triggers.
-- This suite creates no helper, function or policy.
-- All fixtures, role changes and positive controls are rolled back.
DO $$
DECLARE
  v_policy_names constant text[] := ARRAY[
    'profiles.profiles_select_self',
    'profiles.profiles_insert_self',
    'profiles.profiles_update_self',
    'businesses.businesses_select_members',
    'businesses.businesses_update_owners',
    'business_members.business_members_select_members',
    'business_members.business_members_insert_owners',
    'business_members.business_members_update_owners',
    'business_settings.business_settings_select_members',
    'business_settings.business_settings_insert_owners',
    'business_settings.business_settings_update_owners',
    'business_hours.business_hours_select_members',
    'business_hours.business_hours_insert_owners',
    'business_hours.business_hours_update_owners',
    'business_hours.business_hours_delete_owners',
    'clients.clients_select_members',
    'clients.clients_insert_members',
    'clients.clients_update_members',
    'services.services_select_members',
    'services.services_insert_owners',
    'services.services_update_owners',
    'appointments.appointments_select_authorized',
    'appointments.appointments_insert_authorized',
    'appointments.appointments_update_authorized',
    'appointment_services.appointment_services_select_authorized',
    'appointment_services.appointment_services_insert_authorized',
    'appointment_services.appointment_services_update_authorized',
    'appointment_services.appointment_services_delete_authorized',
    'product_categories.product_categories_select_members',
    'product_categories.product_categories_insert_owners',
    'product_categories.product_categories_update_owners',
    'products.products_select_members',
    'products.products_insert_owners',
    'products.products_update_owners',
    'stock_movements.stock_movements_select_members',
    'sales.sales_select_authorized',
    'sale_items.sale_items_select_authorized',
    'payments.payments_select_authorized',
    'purchases.purchases_select_owners',
    'purchase_items.purchase_items_select_owners',
    'expense_categories.expense_categories_select_owners',
    'expense_categories.expense_categories_insert_owners',
    'expense_categories.expense_categories_update_owners',
    'expenses.expenses_select_owners',
    'expenses.expenses_insert_manual_owners',
    'expenses.expenses_update_manual_owners'
  ];
  v_tables constant text[] := ARRAY[
    'profiles', 'businesses', 'business_members', 'business_settings', 'business_hours',
    'clients', 'services', 'appointments', 'appointment_services', 'product_categories',
    'products', 'sales', 'sale_items', 'payments', 'purchases', 'purchase_items',
    'stock_movements', 'expense_categories', 'expenses'
  ];
  v_user uuid := gen_random_uuid();
  v_unprivileged_user uuid := gen_random_uuid();
  v_other_user uuid := gen_random_uuid();
  v_business uuid := gen_random_uuid();
  v_other_business uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_client uuid := gen_random_uuid();
  v_service uuid := gen_random_uuid();
  v_appointment uuid := gen_random_uuid();
  v_category uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_sale uuid := gen_random_uuid();
  v_purchase uuid := gen_random_uuid();
  v_expense_category uuid := gen_random_uuid();
  v_table text;
  v_role text;
  v_privilege text;
  v_metadata record;
  v_baseline jsonb := '{}'::jsonb;
  v_inserts jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_payload jsonb;
  v_count bigint;
  v_affected bigint;
  v_message text;
  v_checks integer := 0;
BEGIN
  IF (SELECT array_agg(c.relname::text ORDER BY c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'))
     IS DISTINCT FROM (SELECT array_agg(t ORDER BY t) FROM unnest(v_tables) AS tables(t)) THEN
    RAISE EXCEPTION 'Public table inventory differs from the approved BF-071 baseline';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    SELECT c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity INTO STRICT v_metadata
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_table AND c.relkind IN ('r', 'p');
    IF NOT v_metadata.relrowsecurity OR v_metadata.relforcerowsecurity THEN
      RAISE EXCEPTION 'Expected RLS enabled without FORCE on %', v_table;
    END IF;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF NOT has_schema_privilege(v_role, 'public', 'USAGE') THEN
        RAISE EXCEPTION 'Schema USAGE missing for %', v_role;
      END IF;
      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF NOT (has_table_privilege(v_role, v_metadata.oid, v_privilege)
                OR (v_role = 'authenticated' AND v_privilege = 'UPDATE'
                    AND v_table = ANY(ARRAY['business_members', 'business_settings', 'business_hours', 'clients', 'services', 'appointments', 'product_categories', 'products', 'expense_categories'])
                    AND has_column_privilege(v_role, v_metadata.oid, 'created_at', 'UPDATE')
                    AND NOT has_column_privilege(v_role, v_metadata.oid, 'business_id', 'UPDATE')
                    AND (v_table <> 'appointments' OR NOT has_column_privilege(v_role, v_metadata.oid, 'created_by', 'UPDATE')))
                OR (v_role = 'authenticated' AND v_privilege = 'UPDATE' AND v_table = 'appointment_services'
                    AND has_column_privilege(v_role, v_metadata.oid, 'created_at', 'UPDATE')
                    AND NOT has_column_privilege(v_role, v_metadata.oid, 'appointment_id', 'UPDATE'))
                OR (v_role = 'authenticated' AND v_privilege = 'UPDATE' AND v_table = 'expenses'
                    AND has_column_privilege(v_role, v_metadata.oid, 'amount', 'UPDATE')
                    AND NOT has_column_privilege(v_role, v_metadata.oid, 'business_id', 'UPDATE')
                    AND NOT has_column_privilege(v_role, v_metadata.oid, 'created_at', 'UPDATE'))) THEN
          RAISE EXCEPTION 'Missing % grant on % for %; test must exercise RLS',
            v_privilege, v_table, v_role;
        END IF;
      END LOOP;
      IF v_role <> 'service_role'
         AND pg_has_role(v_role, v_metadata.relowner, 'USAGE') THEN
        RAISE EXCEPTION '% inherits table ownership on %', v_role, v_table;
      END IF;
      -- Audit rather than freeze unsafe default grants into a required baseline.
      -- PostgreSQL RLS does not cover TRUNCATE/REFERENCES; these require separate
      -- grant hardening approval. No destructive TRUNCATE is executed by this test.
      FOREACH v_privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
        IF has_table_privilege(v_role, v_metadata.oid, v_privilege) THEN
          RAISE NOTICE 'Grant audit: % has % on public.% (outside row-level DML checks)',
            v_role, v_privilege, v_table;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public')
     IS DISTINCT FROM (SELECT array_agg(p ORDER BY p) FROM unnest(v_policy_names) AS names(p)) THEN
    RAISE EXCEPTION 'Expected exactly the 46 approved BF-073/BF-074/BF-075/BF-076/BF-077/BF-078/BF-079 policies and no others';
  END IF;
  IF (SELECT array_agg(p.proname::text ORDER BY p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
     IS DISTINCT FROM ARRAY['has_business_role', 'is_business_member',
                            'prevent_stock_movement_changes', 'set_updated_at']::text[]
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND CASE
                  WHEN p.proname IN ('is_business_member', 'has_business_role') THEN
                    NOT p.prosecdef OR p.prorettype <> 'pg_catalog.bool'::regtype
                    OR p.proretset OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
                    OR p.oid NOT IN ('public.is_business_member(uuid)'::regprocedure,
                                    'public.has_business_role(uuid,text[])'::regprocedure)
                  ELSE p.prosecdef OR p.pronargs <> 0
                       OR p.prorettype <> 'pg_catalog.trigger'::regtype
                END) THEN
    RAISE EXCEPTION 'Public functions differ from the approved BF-071/BF-072 baseline';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
      AND NOT rolsuper AND NOT rolbypassrls) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role'
                    AND NOT rolsuper AND rolbypassrls) THEN
    RAISE EXCEPTION 'Unexpected client/service role bypass attributes';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user), (v_other_user), (v_unprivileged_user);
  INSERT INTO public.profiles (id, first_name, last_name) VALUES (v_user, 'RLS', 'Fixture');
  INSERT INTO public.businesses (id, name)
    VALUES (v_business, 'RLS fixture'), (v_other_business, 'RLS insert reference');
  INSERT INTO public.business_members (id, business_id, user_id, role)
    VALUES (v_member, v_business, v_user, 'OWNER');
  INSERT INTO public.business_settings (business_id) VALUES (v_business);
  INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time)
    VALUES (v_business, 0, '09:00', '18:00');
  INSERT INTO public.clients (id, business_id, first_name) VALUES (v_client, v_business, 'RLS');
  INSERT INTO public.services (id, business_id, name, price, duration_minutes)
    VALUES (v_service, v_business, 'RLS service', 20, 30);
  INSERT INTO public.appointments
    (id, business_id, client_id, barber_member_id, start_at, end_at, created_by)
    VALUES (v_appointment, v_business, v_client, v_member,
            '2030-01-07T12:00:00Z', '2030-01-07T12:30:00Z', v_user);
  INSERT INTO public.appointment_services
    (appointment_id, service_id, service_name_snapshot, unit_price_snapshot,
     duration_minutes_snapshot, line_total)
    VALUES (v_appointment, v_service, 'RLS service', 20, 30, 20);
  INSERT INTO public.product_categories (id, business_id, name)
    VALUES (v_category, v_business, 'RLS category');
  INSERT INTO public.products
    (id, business_id, category_id, name, sale_price, default_purchase_cost)
    VALUES (v_product, v_business, v_category, 'RLS product', 10, 4);
  INSERT INTO public.sales (id, business_id, operation_id, subtotal, total, created_by)
    VALUES (v_sale, v_business, gen_random_uuid(), 10, 10, v_user);
  INSERT INTO public.sale_items
    (sale_id, item_type, product_id, item_name_snapshot, unit_price_snapshot,
     unit_cost_snapshot, line_total)
    VALUES (v_sale, 'PRODUCT', v_product, 'RLS product', 10, 4, 10);
  INSERT INTO public.payments (business_id, sale_id, payment_method, amount, created_by)
    VALUES (v_business, v_sale, 'CASH', 10, v_user);
  INSERT INTO public.purchases (id, business_id, operation_id, supplier, total, created_by)
    VALUES (v_purchase, v_business, gen_random_uuid(), 'RLS supplier', 4, v_user);
  INSERT INTO public.purchase_items
    (purchase_id, product_id, product_name_snapshot, quantity, unit_cost_snapshot, line_total)
    VALUES (v_purchase, v_product, 'RLS product', 1, 4, 4);
  INSERT INTO public.stock_movements (business_id, product_id, type, quantity_delta, created_by)
    VALUES (v_business, v_product, 'PURCHASE', 1, v_user);
  INSERT INTO public.expense_categories (id, business_id, name)
    VALUES (v_expense_category, v_business, 'RLS expense category');
  INSERT INTO public.expenses
    (business_id, category_id, source_type, description, amount, payment_method, expense_date, created_by)
    VALUES (v_business, v_expense_category, 'MANUAL', 'RLS expense', 1, 'CASH', '2030-01-07', v_user);

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.%I t', v_table)
      INTO v_rows;
    IF v_rows IS NULL THEN RAISE EXCEPTION 'Missing positive fixture on %', v_table; END IF;
    v_baseline := v_baseline || jsonb_build_object(v_table, v_rows);
    -- Clone a valid row with fresh keys. Avoid every existing UNIQUE combination.
    v_payload := (v_rows -> 0) || jsonb_build_object('id', gen_random_uuid());
    CASE v_table
      WHEN 'profiles' THEN v_payload := v_payload || jsonb_build_object('id', v_other_user);
      WHEN 'business_members' THEN v_payload := v_payload || jsonb_build_object('user_id', v_other_user);
      WHEN 'business_settings' THEN v_payload := (v_payload - 'id') || jsonb_build_object('business_id', v_other_business);
      WHEN 'business_hours' THEN v_payload := v_payload || jsonb_build_object('day_of_week', 1);
      WHEN 'sales', 'purchases' THEN v_payload := v_payload || jsonb_build_object('operation_id', gen_random_uuid());
      ELSE NULL;
    END CASE;
    v_inserts := v_inserts || jsonb_build_object(v_table, v_payload);
    -- An administrative positive control proves each rejected INSERT is otherwise
    -- valid (including FK/UNIQUE/CHECK), then rolls back only that insert.
    BEGIN
      EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I, $1)).*',
                     v_table, v_table) USING v_payload;
      RAISE EXCEPTION 'Rollback valid insert control' USING ERRCODE = 'ZB071';
    EXCEPTION WHEN SQLSTATE 'ZB071' THEN NULL;
    END;
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    -- BF-073 allows own profiles and active business membership. Keep this
    -- deny matrix on a nonmember identity and a DIFFERENT user's profile.
    PERFORM set_config('request.jwt.claims',
      CASE WHEN v_role = 'authenticated'
        THEN jsonb_build_object('sub', v_unprivileged_user, 'role', v_role)::text
        ELSE jsonb_build_object('role', v_role)::text END, true);
    PERFORM set_config('request.jwt.claim.sub',
      CASE WHEN v_role = 'authenticated' THEN v_unprivileged_user::text ELSE '' END, true);
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    IF current_user <> v_role OR auth.uid() IS DISTINCT FROM
       (CASE WHEN v_role = 'authenticated' THEN v_unprivileged_user ELSE NULL::uuid END) THEN
      RAISE EXCEPTION 'Role/JWT simulation failed for %', v_role;
    END IF;

    FOREACH v_table IN ARRAY v_tables LOOP
      IF NOT row_security_active(format('public.%I', v_table)::regclass) THEN
        RAISE EXCEPTION 'RLS is not effective for % on %', v_role, v_table;
      END IF;
      EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count;
      IF v_count <> 0 THEN RAISE EXCEPTION '% can read %', v_role, v_table; END IF;
      IF v_table = 'expenses' THEN
        EXECUTE 'UPDATE public.expenses SET amount = amount';
      ELSE
        EXECUTE format('UPDATE public.%I SET created_at = created_at', v_table);
      END IF;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      IF v_affected <> 0 THEN RAISE EXCEPTION '% can update %', v_role, v_table; END IF;
      EXECUTE format('DELETE FROM public.%I', v_table);
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      IF v_affected <> 0 THEN RAISE EXCEPTION '% can delete %', v_role, v_table; END IF;
      BEGIN
        EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I, $1)).*',
                       v_table, v_table) USING v_inserts -> v_table;
        RAISE EXCEPTION '% can insert into %', v_role, v_table;
      EXCEPTION WHEN insufficient_privilege THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        IF v_message NOT LIKE '%row-level security%' THEN
          RAISE EXCEPTION 'INSERT failed for a reason other than RLS: %', v_message;
        END IF;
      END;
      v_checks := v_checks + 4;
    END LOOP;
    RESET ROLE;
  END LOOP;

  SET LOCAL ROLE service_role;
  FOREACH v_table IN ARRAY v_tables LOOP
    IF row_security_active(format('public.%I', v_table)::regclass) THEN
      RAISE EXCEPTION 'service_role unexpectedly subject to RLS on %', v_table;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count;
    IF v_count <> jsonb_array_length(v_baseline -> v_table) THEN
      RAISE EXCEPTION 'service_role cannot read the baseline on %', v_table;
    END IF;
  END LOOP;
  RESET ROLE;

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.%I t', v_table)
      INTO v_rows;
    IF v_rows IS DISTINCT FROM v_baseline -> v_table THEN
      RAISE EXCEPTION 'Denied DML changed rows on %', v_table;
    END IF;
  END LOOP;
  RAISE NOTICE 'BF-071 passed: 19 RLS tables, 46 approved policies, zero FORCE/unexpected functions, % denied DML checks, 19 service_role reads and unchanged fixtures', v_checks;
END;
$$;

ROLLBACK;
