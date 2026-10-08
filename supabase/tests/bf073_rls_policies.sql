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
    WHERE n.nspname = 'public' AND c.relname IN ('business_members', 'business_settings', 'business_hours')
  LOOP
    IF has_column_privilege('authenticated', col.oid, col.attname, 'UPDATE') IS DISTINCT FROM (col.attname <> 'business_id')
       OR has_table_privilege('authenticated', col.oid, 'UPDATE')
       OR NOT has_column_privilege('service_role', col.oid, col.attname, 'UPDATE') THEN
      RAISE EXCEPTION 'Incorrect scoped UPDATE grant on % column %', col.oid::regclass, col.attname;
    END IF;
  END LOOP;
  RAISE NOTICE 'BF-073 metadata passed: 15 original policies plus exactly six BF-074, seven BF-075, seven BF-076, three BF-077 and two BF-078 policies, authenticated only, exact USING/WITH CHECK, immutable tenant columns';
END;
$$;

DO $$
DECLARE
  users uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  biz uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  owner_members uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  barber_members uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  hour_ids uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  insert_user uuid := gen_random_uuid();
  closed_category uuid;
  person record;
  target record;
  outside record;
  table_name text;
  operation text;
  statement text;
  predicate text;
  insert_statement text;
  update_statement text;
  profile_id uuid;
  target_business uuid;
  allowed boolean;
  expected_count bigint;
  actual_count bigint;
  affected bigint;
  message text;
  side integer;
  idx integer;
  checks integer := 0;
  outside_checks integer := 0;
BEGIN
  INSERT INTO auth.users (id) SELECT unnest(users);
  INSERT INTO auth.users (id) VALUES (insert_user);
  INSERT INTO public.profiles (id, first_name, last_name) SELECT u, 'BF073', 'Profile' FROM unnest(users) AS identities(u);
  INSERT INTO public.businesses (id, name) VALUES (biz[1], 'Business A'), (biz[2], 'Business B'), (biz[3], 'Bootstrap pending');
  FOR idx IN 1..2 LOOP
    INSERT INTO public.business_members (id, business_id, user_id, role)
      VALUES (owner_members[idx], biz[idx], users[2*idx-1], 'OWNER'),
             (barber_members[idx], biz[idx], users[2*idx], 'BARBER');
    INSERT INTO public.business_settings (business_id) VALUES (biz[idx]);
    INSERT INTO public.business_hours (id, business_id, day_of_week, open_time, close_time)
      VALUES (hour_ids[idx], biz[idx], 0, '09:00', '18:00');
    INSERT INTO public.expense_categories (business_id, name) VALUES (biz[idx], 'Closed expense category');
    INSERT INTO public.expenses (business_id, category_id, source_type, description, amount, payment_method, expense_date, created_by)
      SELECT biz[idx], id, 'MANUAL', 'Closed expense', 10, 'CASH', DATE '2030-01-07', users[1]
      FROM public.expense_categories WHERE business_id = biz[idx];
  END LOOP;
  INSERT INTO public.business_members (business_id, user_id, role, is_active) VALUES (biz[1], users[6], 'BARBER', false);

  SELECT id INTO STRICT closed_category FROM public.expense_categories WHERE business_id = biz[1];

  -- Every matrix operation runs in its own rolled-back subtransaction, so an
  -- allowed INSERT/UPDATE/DELETE cannot change the next role's prerequisites.
  FOR person IN
    SELECT * FROM (VALUES
      (users[1], biz[1], 'OWNER', 'authenticated', 'Owner A'),
      (users[2], biz[1], 'BARBER', 'authenticated', 'Barber A'),
      (users[3], biz[2], 'OWNER', 'authenticated', 'Owner B'),
      (users[4], biz[2], 'BARBER', 'authenticated', 'Barber B'),
      (users[5], NULL::uuid, NULL, 'authenticated', 'No membership'),
      (users[6], NULL::uuid, NULL, 'authenticated', 'Inactive membership'),
      (NULL::uuid, NULL::uuid, NULL, 'anon', 'Anonymous')
    ) AS people(user_id, active_business, business_role, database_role, label)
  LOOP
    FOREACH table_name IN ARRAY ARRAY['profiles','businesses','business_members','business_settings','business_hours'] LOOP
      FOR side IN 1..2 LOOP
        target_business := biz[side];
        profile_id := CASE WHEN side = 1 THEN coalesce(person.user_id, users[1])
                           WHEN person.user_id IS DISTINCT FROM users[1] THEN users[1] ELSE users[3] END;
        CASE table_name
          WHEN 'profiles' THEN
            predicate := format('id = %L', profile_id);
            insert_statement := format('INSERT INTO public.profiles (id, first_name, last_name) VALUES (%L, ''Inserted'', ''Profile'')',
              CASE WHEN side = 1 AND person.user_id IS NOT NULL THEN person.user_id ELSE insert_user END);
            update_statement := 'first_name = ''Updated profile''';
          WHEN 'businesses' THEN
            predicate := format('id = %L', target_business);
            insert_statement := 'INSERT INTO public.businesses (name) VALUES (''Denied bootstrap'')';
            update_statement := 'name = ''Updated business''';
          WHEN 'business_members' THEN
            predicate := format('id = %L', barber_members[side]);
            insert_statement := format('INSERT INTO public.business_members (business_id, user_id, role) VALUES (%L, %L, ''BARBER'')', target_business, insert_user);
            update_statement := 'role = ''OWNER''';
          WHEN 'business_settings' THEN
            predicate := format('business_id = %L', target_business);
            insert_statement := format('INSERT INTO public.business_settings (business_id) VALUES (%L)', target_business);
            update_statement := 'low_stock_notifications = false';
          WHEN 'business_hours' THEN
            predicate := format('id = %L', hour_ids[side]);
            insert_statement := format('INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time) VALUES (%L, 1, ''09:00'', ''18:00'')', target_business);
            update_statement := 'open_time = ''08:00''';
        END CASE;
        FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
          allowed := person.database_role = 'authenticated' AND CASE
            WHEN table_name = 'profiles' THEN side = 1 AND operation <> 'DELETE'
            WHEN operation = 'SELECT' THEN person.active_business = target_business
            WHEN table_name = 'businesses' THEN operation = 'UPDATE' AND person.active_business = target_business AND person.business_role = 'OWNER'
            WHEN operation = 'DELETE' THEN table_name = 'business_hours' AND person.active_business = target_business AND person.business_role = 'OWNER'
            ELSE person.active_business = target_business AND person.business_role = 'OWNER' END;
          allowed := coalesce(allowed, false);
          expected_count := CASE WHEN allowed THEN 1 ELSE 0 END;
          IF operation = 'SELECT' AND table_name = 'business_members' THEN
            statement := format('SELECT count(*) FROM public.business_members WHERE business_id = %L', target_business);
            IF allowed THEN expected_count := CASE side WHEN 1 THEN 3 ELSE 2 END; END IF;
          ELSE
            statement := CASE operation
              WHEN 'SELECT' THEN format('SELECT count(*) FROM public.%I WHERE %s', table_name, predicate)
              WHEN 'INSERT' THEN insert_statement
              WHEN 'UPDATE' THEN format('UPDATE public.%I SET %s WHERE %s', table_name, update_statement, predicate)
              WHEN 'DELETE' THEN format('DELETE FROM public.%I WHERE %s', table_name, predicate) END;
          END IF;
          BEGIN
            -- Remove PK conflicts administratively so INSERT tests exercise the
            -- authorization boundary rather than uniqueness violations.
            IF operation = 'INSERT' AND table_name = 'profiles' AND side = 1 AND person.user_id IS NOT NULL THEN
              DELETE FROM public.profiles WHERE id = person.user_id;
            ELSIF operation = 'INSERT' AND table_name = 'business_settings' THEN
              DELETE FROM public.business_settings WHERE business_id = target_business;
            END IF;
            PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', person.user_id, 'role', person.database_role)::text, true);
            PERFORM set_config('request.jwt.claim.sub', coalesce(person.user_id::text, ''), true);
            EXECUTE format('SET LOCAL ROLE %I', person.database_role);
            IF auth.uid() IS DISTINCT FROM person.user_id OR current_user <> person.database_role THEN RAISE EXCEPTION 'Identity simulation failed'; END IF;
            BEGIN
              IF operation = 'SELECT' THEN
                EXECUTE statement INTO actual_count;
                IF actual_count <> expected_count THEN RAISE EXCEPTION 'Unexpected visible rows'; END IF;
              ELSE
                EXECUTE statement;
                GET DIAGNOSTICS affected = ROW_COUNT;
                IF operation = 'INSERT' AND NOT allowed THEN RAISE EXCEPTION 'Unauthorized INSERT succeeded'; END IF;
                IF affected <> expected_count THEN RAISE EXCEPTION 'Unexpected affected rows'; END IF;
              END IF;
            EXCEPTION WHEN insufficient_privilege THEN
              GET STACKED DIAGNOSTICS message = MESSAGE_TEXT;
              IF operation <> 'INSERT' OR allowed OR message NOT LIKE '%row-level security%' THEN RAISE; END IF;
            END;
            RESET ROLE;
            RAISE EXCEPTION 'Rollback matrix operation' USING ERRCODE = 'ZB073';
          EXCEPTION WHEN SQLSTATE 'ZB073' THEN NULL;
          WHEN OTHERS THEN
            RAISE EXCEPTION 'Matrix failed: %, %, side %, %: %', person.label, table_name, side, operation, SQLERRM;
          END;
          checks := checks + 1;
        END LOOP;
      END LOOP;
    END LOOP;

    -- BF-076 opens inventory; keep denial coverage on still-closed populated domains.
    -- Keep all 84 denial checks; domain suites cover the newly allowed access.
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', person.user_id, 'role', person.database_role)::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(person.user_id::text, ''), true);
    FOR outside IN
      SELECT * FROM (VALUES
        ('expense_categories', format('INSERT INTO public.expense_categories (business_id, name) VALUES (%L, ''Denied'')', biz[1])),
        ('expenses', format('INSERT INTO public.expenses (business_id, category_id, source_type, description, amount, payment_method, expense_date, created_by) VALUES (%L, %L, ''MANUAL'', ''Denied'', 10, ''CASH'', DATE ''2030-01-07'', %L)', biz[1], closed_category, users[1]))
      ) AS domains(table_name, insert_statement)
    LOOP
      EXECUTE format('SET LOCAL ROLE %I', person.database_role);
      EXECUTE format('SELECT count(*) FROM public.%I', outside.table_name) INTO actual_count;
      IF actual_count <> 0 THEN RAISE EXCEPTION 'Out-of-scope SELECT opened'; END IF;
      EXECUTE format('UPDATE public.%I SET created_at = created_at', outside.table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION 'Out-of-scope UPDATE opened'; END IF;
      EXECUTE format('DELETE FROM public.%I', outside.table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION 'Out-of-scope DELETE opened'; END IF;
      BEGIN
        EXECUTE outside.insert_statement;
        RAISE EXCEPTION 'Out-of-scope INSERT opened';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
      END;
      RESET ROLE;
      outside_checks := outside_checks + 4;
    END LOOP;
  END LOOP;

  -- A dual OWNER satisfies both tenants' role predicates; column privileges
  -- must independently prevent reparenting. Admin positive controls prove that
  -- the same changes would otherwise satisfy FK/UNIQUE constraints.
  BEGIN
    INSERT INTO public.business_members (business_id, user_id, role)
      VALUES (biz[2], users[1], 'OWNER'), (biz[3], users[1], 'OWNER');
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[1], 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', users[1]::text, true);
    FOR target IN SELECT * FROM (VALUES
      ('business_members', format('id = %L', barber_members[1])),
      ('business_settings', format('business_id = %L', biz[1])),
      ('business_hours', format('id = %L', hour_ids[1]))
    ) AS targets(table_name, predicate) LOOP
      statement := format('UPDATE public.%I SET business_id = %L WHERE %s', target.table_name, biz[3], target.predicate);
      BEGIN
        EXECUTE statement;
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Invalid reparenting control'; END IF;
        RAISE EXCEPTION 'Rollback admin control' USING ERRCODE = 'ZB073';
      EXCEPTION WHEN SQLSTATE 'ZB073' THEN NULL; END;
      SET LOCAL ROLE authenticated;
      IF NOT public.has_business_role(biz[1], ARRAY['OWNER']) OR NOT public.has_business_role(biz[3], ARRAY['OWNER']) THEN RAISE EXCEPTION 'Dual OWNER fixture failed'; END IF;
      BEGIN
        EXECUTE statement;
        RAISE EXCEPTION 'Dual OWNER can move a tenant row';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM LIKE '%row-level security%' THEN RAISE EXCEPTION 'Expected column privilege boundary'; END IF;
      END;
      RESET ROLE;
    END LOOP;
    RAISE EXCEPTION 'Rollback dual OWNER' USING ERRCODE = 'ZB073';
  EXCEPTION WHEN SQLSTATE 'ZB073' THEN NULL; END;

  -- WITH CHECK must protect profile identity and business identity, too.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[1], 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', users[1]::text, true);
  SET LOCAL ROLE authenticated;
  FOR target IN SELECT * FROM (VALUES
    (format('UPDATE public.profiles SET id = %L WHERE id = %L', insert_user, users[1])),
    (format('UPDATE public.businesses SET id = %L WHERE id = %L', gen_random_uuid(), biz[1]))
  ) AS targets(statement) LOOP
    BEGIN
      EXECUTE target.statement;
      RAISE EXCEPTION 'Identity WITH CHECK bypassed';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
    END;
  END LOOP;
  RESET ROLE;

  -- No self-OWNER bootstrap, even into an existing business with no members.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[5], 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', users[5]::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.business_members (business_id, user_id, role) VALUES (biz[3], users[5], 'OWNER');
    RAISE EXCEPTION 'Self-OWNER bootstrap opened';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- A BARBER cannot alter their own role, activity or identity.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[2], 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', users[2]::text, true);
  SET LOCAL ROLE authenticated;
  FOREACH update_statement IN ARRAY ARRAY['role = ''OWNER''', 'is_active = false', format('user_id = %L', insert_user)] LOOP
    EXECUTE format('UPDATE public.business_members SET %s WHERE id = %L', update_statement, barber_members[1]);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'BARBER membership escalation'; END IF;
  END LOOP;
  RESET ROLE;

  -- Revocation by an authorized OWNER affects subsequent statements immediately.
  FOR idx IN 1..2 LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[1], 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', users[1]::text, true);
      SET LOCAL ROLE authenticated;
      UPDATE public.business_members SET is_active = false WHERE id = CASE idx WHEN 1 THEN owner_members[1] ELSE barber_members[1] END;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'OWNER cannot deactivate membership'; END IF;
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[idx], 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', users[idx]::text, true);
      IF public.is_business_member(biz[1]) OR public.has_business_role(biz[1], ARRAY['OWNER','BARBER']) THEN RAISE EXCEPTION 'Revoked helper access persists'; END IF;
      FOREACH table_name IN ARRAY ARRAY['businesses','business_members','business_settings','business_hours'] LOOP
        predicate := CASE WHEN table_name = 'businesses' THEN format('id = %L', biz[1]) ELSE format('business_id = %L', biz[1]) END;
        EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', table_name, predicate) INTO actual_count;
        IF actual_count <> 0 THEN RAISE EXCEPTION 'Revoked SELECT persists on %', table_name; END IF;
        EXECUTE format('UPDATE public.%I SET updated_at = updated_at WHERE %s', table_name, predicate);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'Revoked UPDATE persists'; END IF;
        EXECUTE format('DELETE FROM public.%I WHERE %s', table_name, predicate);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'Revoked DELETE persists'; END IF;
      END LOOP;
      BEGIN
        INSERT INTO public.business_hours (business_id, day_of_week, open_time, close_time) VALUES (biz[1], 6, '09:00', '18:00');
        RAISE EXCEPTION 'Revoked INSERT persists';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
      END;
      SELECT count(*) INTO actual_count FROM public.profiles WHERE id = users[idx];
      IF actual_count <> 1 THEN RAISE EXCEPTION 'Membership revocation incorrectly hides own profile'; END IF;
      RESET ROLE;
      RAISE EXCEPTION 'Rollback revocation' USING ERRCODE = 'ZB073';
    EXCEPTION WHEN SQLSTATE 'ZB073' THEN NULL; END;
  END LOOP;
  RAISE NOTICE 'BF-073 passed: % role/tenant CRUD matrix checks, % out-of-scope denials, dual-OWNER reparenting denied, identity WITH CHECK, no self-bootstrap/escalation, immediate OWNER/BARBER revocation, no recursion', checks, outside_checks;
END;
$$;

ROLLBACK;
