\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

DO $$
DECLARE
  policy_names constant text[] := ARRAY[
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
    'purchase_items.purchase_items_select_owners'
  ];
  actual record;
  expected record;
BEGIN
  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename,policyname)
      FROM pg_policies WHERE schemaname = 'public') IS DISTINCT FROM
     (SELECT array_agg(p ORDER BY p) FROM unnest(policy_names) names(p)) THEN
    RAISE EXCEPTION 'Expected exactly the 40 approved policy identities';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('purchases','purchases_select_owners','public.has_business_role(business_id, ARRAY[''OWNER''::text])'),
    ('purchase_items','purchase_items_select_owners',$policy$(EXISTS ( SELECT 1
      FROM public.purchases purchase
      WHERE ((purchase.id = purchase_items.purchase_id) AND public.has_business_role(purchase.business_id, ARRAY['OWNER'::text]))))$policy$)
  ) policies(table_name,policy_name,expression) LOOP
    SELECT * INTO STRICT actual FROM pg_policies WHERE schemaname = 'public'
      AND tablename = expected.table_name AND policyname = expected.policy_name;
    IF actual.cmd <> 'SELECT' OR actual.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
       OR actual.permissive <> 'PERMISSIVE' OR actual.with_check IS NOT NULL
       OR regexp_replace(actual.qual,'[[:space:]]','','g') IS DISTINCT FROM
          regexp_replace(expected.expression,'[[:space:]]','','g') THEN
      RAISE EXCEPTION 'Incorrect BF-078 policy: %',expected.policy_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')) <> 19
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
                  AND (NOT c.relrowsecurity OR c.relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                AND tablename IN ('expense_categories','expenses')) THEN
    RAISE EXCEPTION 'RLS/FORCE/future table baseline changed';
  END IF;
  IF (SELECT array_agg(n.nspname || '.' || p.proname ORDER BY n.nspname,p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private')) IS DISTINCT FROM ARRAY[
        'private.can_read_payment','public.has_business_role','public.is_business_member',
        'public.prevent_stock_movement_changes','public.set_updated_at']::text[]
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('public','private') AND p.prosecdef) <> 3 THEN
    RAISE EXCEPTION 'Unexpected function/definer change';
  END IF;
  RAISE NOTICE 'BF-078 metadata passed: exact 40 policy identities, two authenticated SELECT-only OWNER policies, 19 RLS tables/FORCE off, two expense tables closed, existing five functions/three definers';
END;
$$;

DO $$
DECLARE
  users uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,7));
  biz uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  product_ids uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  category_ids uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  purchase_ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,6));
  line_ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,12));
  baseline jsonb := '{}'::jsonb;
  rows jsonb;
  person record;
  table_name text;
  operation text;
  statement text;
  insert_statement text;
  update_statement text;
  row_id uuid;
  side integer;
  idx integer;
  parent_idx integer;
  row_total integer;
  actual_count bigint;
  affected bigint;
  expected_count bigint;
  checks integer := 0;
  future_checks integer := 0;
  lifecycle_checks integer := 0;
BEGIN
  INSERT INTO auth.users (id) SELECT unnest(users);
  INSERT INTO public.businesses (id,name) VALUES (biz[1],'BF078 A'),(biz[2],'BF078 B');
  -- OWNER A/B/AB, BARBER A/B, nonmember, inactive OWNER A.
  INSERT INTO public.business_members (business_id,user_id,role,is_active) VALUES
    (biz[1],users[1],'OWNER',true),(biz[2],users[2],'OWNER',true),
    (biz[1],users[3],'OWNER',true),(biz[2],users[3],'OWNER',true),
    (biz[1],users[4],'BARBER',true),(biz[2],users[5],'BARBER',true),
    (biz[1],users[7],'OWNER',false);
  FOR side IN 1..2 LOOP
    INSERT INTO public.products (id,business_id,name,sale_price,default_purchase_cost)
      VALUES (product_ids[side],biz[side],'Product',20,4);
    INSERT INTO public.expense_categories (id,business_id,name)
      VALUES (category_ids[side],biz[side],'Closed category');
    INSERT INTO public.expenses (business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
      VALUES (biz[side],category_ids[side],'MANUAL','Closed expense',10,'CASH',DATE '2030-01-07',users[side]);
  END LOOP;
  FOR idx IN 1..6 LOOP
    side := CASE WHEN idx <= 3 THEN 1 ELSE 2 END;
    -- BARBER-created rows must still be hidden from that BARBER.
    INSERT INTO public.purchases (id,business_id,operation_id,supplier,status,total,created_by)
      VALUES (purchase_ids[idx],biz[side],gen_random_uuid(),'Supplier',
        (ARRAY['DRAFT','COMPLETED','VOIDED'])[(idx-1)%3+1],20,users[side+3]);
    -- Two lines per parent. The second deliberately references a
    -- product in the other business: read authorization follows the purchase,
    -- never product visibility. Cross-tenant write integrity is a future concern.
    INSERT INTO public.purchase_items (id,purchase_id,product_id,product_name_snapshot,quantity,unit_cost_snapshot,line_total)
      VALUES (line_ids[idx*2-1],purchase_ids[idx],product_ids[side],'Snapshot',2,5,10),
             (line_ids[idx*2],purchase_ids[idx],product_ids[3-side],'Other product snapshot',2,5,10);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['purchases','purchase_items','products','expense_categories','expenses','stock_movements'] LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), ''[]''::jsonb) FROM public.%I t',table_name) INTO rows;
    baseline := baseline || jsonb_build_object(table_name,rows);
  END LOOP;

  FOR person IN SELECT * FROM (VALUES
    (users[1],ARRAY[1],'authenticated','Owner A'),
    (users[2],ARRAY[2],'authenticated','Owner B'),
    (users[3],ARRAY[1,2],'authenticated','Owner AB'),
    (users[4],ARRAY[]::integer[],'authenticated','Barber A'),
    (users[5],ARRAY[]::integer[],'authenticated','Barber B'),
    (users[6],ARRAY[]::integer[],'authenticated','No membership'),
    (users[7],ARRAY[]::integer[],'authenticated','Inactive owner'),
    (NULL::uuid,ARRAY[]::integer[],'anon','Anonymous')
  ) people(user_id,owner_sides,database_role,label) LOOP
    FOREACH table_name IN ARRAY ARRAY['purchases','purchase_items'] LOOP
      row_total := CASE table_name WHEN 'purchases' THEN 6 ELSE 12 END;
      FOR idx IN 1..row_total LOOP
        parent_idx := CASE table_name WHEN 'purchases' THEN idx ELSE (idx+1)/2 END;
        side := CASE WHEN parent_idx <= 3 THEN 1 ELSE 2 END;
        row_id := CASE table_name WHEN 'purchases' THEN purchase_ids[idx] ELSE line_ids[idx] END;
        expected_count := CASE WHEN side = ANY(person.owner_sides) THEN 1 ELSE 0 END;
        insert_statement := CASE table_name WHEN 'purchases' THEN
          format('INSERT INTO public.purchases (business_id,operation_id,supplier,total,created_by) VALUES (%L,gen_random_uuid(),''Valid supplier'',20,%L)',biz[side],coalesce(person.user_id,users[1]))
          ELSE format('INSERT INTO public.purchase_items (purchase_id,product_id,product_name_snapshot,quantity,unit_cost_snapshot,line_total) VALUES (%L,%L,''Valid snapshot'',2,5,10)',purchase_ids[parent_idx],product_ids[side]) END;
        update_statement := CASE table_name WHEN 'purchases' THEN
          format('UPDATE public.purchases SET business_id = %L,operation_id = gen_random_uuid(),supplier = ''Changed supplier'',status = ''COMPLETED'',total = 30,purchased_at = now(),notes = ''Changed'',created_by = %L WHERE id = %L',biz[3-side],users[1],row_id)
          ELSE format('UPDATE public.purchase_items SET purchase_id = %L,product_id = %L,product_name_snapshot = ''Changed'',quantity = 3,unit_cost_snapshot = 6,line_total = 18 WHERE id = %L',purchase_ids[4],product_ids[2],row_id) END;
        FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
          statement := CASE operation WHEN 'SELECT' THEN format('SELECT count(*) FROM public.%I WHERE id = %L',table_name,row_id)
            WHEN 'INSERT' THEN insert_statement WHEN 'UPDATE' THEN update_statement
            ELSE format('DELETE FROM public.%I WHERE id = %L',table_name,row_id) END;
          BEGIN
            PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role',person.database_role)::text,true);
            PERFORM set_config('request.jwt.claim.sub',coalesce(person.user_id::text,''),true);
            EXECUTE format('SET LOCAL ROLE %I',person.database_role);
            IF auth.uid() IS DISTINCT FROM person.user_id OR current_user <> person.database_role THEN RAISE EXCEPTION 'Invalid effective identity'; END IF;
            BEGIN
              IF operation = 'SELECT' THEN
                EXECUTE statement INTO actual_count;
                IF actual_count <> expected_count THEN RAISE EXCEPTION 'Unexpected visibility: expected %, got %',expected_count,actual_count; END IF;
              ELSE
                EXECUTE statement;
                GET DIAGNOSTICS affected = ROW_COUNT;
                IF operation = 'INSERT' OR affected <> 0 THEN RAISE EXCEPTION 'Direct purchase write succeeded'; END IF;
              END IF;
            EXCEPTION WHEN insufficient_privilege THEN
              IF operation <> 'INSERT' OR SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
            END;
            RESET ROLE;
            RAISE EXCEPTION 'Rollback action' USING ERRCODE = 'ZB078';
          EXCEPTION WHEN SQLSTATE 'ZB078' THEN NULL;
            WHEN OTHERS THEN RAISE EXCEPTION 'BF078 %, %, row %, %: %',person.label,table_name,idx,operation,SQLERRM;
          END;
          checks := checks + 1;
        END LOOP;
      END LOOP;
    END LOOP;

    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role',person.database_role)::text,true);
    PERFORM set_config('request.jwt.claim.sub',coalesce(person.user_id::text,''),true);
    EXECUTE format('SET LOCAL ROLE %I',person.database_role);
    FOREACH table_name IN ARRAY ARRAY['expense_categories','expenses'] LOOP
      EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO actual_count;
      IF actual_count <> 0 THEN RAISE EXCEPTION 'Future expense SELECT opened'; END IF;
      EXECUTE format('UPDATE public.%I SET created_at = created_at',table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION 'Future expense UPDATE opened'; END IF;
      EXECUTE format('DELETE FROM public.%I',table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION 'Future expense DELETE opened'; END IF;
      BEGIN
        IF table_name = 'expense_categories' THEN
          INSERT INTO public.expense_categories (business_id,name) VALUES (biz[1],'Denied');
        ELSE
          INSERT INTO public.expenses (business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
            VALUES (biz[1],category_ids[1],'MANUAL','Denied',10,'CASH',DATE '2030-01-07',users[1]);
        END IF;
        RAISE EXCEPTION 'Future expense INSERT opened';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
      END;
      future_checks := future_checks + 4;
    END LOOP;
    RESET ROLE;
  END LOOP;

  -- Membership changes are privileged fixture actions. Each subsequent query
  -- uses a new statement snapshot; no change to the helpers is required.
  FOR idx IN 1..3 LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[idx],'role','authenticated')::text,true);
      PERFORM set_config('request.jwt.claim.sub',users[idx]::text,true);
      UPDATE public.business_members SET is_active = false WHERE user_id = users[idx];
      SET LOCAL ROLE authenticated;
      FOREACH table_name IN ARRAY ARRAY['purchases','purchase_items'] LOOP
        EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO actual_count;
        IF actual_count <> 0 THEN RAISE EXCEPTION 'Inactive OWNER access persists'; END IF;
        lifecycle_checks := lifecycle_checks + 1;
      END LOOP;
      RESET ROLE;
      UPDATE public.business_members SET is_active = true WHERE user_id = users[idx];
      SET LOCAL ROLE authenticated;
      FOREACH table_name IN ARRAY ARRAY['purchases','purchase_items'] LOOP
        EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO actual_count;
        expected_count := (CASE WHEN idx = 3 THEN 2 ELSE 1 END) * (CASE table_name WHEN 'purchases' THEN 3 ELSE 6 END);
        IF actual_count <> expected_count THEN RAISE EXCEPTION 'Reactivated OWNER scope differs'; END IF;
        lifecycle_checks := lifecycle_checks + 1;
      END LOOP;
      RESET ROLE;
      UPDATE public.business_members SET role = 'BARBER' WHERE user_id = users[idx];
      SET LOCAL ROLE authenticated;
      FOREACH table_name IN ARRAY ARRAY['purchases','purchase_items'] LOOP
        EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO actual_count;
        IF actual_count <> 0 THEN RAISE EXCEPTION 'Downgraded BARBER retains purchase access'; END IF;
        lifecycle_checks := lifecycle_checks + 1;
      END LOOP;
      RESET ROLE;
      RAISE EXCEPTION 'Rollback membership change' USING ERRCODE = 'ZB078';
    EXCEPTION WHEN SQLSTATE 'ZB078' THEN NULL; END;
  END LOOP;

  SET LOCAL ROLE service_role;
  IF (SELECT count(*) FROM public.purchases) <> 6 OR (SELECT count(*) FROM public.purchase_items) <> 12 THEN
    RAISE EXCEPTION 'Service role purchase visibility changed';
  END IF;
  RESET ROLE;
  FOREACH table_name IN ARRAY ARRAY['purchases','purchase_items','products','expense_categories','expenses','stock_movements'] LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), ''[]''::jsonb) FROM public.%I t',table_name) INTO rows;
    IF rows IS DISTINCT FROM baseline -> table_name THEN RAISE EXCEPTION 'Fixture/side effect changed: %',table_name; END IF;
  END LOOP;
  IF checks <> 576 OR future_checks <> 64 OR lifecycle_checks <> 18 THEN RAISE EXCEPTION 'Incomplete BF078 checks'; END IF;
  RAISE NOTICE 'BF-078 passed: % role/parent/status CRUD checks, % future expense denials, % OWNER revoke/reactivate/downgrade checks; OWNER A/B/AB isolation, BARBER own-created purchases hidden, all statuses, product-independent parent authorization, service_role and unchanged fixtures',checks,future_checks,lifecycle_checks;
END;
$$;

ROLLBACK;
