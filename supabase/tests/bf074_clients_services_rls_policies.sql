\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

DO $$
DECLARE
  expected record;
  actual record;
  col record;
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 40 THEN
    RAISE EXCEPTION 'Expected exactly 40 BF-073/BF-074/BF-075/BF-076/BF-077/BF-078 policies';
  END IF;
  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('appointments', 'appointment_services')) IS DISTINCT FROM
     ARRAY['appointment_services.appointment_services_delete_authorized',
           'appointment_services.appointment_services_insert_authorized',
           'appointment_services.appointment_services_select_authorized',
           'appointment_services.appointment_services_update_authorized',
           'appointments.appointments_insert_authorized',
           'appointments.appointments_select_authorized',
           'appointments.appointments_update_authorized']::text[] THEN
    RAISE EXCEPTION 'Expected exactly the seven approved BF-075 policy identities';
  END IF;
  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('product_categories', 'products', 'stock_movements')) IS DISTINCT FROM
     ARRAY['product_categories.product_categories_insert_owners',
           'product_categories.product_categories_select_members',
           'product_categories.product_categories_update_owners',
           'products.products_insert_owners',
           'products.products_select_members',
           'products.products_update_owners',
           'stock_movements.stock_movements_select_members']::text[] THEN
    RAISE EXCEPTION 'Expected exactly the seven approved BF-076 policy identities';
  END IF;
  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('sales','sale_items','payments')) IS DISTINCT FROM
     ARRAY['payments.payments_select_authorized','sale_items.sale_items_select_authorized',
           'sales.sales_select_authorized']::text[] THEN
    RAISE EXCEPTION 'Expected exactly the three approved BF-077 policy identities';
  END IF;
  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename,policyname)
      FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('purchases','purchase_items')) IS DISTINCT FROM
     ARRAY['purchase_items.purchase_items_select_owners','purchases.purchases_select_owners']::text[] THEN
    RAISE EXCEPTION 'Expected exactly the two BF-078 policy identities';
  END IF;
  FOR expected IN
    SELECT * FROM (VALUES
      ('profiles', 'profiles_select_self', 'SELECT', '(id = auth.uid())', NULL),
      ('profiles', 'profiles_insert_self', 'INSERT', NULL, '(id = auth.uid())'),
      ('profiles', 'profiles_update_self', 'UPDATE', '(id = auth.uid())', '(id = auth.uid())'),
      ('businesses', 'businesses_select_members', 'SELECT', 'public.is_business_member(id)', NULL),
      ('businesses', 'businesses_update_owners', 'UPDATE', 'public.has_business_role(id, ARRAY[''OWNER''::text])', 'public.has_business_role(id, ARRAY[''OWNER''::text])'),
      ('business_members', 'business_members_select_members', 'SELECT', 'public.is_business_member(business_id)', NULL),
      ('business_members', 'business_members_insert_owners', 'INSERT', NULL, 'public.has_business_role(business_id, ARRAY[''OWNER''::text])'),
      ('business_members', 'business_members_update_owners', 'UPDATE', 'public.has_business_role(business_id, ARRAY[''OWNER''::text])', 'public.has_business_role(business_id, ARRAY[''OWNER''::text])'),
      ('business_settings', 'business_settings_select_members', 'SELECT', 'public.is_business_member(business_id)', NULL),
      ('business_settings', 'business_settings_insert_owners', 'INSERT', NULL, 'public.has_business_role(business_id, ARRAY[''OWNER''::text])'),
      ('business_settings', 'business_settings_update_owners', 'UPDATE', 'public.has_business_role(business_id, ARRAY[''OWNER''::text])', 'public.has_business_role(business_id, ARRAY[''OWNER''::text])'),
      ('business_hours', 'business_hours_select_members', 'SELECT', 'public.is_business_member(business_id)', NULL),
      ('business_hours', 'business_hours_insert_owners', 'INSERT', NULL, 'public.has_business_role(business_id, ARRAY[''OWNER''::text])'),
      ('business_hours', 'business_hours_update_owners', 'UPDATE', 'public.has_business_role(business_id, ARRAY[''OWNER''::text])', 'public.has_business_role(business_id, ARRAY[''OWNER''::text])'),
      ('business_hours', 'business_hours_delete_owners', 'DELETE', 'public.has_business_role(business_id, ARRAY[''OWNER''::text])', NULL),
      ('clients', 'clients_select_members', 'SELECT', 'public.is_business_member(business_id)', NULL),
      ('clients', 'clients_insert_members', 'INSERT', NULL, 'public.is_business_member(business_id)'),
      ('clients', 'clients_update_members', 'UPDATE', 'public.is_business_member(business_id)', 'public.is_business_member(business_id)'),
      ('services', 'services_select_members', 'SELECT', 'public.is_business_member(business_id)', NULL),
      ('services', 'services_insert_owners', 'INSERT', NULL, 'public.has_business_role(business_id, ARRAY[''OWNER''::text])'),
      ('services', 'services_update_owners', 'UPDATE', 'public.has_business_role(business_id, ARRAY[''OWNER''::text])', 'public.has_business_role(business_id, ARRAY[''OWNER''::text])')
    ) AS policies(table_name, policy_name, command, using_expression, check_expression)
  LOOP
    SELECT * INTO STRICT actual FROM pg_policies
      WHERE schemaname = 'public' AND tablename = expected.table_name AND policyname = expected.policy_name;
    IF actual.cmd <> expected.command OR actual.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
       OR actual.permissive <> 'PERMISSIVE'
       OR regexp_replace(actual.qual, '[[:space:]]', '', 'g') IS DISTINCT FROM regexp_replace(expected.using_expression, '[[:space:]]', '', 'g')
       OR regexp_replace(actual.with_check, '[[:space:]]', '', 'g') IS DISTINCT FROM regexp_replace(expected.check_expression, '[[:space:]]', '', 'g') THEN
      RAISE EXCEPTION 'Incorrect policy command, role, USING or WITH CHECK: %', expected.policy_name;
    END IF;
  END LOOP;
  FOR col IN
    SELECT c.oid, a.attname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relname IN ('clients', 'services')
  LOOP
    IF has_column_privilege('authenticated', col.oid, col.attname, 'UPDATE') IS DISTINCT FROM (col.attname <> 'business_id')
       OR has_table_privilege('authenticated', col.oid, 'UPDATE')
       OR NOT has_column_privilege('service_role', col.oid, col.attname, 'UPDATE') THEN
      RAISE EXCEPTION 'Incorrect scoped UPDATE grant on % column %', col.oid::regclass, col.attname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')) <> 19
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                  AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Expected exactly 19 RLS tables with FORCE off';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY[
      'expense_categories', 'expenses'])) THEN
    RAISE EXCEPTION 'A future domain received a policy';
  END IF;
  RAISE NOTICE 'BF-074 metadata passed: exactly 40 known policies including six clients/services and seven appointment and seven inventory and three finance and two purchase policies, authenticated only, exact USING/WITH CHECK, immutable tenant columns, 2 future tables without policies, 19 RLS tables with FORCE off';
END;
$$;

DO $$
DECLARE
  users uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                        gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  biz uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  member_ids uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  client_ids uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  service_ids uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  future_tables constant text[] := ARRAY[
    'expense_categories', 'expenses'
  ];
  person record;
  table_name text;
  operation text;
  statement text;
  insert_statement text;
  update_statement text;
  row_id uuid;
  target_business uuid;
  archived boolean;
  allowed boolean;
  expected_count bigint;
  actual_count bigint;
  affected bigint;
  message text;
  baseline_clients jsonb;
  baseline_services jsonb;
  side integer;
  idx integer;
  checks integer := 0;
  future_checks integer := 0;
  mutation_checks integer := 0;
  revocation_checks integer := 0;
BEGIN
  INSERT INTO auth.users (id) SELECT unnest(users);
  INSERT INTO public.businesses (id, name) VALUES (biz[1], 'BF074 A'), (biz[2], 'BF074 B');
  FOR idx IN 1..2 LOOP
    INSERT INTO public.business_members (id, business_id, user_id, role) VALUES
      (member_ids[2*idx-1], biz[idx], users[2*idx-1], 'OWNER'),
      (member_ids[2*idx], biz[idx], users[2*idx], 'BARBER');
    INSERT INTO public.business_members (business_id, user_id, role) VALUES
      (biz[idx], users[7], 'OWNER'), (biz[idx], users[8], 'BARBER');
    INSERT INTO public.clients (id, business_id, first_name, is_active) VALUES
      (client_ids[2*idx-1], biz[idx], 'Active client', true),
      (client_ids[2*idx], biz[idx], 'Archived client', false);
    INSERT INTO public.services (id, business_id, name, price, duration_minutes, is_active) VALUES
      (service_ids[2*idx-1], biz[idx], 'Active service', 10, 30, true),
      (service_ids[2*idx], biz[idx], 'Archived service', 10, 30, false);
    INSERT INTO public.product_categories (business_id, name) VALUES (biz[idx], 'Closed category');
    INSERT INTO public.products (business_id, name, sale_price, default_purchase_cost) VALUES (biz[idx], 'Closed product', 10, 4);
    INSERT INTO public.expense_categories (business_id, name) VALUES (biz[idx], 'Closed expense category');
  END LOOP;
  INSERT INTO public.business_members (business_id, user_id, role, is_active) VALUES (biz[1], users[6], 'OWNER', false);
  SELECT jsonb_agg(to_jsonb(c) ORDER BY id) INTO baseline_clients FROM public.clients c;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY id) INTO baseline_services FROM public.services s;

  -- Check both tenants, both record activity states and every CRUD command.
  -- Each operation is rolled back independently, preserving all prerequisites.
  FOR person IN SELECT * FROM (VALUES
    (users[1], ARRAY[biz[1]], 'OWNER', 'authenticated', 'Owner A'),
    (users[2], ARRAY[biz[1]], 'BARBER', 'authenticated', 'Barber A'),
    (users[3], ARRAY[biz[2]], 'OWNER', 'authenticated', 'Owner B'),
    (users[4], ARRAY[biz[2]], 'BARBER', 'authenticated', 'Barber B'),
    (users[5], ARRAY[]::uuid[], NULL, 'authenticated', 'No membership'),
    (users[6], ARRAY[]::uuid[], NULL, 'authenticated', 'Inactive membership'),
    (users[7], biz, 'OWNER', 'authenticated', 'Owner AB'),
    (users[8], biz, 'BARBER', 'authenticated', 'Barber AB'),
    (NULL::uuid, ARRAY[]::uuid[], NULL, 'anon', 'Anonymous')
  ) AS people(user_id, active_businesses, business_role, database_role, label) LOOP
    FOREACH table_name IN ARRAY ARRAY['clients', 'services'] LOOP
      FOR side IN 1..2 LOOP
        target_business := biz[side];
        FOREACH archived IN ARRAY ARRAY[false, true] LOOP
          idx := 2*side - CASE WHEN archived THEN 0 ELSE 1 END;
          row_id := CASE table_name WHEN 'clients' THEN client_ids[idx] ELSE service_ids[idx] END;
          IF table_name = 'clients' THEN
            insert_statement := format('INSERT INTO public.clients (business_id, first_name, is_active) VALUES (%L, ''New client'', %L)', target_business, NOT archived);
            update_statement := 'first_name = ''Updated client'', phone = ''123'', notes = ''Edited'', preferences = ''Free text'', is_active = NOT is_active';
          ELSE
            insert_statement := format('INSERT INTO public.services (business_id, name, price, duration_minutes, is_active) VALUES (%L, ''New service'', 20, 45, %L)', target_business, NOT archived);
            update_statement := 'name = ''Updated service'', description = ''Edited'', price = 20, duration_minutes = 45, is_active = NOT is_active';
          END IF;
          FOREACH operation IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
            allowed := person.database_role = 'authenticated'
              AND target_business = ANY(person.active_businesses)
              AND operation <> 'DELETE'
              AND (table_name = 'clients' OR operation = 'SELECT' OR person.business_role = 'OWNER');
            allowed := coalesce(allowed, false);
            expected_count := CASE WHEN allowed THEN 1 ELSE 0 END;
            statement := CASE operation
              WHEN 'SELECT' THEN format('SELECT count(*) FROM public.%I WHERE id = %L', table_name, row_id)
              WHEN 'INSERT' THEN insert_statement
              WHEN 'UPDATE' THEN format('UPDATE public.%I SET %s WHERE id = %L', table_name, update_statement, row_id)
              WHEN 'DELETE' THEN format('DELETE FROM public.%I WHERE id = %L', table_name, row_id) END;
            BEGIN
              PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', person.user_id, 'role', person.database_role)::text, true);
              PERFORM set_config('request.jwt.claim.sub', coalesce(person.user_id::text, ''), true);
              EXECUTE format('SET LOCAL ROLE %I', person.database_role);
              IF auth.uid() IS DISTINCT FROM person.user_id OR current_user <> person.database_role THEN
                RAISE EXCEPTION 'Identity simulation failed';
              END IF;
              BEGIN
                IF operation = 'SELECT' THEN
                  EXECUTE statement INTO actual_count;
                  IF actual_count <> expected_count THEN RAISE EXCEPTION 'Unexpected visible rows'; END IF;
                ELSE
                  EXECUTE statement;
                  GET DIAGNOSTICS affected = ROW_COUNT;
                  IF operation = 'INSERT' AND NOT allowed THEN RAISE EXCEPTION 'Unauthorized INSERT succeeded'; END IF;
                  IF affected <> expected_count THEN RAISE EXCEPTION 'Unexpected affected rows'; END IF;
                  IF operation = 'UPDATE' AND allowed THEN
                    EXECUTE format('SELECT count(*) FROM public.%I WHERE id = %L AND is_active = %L', table_name, row_id, archived) INTO actual_count;
                    IF actual_count <> 1 THEN RAISE EXCEPTION 'Archive/reactivation did not preserve visibility'; END IF;
                  END IF;
                END IF;
              EXCEPTION WHEN insufficient_privilege THEN
                GET STACKED DIAGNOSTICS message = MESSAGE_TEXT;
                IF operation <> 'INSERT' OR allowed OR message NOT LIKE '%row-level security%' THEN RAISE; END IF;
              END;
              RESET ROLE;
              RAISE EXCEPTION 'Rollback matrix operation' USING ERRCODE = 'ZB074';
            EXCEPTION WHEN SQLSTATE 'ZB074' THEN NULL;
            WHEN OTHERS THEN
              RAISE EXCEPTION 'Matrix failed: %, %, side %, archived %, %: %', person.label, table_name, side, archived, operation, SQLERRM;
            END;
            checks := checks + 1;
          END LOOP;
        END LOOP;
      END LOOP;
    END LOOP;

    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', person.user_id, 'role', person.database_role)::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(person.user_id::text, ''), true);
    EXECUTE format('SET LOCAL ROLE %I', person.database_role);
    FOREACH table_name IN ARRAY future_tables LOOP
      EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO actual_count;
      IF actual_count <> 0 THEN RAISE EXCEPTION 'Future SELECT opened: %', table_name; END IF;
      EXECUTE format('UPDATE public.%I SET created_at = created_at', table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION 'Future UPDATE opened: %', table_name; END IF;
      EXECUTE format('DELETE FROM public.%I', table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION 'Future DELETE opened: %', table_name; END IF;
      future_checks := future_checks + 3;
    END LOOP;
    RESET ROLE;
  END LOOP;

  -- Both OWNER AB and BARBER AB can read the source and satisfy both membership
  -- predicates. OWNER AB can also administer both catalogs (matrix above).
  -- Moving business_id must raise 42501 for column privileges, not affect 0 rows.
  FOR idx IN 7..8 LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[idx], 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', users[idx]::text, true);
    FOREACH table_name IN ARRAY ARRAY['clients', 'services'] LOOP
      row_id := CASE table_name WHEN 'clients' THEN client_ids[1] ELSE service_ids[1] END;
      statement := format('UPDATE public.%I SET business_id = %L WHERE id = %L', table_name, biz[2], row_id);
      BEGIN
        -- Otherwise-valid administrator control excludes FK/UNIQUE failures.
        EXECUTE statement;
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Invalid transfer control'; END IF;
        RAISE EXCEPTION 'Rollback administrator control' USING ERRCODE = 'ZB074';
      EXCEPTION WHEN SQLSTATE 'ZB074' THEN NULL; END;
      SET LOCAL ROLE authenticated;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE id = %L', table_name, row_id) INTO actual_count;
      IF actual_count <> 1 OR NOT public.is_business_member(biz[1]) OR NOT public.is_business_member(biz[2])
         OR (idx = 7 AND (NOT public.has_business_role(biz[1], ARRAY['OWNER']) OR NOT public.has_business_role(biz[2], ARRAY['OWNER']))) THEN
        RAISE EXCEPTION 'Multi-business fixture does not have source/target access';
      END IF;
      BEGIN
        EXECUTE statement;
        RAISE EXCEPTION 'Multi-business user can move a row';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM NOT LIKE '%permission denied%' OR SQLERRM LIKE '%row-level security%' THEN
          RAISE EXCEPTION 'Expected column privilege denial, got: %', SQLERRM;
        END IF;
      END;
      RESET ROLE;
      mutation_checks := mutation_checks + 1;
    END LOOP;
  END LOOP;

  -- Prove immediate loss of access after revoking either literal role in A/B.
  FOR idx IN 1..4 LOOP
    BEGIN
      UPDATE public.business_members SET is_active = false WHERE id = member_ids[idx];
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'Revocation fixture failed'; END IF;
      side := CASE WHEN idx <= 2 THEN 1 ELSE 2 END;
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[idx], 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', users[idx]::text, true);
      SET LOCAL ROLE authenticated;
      IF public.is_business_member(biz[side]) OR public.has_business_role(biz[side], ARRAY['OWNER','BARBER']) THEN
        RAISE EXCEPTION 'Revoked helper access persists';
      END IF;
      FOREACH table_name IN ARRAY ARRAY['clients', 'services'] LOOP
        EXECUTE format('SELECT count(*) FROM public.%I WHERE business_id = %L', table_name, biz[side]) INTO actual_count;
        IF actual_count <> 0 THEN RAISE EXCEPTION 'Revoked SELECT persists'; END IF;
        EXECUTE format('UPDATE public.%I SET is_active = false WHERE business_id = %L', table_name, biz[side]);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'Revoked UPDATE persists'; END IF;
        EXECUTE format('DELETE FROM public.%I WHERE business_id = %L', table_name, biz[side]);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'Revoked DELETE persists'; END IF;
        BEGIN
          IF table_name = 'clients' THEN
            INSERT INTO public.clients (business_id, first_name) VALUES (biz[side], 'Revoked');
          ELSE
            INSERT INTO public.services (business_id, name, price, duration_minutes) VALUES (biz[side], 'Revoked', 10, 30);
          END IF;
          RAISE EXCEPTION 'Revoked INSERT persists';
        EXCEPTION WHEN insufficient_privilege THEN
          IF SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
        END;
        revocation_checks := revocation_checks + 4;
      END LOOP;
      RESET ROLE;
      RAISE EXCEPTION 'Rollback revocation' USING ERRCODE = 'ZB074';
    EXCEPTION WHEN SQLSTATE 'ZB074' THEN NULL; END;
  END LOOP;
  IF (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.clients c) IS DISTINCT FROM baseline_clients
     OR (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.services s) IS DISTINCT FROM baseline_services THEN
    RAISE EXCEPTION 'Denied operations or temporary controls changed clients/services fixtures';
  END IF;
  RAISE NOTICE 'BF-074 passed: % role/tenant/active-record CRUD checks, % future-domain denials, % multi-business column denials, % immediate revocation checks, archived rows visible and reactivatable, no recursion, unchanged fixtures', checks, future_checks, mutation_checks, revocation_checks;
END;
$$;

ROLLBACK;
