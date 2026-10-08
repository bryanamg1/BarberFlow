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
    'purchase_items.purchase_items_select_owners',
    'expense_categories.expense_categories_select_owners',
    'expense_categories.expense_categories_insert_owners',
    'expense_categories.expense_categories_update_owners',
    'expenses.expenses_select_owners',
    'expenses.expenses_insert_manual_owners',
    'expenses.expenses_update_manual_owners'
  ];
  expected record;
  actual record;
  col record;
BEGIN
  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename,policyname)
      FROM pg_policies WHERE schemaname = 'public') IS DISTINCT FROM
     (SELECT array_agg(p ORDER BY p) FROM unnest(policy_names) names(p)) THEN
    RAISE EXCEPTION 'Expected exactly the 46 approved public policy identities';
  END IF;
  -- Independent literal metadata oracle: every cast/operator/correlation matters.
  FOR expected IN SELECT * FROM (VALUES
    ('expense_categories','expense_categories_select_owners','SELECT',
      $p$public.has_business_role(business_id, ARRAY['OWNER'::text])$p$,NULL),
    ('expense_categories','expense_categories_insert_owners','INSERT',NULL,
      $p$public.has_business_role(business_id, ARRAY['OWNER'::text])$p$),
    ('expense_categories','expense_categories_update_owners','UPDATE',
      $p$public.has_business_role(business_id, ARRAY['OWNER'::text])$p$,
      $p$public.has_business_role(business_id, ARRAY['OWNER'::text])$p$),
    ('expenses','expenses_select_owners','SELECT',
      $p$(public.has_business_role(business_id, ARRAY['OWNER'::text]) AND (EXISTS ( SELECT 1 FROM public.expense_categories category WHERE ((category.id = expenses.category_id) AND (category.business_id = expenses.business_id)))) AND ((source_type = 'MANUAL'::text) OR (EXISTS ( SELECT 1 FROM public.purchases purchase WHERE ((purchase.id = expenses.purchase_id) AND (purchase.business_id = expenses.business_id))))))$p$,NULL),
    ('expenses','expenses_insert_manual_owners','INSERT',NULL,
      $p$(public.has_business_role(business_id, ARRAY['OWNER'::text]) AND (source_type = 'MANUAL'::text) AND (purchase_id IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM public.expense_categories category WHERE ((category.id = expenses.category_id) AND (category.business_id = expenses.business_id)))))$p$),
    ('expenses','expenses_update_manual_owners','UPDATE',
      $p$(public.has_business_role(business_id, ARRAY['OWNER'::text]) AND (source_type = 'MANUAL'::text) AND (purchase_id IS NULL))$p$,
      $p$(public.has_business_role(business_id, ARRAY['OWNER'::text]) AND (source_type = 'MANUAL'::text) AND (purchase_id IS NULL) AND (EXISTS ( SELECT 1 FROM public.expense_categories category WHERE ((category.id = expenses.category_id) AND (category.business_id = expenses.business_id)))))$p$)
  ) policies(table_name,policy_name,command,qual,check_expr) LOOP
    SELECT * INTO STRICT actual FROM pg_policies WHERE schemaname = 'public'
      AND tablename = expected.table_name AND policyname = expected.policy_name;
    IF actual.cmd <> expected.command OR actual.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
       OR actual.permissive <> 'PERMISSIVE'
       OR regexp_replace(actual.qual,'[[:space:]]','','g') IS DISTINCT FROM regexp_replace(expected.qual,'[[:space:]]','','g')
       OR regexp_replace(actual.with_check,'[[:space:]]','','g') IS DISTINCT FROM regexp_replace(expected.check_expr,'[[:space:]]','','g') THEN
      RAISE EXCEPTION 'Incorrect BF079 policy: %',expected.policy_name;
    END IF;
  END LOOP;
  FOR col IN SELECT c.oid,c.relname,a.attname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relname IN ('expense_categories','expenses')
      AND a.attnum>0 AND NOT a.attisdropped LOOP
    IF has_column_privilege('authenticated',col.oid,col.attname,'UPDATE') IS DISTINCT FROM
       (CASE col.relname WHEN 'expense_categories' THEN col.attname <> 'business_id'
         ELSE col.attname = ANY(ARRAY['category_id','description','amount','payment_method','expense_date','receipt_path','notes']) END)
       OR NOT has_column_privilege('anon',col.oid,col.attname,'UPDATE')
       OR NOT has_column_privilege('service_role',col.oid,col.attname,'UPDATE') THEN
      RAISE EXCEPTION 'Incorrect column privileges: %.%',col.relname,col.attname;
    END IF;
  END LOOP;
  FOR actual IN SELECT oid,relname FROM pg_class WHERE oid IN ('public.expense_categories'::regclass,'public.expenses'::regclass) LOOP
    IF has_table_privilege('authenticated',actual.oid,'UPDATE') THEN RAISE EXCEPTION 'Broad UPDATE grant retained'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) <> 19
     OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (NOT c.relrowsecurity OR c.relforcerowsecurity OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=c.relname))) THEN
    RAISE EXCEPTION 'All 19 public tables must have policies and RLS without FORCE';
  END IF;
  IF (SELECT array_agg(n.nspname || '.' || p.proname ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')) IS DISTINCT FROM ARRAY['private.can_read_payment','public.has_business_role','public.is_business_member','public.prevent_stock_movement_changes','public.set_updated_at']::text[]
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prosecdef) <> 3 THEN
    RAISE EXCEPTION 'Helper/definer baseline changed';
  END IF;
  RAISE NOTICE 'BF079 metadata passed: exact 46 policies, six exact authenticated policies, exact approved UPDATE columns, all 19 tables RLS/FORCE off, unchanged function inventory';
END;
$$;

DO $$
DECLARE
  users uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,7));
  biz uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  cats uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,4));
  purchase_ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,8));
  expense_ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,8));
  baseline jsonb := '{}'::jsonb;
  rows jsonb;
  person record;
  scenario record;
  table_name text;
  operation text;
  statement text;
  row_id uuid;
  side integer;
  idx integer;
  actor integer;
  row_total integer;
  allowed boolean;
  visible boolean;
  is_manual boolean;
  expected_count bigint;
  actual_count bigint;
  affected bigint;
  checks integer := 0;
  boundary_checks integer := 0;
  column_checks integer := 0;
  lifecycle_checks integer := 0;
BEGIN
  INSERT INTO auth.users(id) SELECT unnest(users);
  INSERT INTO public.businesses(id,name) VALUES(biz[1],'BF079 A'),(biz[2],'BF079 B');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (biz[1],users[1],'OWNER',true),(biz[2],users[2],'OWNER',true),
    (biz[1],users[3],'OWNER',true),(biz[2],users[3],'OWNER',true),
    (biz[1],users[4],'BARBER',true),(biz[2],users[5],'BARBER',true),(biz[1],users[7],'OWNER',false);
  FOR idx IN 1..4 LOOP
    side := CASE WHEN idx<=2 THEN 1 ELSE 2 END;
    INSERT INTO public.expense_categories(id,business_id,name,is_active)
      VALUES(cats[idx],biz[side],'Category',idx%2=1);
  END LOOP;
  FOR idx IN 1..8 LOOP
    side := (idx-1)%2+1;
    INSERT INTO public.purchases(id,business_id,operation_id,supplier,total,created_by)
      VALUES(purchase_ids[idx],biz[side],gen_random_uuid(),'Supplier',10,users[side]);
  END LOOP;
  -- Four consistent records then four deliberately inconsistent privileged fixtures.
  -- Creators are BARBERs: OWNER write authorization is independent of the creator.
  FOR idx IN 1..8 LOOP
    side := (ARRAY[1,1,2,2,1,1,2,2])[idx];
    is_manual := idx IN (1,3,5,8);
    INSERT INTO public.expenses(id,business_id,category_id,source_type,purchase_id,description,amount,payment_method,expense_date,created_by,created_at,updated_at)
      VALUES(expense_ids[idx],biz[side],cats[(ARRAY[2,2,3,3,3,2,2,2])[idx]],
        CASE WHEN is_manual THEN 'MANUAL' ELSE 'PURCHASE' END,
        CASE idx WHEN 2 THEN purchase_ids[1] WHEN 4 THEN purchase_ids[2] WHEN 6 THEN purchase_ids[4] WHEN 7 THEN purchase_ids[6] ELSE NULL END,
        'Expense',10,(ARRAY['CASH','TRANSFER','DEBIT','CREDIT','OTHER'])[(idx-1)%5+1],DATE '2030-01-07',users[side+3],'2000-01-01Z','2000-01-01Z');
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['expense_categories','expenses','purchases','products','stock_movements'] LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),''[]''::jsonb) FROM public.%I t',table_name) INTO rows;
    baseline := baseline || jsonb_build_object(table_name,rows);
  END LOOP;
  FOR person IN SELECT * FROM (VALUES
    (users[1],ARRAY[1],'authenticated','Owner A'),(users[2],ARRAY[2],'authenticated','Owner B'),
    (users[3],ARRAY[1,2],'authenticated','Owner AB'),(users[4],ARRAY[]::integer[],'authenticated','Barber A'),
    (users[5],ARRAY[]::integer[],'authenticated','Barber B'),(users[6],ARRAY[]::integer[],'authenticated','Nonmember'),
    (users[7],ARRAY[]::integer[],'authenticated','Inactive owner'),(NULL::uuid,ARRAY[]::integer[],'anon','Anonymous')
  ) people(user_id,owner_sides,database_role,label) LOOP
    FOREACH table_name IN ARRAY ARRAY['expense_categories','expenses'] LOOP
      row_total := CASE table_name WHEN 'expense_categories' THEN 4 ELSE 8 END;
      FOR idx IN 1..row_total LOOP
        side := CASE table_name WHEN 'expense_categories' THEN CASE WHEN idx<=2 THEN 1 ELSE 2 END
          ELSE (ARRAY[1,1,2,2,1,1,2,2])[idx] END;
        row_id := CASE table_name WHEN 'expense_categories' THEN cats[idx] ELSE expense_ids[idx] END;
        visible := side=ANY(person.owner_sides) AND (table_name='expense_categories' OR idx<=4);
        is_manual := table_name='expenses' AND idx IN(1,3,5,8);
        FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
          allowed := CASE operation WHEN 'SELECT' THEN visible WHEN 'DELETE' THEN false
            WHEN 'UPDATE' THEN visible AND (table_name='expense_categories' OR is_manual)
            ELSE side=ANY(person.owner_sides) AND (table_name='expense_categories' OR (is_manual AND idx<=4)) END;
          statement := CASE operation WHEN 'SELECT' THEN format('SELECT count(*) FROM public.%I WHERE id=%L',table_name,row_id)
            WHEN 'DELETE' THEN CASE table_name WHEN 'expense_categories' THEN format('DELETE FROM public.expense_categories WHERE id=%L',cats[CASE side WHEN 1 THEN 1 ELSE 4 END]) ELSE format('DELETE FROM public.expenses WHERE id=%L',row_id) END
            WHEN 'UPDATE' THEN CASE table_name WHEN 'expense_categories' THEN format('UPDATE public.expense_categories SET name=''Edited category'',is_active=NOT is_active WHERE id=%L',row_id)
              ELSE format('UPDATE public.expenses SET category_id=%L,description=''Edited manual'',amount=12,payment_method=''OTHER'',expense_date=DATE ''2031-02-03'',receipt_path=''metadata/receipt'',notes=''Edited notes'' WHERE id=%L',cats[CASE side WHEN 1 THEN 2 ELSE 3 END],row_id) END
            ELSE CASE table_name WHEN 'expense_categories' THEN format('INSERT INTO public.expense_categories(business_id,name) VALUES(%L,''New category'')',biz[side])
              ELSE format('INSERT INTO public.expenses(business_id,category_id,source_type,purchase_id,description,amount,payment_method,expense_date,created_by) VALUES(%L,%L,%L,%L,''New expense'',10,''CASH'',DATE ''2030-01-07'',%L)',biz[side],cats[(ARRAY[2,2,3,3,3,2,2,2])[idx]],CASE WHEN is_manual THEN 'MANUAL' ELSE 'PURCHASE' END,CASE WHEN is_manual THEN NULL ELSE purchase_ids[side+6] END,coalesce(person.user_id,users[1])) END END;
          -- Every matrix write is schema-valid under a privileged role.
          BEGIN
            IF operation<>'SELECT' THEN EXECUTE statement; GET DIAGNOSTICS affected=ROW_COUNT;
              IF affected<>1 THEN RAISE EXCEPTION 'Invalid privileged write control'; END IF; END IF;
            RAISE EXCEPTION 'Rollback admin control' USING ERRCODE='ZB079';
          EXCEPTION WHEN SQLSTATE 'ZB079' THEN NULL; END;
          BEGIN
            PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role',person.database_role)::text,true);
            PERFORM set_config('request.jwt.claim.sub',coalesce(person.user_id::text,''),true);
            EXECUTE format('SET LOCAL ROLE %I',person.database_role);
            IF auth.uid() IS DISTINCT FROM person.user_id OR current_user<>person.database_role THEN RAISE EXCEPTION 'Wrong effective role'; END IF;
            BEGIN
              expected_count := CASE WHEN allowed THEN 1 ELSE 0 END;
              IF operation='SELECT' THEN EXECUTE statement INTO actual_count;
                IF actual_count<>expected_count THEN RAISE EXCEPTION 'Visibility expected %, got %',expected_count,actual_count; END IF;
              ELSE
                EXECUTE statement; GET DIAGNOSTICS affected=ROW_COUNT;
                IF (operation='INSERT' AND NOT allowed) OR affected<>expected_count THEN RAISE EXCEPTION 'Unexpected write count'; END IF;
                IF allowed AND operation='UPDATE' THEN
                  IF table_name='expenses' THEN
                    SELECT count(*) INTO actual_count FROM public.expenses WHERE id=row_id AND description='Edited manual' AND amount=12 AND payment_method='OTHER' AND expense_date=DATE '2031-02-03' AND receipt_path='metadata/receipt' AND notes='Edited notes' AND category_id=cats[CASE side WHEN 1 THEN 2 ELSE 3 END] AND created_by=users[side+3] AND created_at=TIMESTAMPTZ '2000-01-01Z' AND updated_at=transaction_timestamp();
                  ELSE SELECT count(*) INTO actual_count FROM public.expense_categories WHERE id=row_id AND name='Edited category'; END IF;
                  IF actual_count<>1 THEN RAISE EXCEPTION 'Allowed UPDATE fields/trigger/audit mismatch'; END IF;
                END IF;
              END IF;
            EXCEPTION WHEN insufficient_privilege THEN
              IF operation<>'INSERT' OR allowed OR SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
            END;
            RESET ROLE;
            RAISE EXCEPTION 'Rollback action' USING ERRCODE='ZB079';
          EXCEPTION WHEN SQLSTATE 'ZB079' THEN NULL;
            WHEN OTHERS THEN RAISE EXCEPTION 'BF079 %, %, row %, %: %',person.label,table_name,idx,operation,SQLERRM; END;
          checks := checks+1;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  -- OWNER AB can see both referenced tenants; only exact correlation rejects these.
  FOR actor IN 1..3 LOOP
    side := CASE actor WHEN 2 THEN 2 ELSE 1 END;
    FOR scenario IN SELECT * FROM (VALUES
      (format('UPDATE public.expenses SET category_id=%L WHERE id=%L',cats[CASE side WHEN 1 THEN 3 ELSE 2 END],expense_ids[CASE side WHEN 1 THEN 1 ELSE 3 END]),'Cross-tenant UPDATE'),
      (format('INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by) VALUES(%L,%L,''MANUAL'',''Spoof creator'',10,''CASH'',DATE ''2030-01-07'',%L)',biz[side],cats[CASE side WHEN 1 THEN 2 ELSE 3 END],users[4]),'Creator spoof')
    ) cases(statement,label) LOOP
      BEGIN
        EXECUTE scenario.statement;
        RAISE EXCEPTION 'Rollback positive control' USING ERRCODE='ZB079';
      EXCEPTION WHEN SQLSTATE 'ZB079' THEN NULL; END;
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[actor],'role','authenticated')::text,true);
      PERFORM set_config('request.jwt.claim.sub',users[actor]::text,true);
      SET LOCAL ROLE authenticated;
      BEGIN EXECUTE scenario.statement; RAISE EXCEPTION 'Boundary allowed: %',scenario.label;
      EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF; END;
      RESET ROLE;
      boundary_checks := boundary_checks+1;
    END LOOP;
  END LOOP;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[3],'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',users[3]::text,true);
  FOR scenario IN SELECT * FROM (VALUES
    (format('UPDATE public.expense_categories SET business_id=%L WHERE id=%L',biz[2],cats[1])),
    (format('UPDATE public.expenses SET id=gen_random_uuid() WHERE id=%L',expense_ids[1])),
    (format('UPDATE public.expenses SET business_id=%L WHERE id=%L',biz[2],expense_ids[1])),
    (format('UPDATE public.expenses SET source_type=''PURCHASE'',purchase_id=%L WHERE id=%L',purchase_ids[7],expense_ids[1])),
    (format('UPDATE public.expenses SET purchase_id=%L,source_type=''PURCHASE'' WHERE id=%L',purchase_ids[7],expense_ids[1])),
    (format('UPDATE public.expenses SET created_by=%L WHERE id=%L',users[2],expense_ids[1])),
    (format('UPDATE public.expenses SET created_at=now() WHERE id=%L',expense_ids[1])),
    (format('UPDATE public.expenses SET updated_at=now() WHERE id=%L',expense_ids[1]))
  ) cases(statement) LOOP
    BEGIN EXECUTE scenario.statement; RAISE EXCEPTION 'Rollback valid control' USING ERRCODE='ZB079';
    EXCEPTION WHEN SQLSTATE 'ZB079' THEN NULL; END;
    SET LOCAL ROLE authenticated;
    BEGIN EXECUTE scenario.statement; RAISE EXCEPTION 'Protected column changed';
    EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%permission denied%' OR SQLERRM LIKE '%row-level security%' THEN RAISE; END IF; END;
    RESET ROLE;
    column_checks := column_checks+1;
  END LOOP;

  FOR actor IN 1..3 LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[actor],'role','authenticated')::text,true);
      PERFORM set_config('request.jwt.claim.sub',users[actor]::text,true);
      UPDATE public.business_members SET is_active=false WHERE user_id=users[actor];
      SET LOCAL ROLE authenticated;
      IF (SELECT count(*) FROM public.expense_categories)<>0 OR (SELECT count(*) FROM public.expenses)<>0 THEN RAISE EXCEPTION 'Revoked OWNER read persists'; END IF;
      RESET ROLE; lifecycle_checks := lifecycle_checks+2;
      UPDATE public.business_members SET is_active=true WHERE user_id=users[actor];
      SET LOCAL ROLE authenticated;
      expected_count := CASE actor WHEN 3 THEN 4 ELSE 2 END;
      IF (SELECT count(*) FROM public.expense_categories)<>expected_count OR (SELECT count(*) FROM public.expenses)<>expected_count THEN RAISE EXCEPTION 'Restored OWNER scope differs'; END IF;
      RESET ROLE; lifecycle_checks := lifecycle_checks+2;
      UPDATE public.business_members SET role='BARBER' WHERE user_id=users[actor];
      SET LOCAL ROLE authenticated;
      IF (SELECT count(*) FROM public.expense_categories)<>0 OR (SELECT count(*) FROM public.expenses)<>0 THEN RAISE EXCEPTION 'Downgraded BARBER read persists'; END IF;
      RESET ROLE; lifecycle_checks := lifecycle_checks+2;
      RAISE EXCEPTION 'Rollback lifecycle' USING ERRCODE='ZB079';
    EXCEPTION WHEN SQLSTATE 'ZB079' THEN NULL; END;
  END LOOP;
  SET LOCAL ROLE service_role;
  IF (SELECT count(*) FROM public.expenses)<>8 OR (SELECT count(*) FROM public.expense_categories)<>4 THEN RAISE EXCEPTION 'Service role access changed'; END IF;
  RESET ROLE;
  FOREACH table_name IN ARRAY ARRAY['expense_categories','expenses','purchases','products','stock_movements'] LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),''[]''::jsonb) FROM public.%I t',table_name) INTO rows;
    IF rows IS DISTINCT FROM baseline->table_name THEN RAISE EXCEPTION 'Unexpected side effect: %',table_name; END IF;
  END LOOP;
  IF checks<>384 OR boundary_checks<>6 OR column_checks<>8 OR lifecycle_checks<>18 THEN RAISE EXCEPTION 'Incomplete BF079 execution'; END IF;
  RAISE NOTICE 'BF079 passed: % effective-role CRUD checks, % tenant/creator boundaries, % protected-column denials, % lifecycle checks; archived categories, MANUAL seven fields/trigger, PURCHASE read only, OWNER AB inconsistent fixtures hidden, unchanged fixtures',checks,boundary_checks,column_checks,lifecycle_checks;
END;
$$;
ROLLBACK;
