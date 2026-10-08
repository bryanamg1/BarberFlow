\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

DO $$
DECLARE
  expected record;
  actual record;
  helper record;
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 40
     OR (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename,policyname)
         FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('sales','sale_items','payments'))
        IS DISTINCT FROM ARRAY['payments.payments_select_authorized',
          'sale_items.sale_items_select_authorized','sales.sales_select_authorized']::text[] THEN
    RAISE EXCEPTION 'Expected exactly 40 public policies and three BF-077 SELECT identities';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('sales','sales_select_authorized',$policy$(public.has_business_role(business_id, ARRAY['OWNER'::text]) OR (public.has_business_role(business_id, ARRAY['BARBER'::text]) AND (created_by = ( SELECT auth.uid() AS uid))))$policy$),
    ('sale_items','sale_items_select_authorized',$policy$(EXISTS ( SELECT 1
      FROM public.sales sale
      WHERE ((sale.id = sale_items.sale_id) AND (public.has_business_role(sale.business_id, ARRAY['OWNER'::text]) OR (public.has_business_role(sale.business_id, ARRAY['BARBER'::text]) AND (sale.created_by = ( SELECT auth.uid() AS uid)))))))$policy$),
    ('payments','payments_select_authorized','private.can_read_payment(id)')
  ) AS policies(table_name,policy_name,expression) LOOP
    SELECT * INTO STRICT actual FROM pg_policies WHERE schemaname = 'public'
      AND tablename = expected.table_name AND policyname = expected.policy_name;
    IF actual.cmd <> 'SELECT' OR actual.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
       OR actual.permissive <> 'PERMISSIVE' OR actual.with_check IS NOT NULL
       OR regexp_replace(actual.qual,'[[:space:]]','','g') IS DISTINCT FROM
          regexp_replace(expected.expression,'[[:space:]]','','g') THEN
      RAISE EXCEPTION 'Incorrect BF-077 policy: %',expected.policy_name;
    END IF;
  END LOOP;
  SELECT p.*,n.nspowner INTO STRICT helper FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.oid = 'private.can_read_payment(uuid)'::regprocedure;
  IF helper.prorettype <> 'boolean'::regtype OR helper.proretset
     OR helper.pronargs <> 1 OR helper.proargtypes::text <> '2950'
     OR helper.proargnames IS DISTINCT FROM ARRAY['target_payment_id']::text[]
     OR NOT helper.prosecdef OR helper.provolatile <> 's'
     OR helper.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR helper.proowner <> (SELECT relowner FROM pg_class WHERE oid = 'public.sales'::regclass)
     OR helper.proowner <> (SELECT relowner FROM pg_class WHERE oid = 'public.payments'::regclass)
     OR helper.proowner <> helper.nspowner
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'private') <> 1 THEN
    RAISE EXCEPTION 'Incorrect private boolean helper signature/execution context';
  END IF;
  IF NOT has_function_privilege('authenticated',helper.oid,'EXECUTE')
     OR has_function_privilege('anon',helper.oid,'EXECUTE')
     OR has_function_privilege('service_role',helper.oid,'EXECUTE')
     OR EXISTS (SELECT 1 FROM aclexplode(helper.proacl) acl
                WHERE acl.privilege_type <> 'EXECUTE' OR acl.is_grantable
                   OR acl.grantee NOT IN (helper.proowner,(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')))
     OR NOT has_schema_privilege('authenticated','private','USAGE')
     OR has_schema_privilege('authenticated','private','CREATE')
     OR has_schema_privilege('anon','private','USAGE')
     OR has_schema_privilege('service_role','private','USAGE') THEN
    RAISE EXCEPTION 'Helper/schema privileges exceed the approved authenticated-only boundary';
  END IF;
  IF (SELECT array_agg(proname::text ORDER BY proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public') IS DISTINCT FROM
      ARRAY['has_business_role','is_business_member','prevent_stock_movement_changes','set_updated_at']::text[]
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname IN ('public','private') AND p.prosecdef) <> 3 THEN
    RAISE EXCEPTION 'Unexpected functions or definers outside the approved exception';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')) <> 19
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
                  AND (NOT c.relrowsecurity OR c.relforcerowsecurity))
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                AND tablename IN ('expense_categories','expenses')) THEN
    RAISE EXCEPTION 'RLS/FORCE/future domain boundary changed';
  END IF;
  RAISE NOTICE 'BF-077 metadata passed: 40 public policies, three exact authenticated SELECT policies, one private boolean STABLE definer, authenticated-only EXECUTE, 19 RLS tables/FORCE off, two future tables closed';
END;
$$;

-- Empty shadow tables make a hostile caller search_path observable. The helper
-- must continue to read the real, schema-qualified relations.
CREATE TEMP TABLE sales (id uuid,business_id uuid);
CREATE TEMP TABLE payments (id uuid,business_id uuid,sale_id uuid,created_by uuid);

DO $$
DECLARE
  users uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
    gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  biz uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  client_ids uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  service_ids uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  product_ids uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  sale_ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,13));
  lines uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,26));
  payment_ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,20));
  sale_sides constant integer[] := ARRAY[1,1,1,2,2,1,2,1,1,1,2,2,1];
  sale_creators constant integer[] := ARRAY[1,4,5,2,6,7,7,8,9,3,3,4,2];
  payment_sides constant integer[] := ARRAY[1,1,1,2,2,1,2,1,1,1,2,2,1,1,1,1,1,1,1,2];
  payment_creators constant integer[] := ARRAY[1,4,5,2,6,7,7,8,9,3,3,4,2,4,4,1,3,7,4,7];
  payment_sales constant integer[] := ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,1,3,2,4,5,4,1];
  appointment uuid := gen_random_uuid();
  barber_member uuid;
  baseline jsonb := '{}'::jsonb;
  rows jsonb;
  person record;
  operation text;
  table_name text;
  statement text;
  insert_statement text;
  update_statement text;
  row_id uuid;
  allowed boolean;
  helper_result boolean;
  actual_count bigint;
  affected bigint;
  expected_count bigint;
  side integer;
  creator integer;
  parent_idx integer;
  total_rows integer;
  idx integer;
  member_idx integer;
  checks integer := 0;
  helper_checks integer := 0;
  revocation_checks integer := 0;
  future_checks integer := 0;
BEGIN
  INSERT INTO auth.users (id) SELECT unnest(users);
  INSERT INTO public.businesses (id,name) VALUES (biz[1],'BF077 A'),(biz[2],'BF077 B');
  -- OWNER A/B/AB, BARBER A1/A2/B1/AB, no membership, inactive BARBER A/OWNER B.
  INSERT INTO public.business_members (business_id,user_id,role,is_active) VALUES
    (biz[1],users[1],'OWNER',true),(biz[2],users[2],'OWNER',true),
    (biz[1],users[3],'OWNER',true),(biz[2],users[3],'OWNER',true),
    (biz[1],users[4],'BARBER',true),(biz[1],users[5],'BARBER',true),
    (biz[2],users[6],'BARBER',true),(biz[1],users[7],'BARBER',true),
    (biz[2],users[7],'BARBER',true),(biz[1],users[9],'BARBER',false),
    (biz[2],users[9],'OWNER',false);
  SELECT id INTO STRICT barber_member FROM public.business_members WHERE business_id = biz[1] AND user_id = users[4];
  FOR side IN 1..2 LOOP
    INSERT INTO public.clients (id,business_id,first_name) VALUES (client_ids[side],biz[side],'Client');
    INSERT INTO public.services (id,business_id,name,price,duration_minutes) VALUES (service_ids[side],biz[side],'Service',10,30);
    INSERT INTO public.products (id,business_id,name,sale_price,default_purchase_cost) VALUES (product_ids[side],biz[side],'Product',10,4);
  END LOOP;
  INSERT INTO public.appointments (id,business_id,client_id,barber_member_id,start_at,end_at,created_by)
    VALUES (appointment,biz[1],client_ids[1],barber_member,'2030-01-07T12:00:00Z','2030-01-07T13:00:00Z',users[1]);
  FOR idx IN 1..13 LOOP
    side := sale_sides[idx];
    INSERT INTO public.sales (id,business_id,client_id,appointment_id,operation_id,status,subtotal,total,created_by)
      VALUES (sale_ids[idx],biz[side],client_ids[side],CASE WHEN idx = 1 THEN appointment END,
        gen_random_uuid(),(ARRAY['DRAFT','COMPLETED','VOIDED'])[(idx-1)%3+1],20,20,users[sale_creators[idx]]);
    INSERT INTO public.sale_items (id,sale_id,item_type,service_id,item_name_snapshot,unit_price_snapshot,line_total)
      VALUES (lines[idx*2-1],sale_ids[idx],'SERVICE',service_ids[side],'Service snapshot',10,10);
    INSERT INTO public.sale_items (id,sale_id,item_type,product_id,item_name_snapshot,unit_price_snapshot,line_total,unit_cost_snapshot)
      VALUES (lines[idx*2],sale_ids[idx],'PRODUCT',product_ids[side],'Product snapshot',10,10,4);
  END LOOP;
  FOR idx IN 1..20 LOOP
    INSERT INTO public.payments (id,business_id,sale_id,payment_method,amount,created_by)
      VALUES (payment_ids[idx],biz[payment_sides[idx]],sale_ids[payment_sales[idx]],
        (ARRAY['CASH','TRANSFER','DEBIT','CREDIT','OTHER'])[(idx-1)%5+1],10,users[payment_creators[idx]]);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['sales','sale_items','payments'] LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.%I t',table_name) INTO rows;
    baseline := baseline || jsonb_build_object(table_name,rows);
  END LOOP;

  -- Expected access is derived from fixture identities/roles, not from helpers.
  -- All mutations must be denied, including valid writes to visible rows.
  FOR person IN SELECT * FROM (VALUES
    (users[1],ARRAY[1],'OWNER','authenticated','Owner A'),
    (users[2],ARRAY[2],'OWNER','authenticated','Owner B'),
    (users[3],ARRAY[1,2],'OWNER','authenticated','Owner AB'),
    (users[4],ARRAY[1],'BARBER','authenticated','Barber A1'),
    (users[5],ARRAY[1],'BARBER','authenticated','Barber A2'),
    (users[6],ARRAY[2],'BARBER','authenticated','Barber B1'),
    (users[7],ARRAY[1,2],'BARBER','authenticated','Barber AB'),
    (users[8],ARRAY[]::integer[],NULL,'authenticated','No membership'),
    (users[9],ARRAY[]::integer[],NULL,'authenticated','Inactive member'),
    (NULL::uuid,ARRAY[]::integer[],NULL,'anon','Anonymous')
  ) AS people(user_id,active_sides,business_role,database_role,label) LOOP
    FOREACH table_name IN ARRAY ARRAY['sales','sale_items','payments'] LOOP
      total_rows := CASE table_name WHEN 'sales' THEN 13 WHEN 'sale_items' THEN 26 ELSE 20 END;
      FOR idx IN 1..total_rows LOOP
        parent_idx := CASE table_name WHEN 'sale_items' THEN (idx+1)/2 WHEN 'payments' THEN payment_sales[idx] ELSE idx END;
        side := CASE table_name WHEN 'payments' THEN payment_sides[idx] ELSE sale_sides[parent_idx] END;
        creator := CASE table_name WHEN 'payments' THEN payment_creators[idx] ELSE sale_creators[parent_idx] END;
        row_id := CASE table_name WHEN 'sales' THEN sale_ids[idx] WHEN 'sale_items' THEN lines[idx] ELSE payment_ids[idx] END;
        allowed := side = ANY(person.active_sides)
          AND (person.business_role = 'OWNER' OR users[creator] = person.user_id);
        IF table_name = 'payments' THEN allowed := allowed AND side = sale_sides[parent_idx]; END IF;
        expected_count := CASE WHEN allowed THEN 1 ELSE 0 END;
        insert_statement := CASE table_name
          WHEN 'sales' THEN format('INSERT INTO public.sales (business_id,operation_id,subtotal,total,created_by) VALUES (%L,gen_random_uuid(),20,20,%L)',biz[side],coalesce(person.user_id,users[1]))
          WHEN 'sale_items' THEN format('INSERT INTO public.sale_items (sale_id,item_type,service_id,item_name_snapshot,unit_price_snapshot,line_total) VALUES (%L,''SERVICE'',%L,''New snapshot'',10,10)',sale_ids[parent_idx],service_ids[side])
          ELSE format('INSERT INTO public.payments (business_id,sale_id,payment_method,amount,created_by) VALUES (%L,%L,''CASH'',10,%L)',biz[side],sale_ids[parent_idx],coalesce(person.user_id,users[1])) END;
        update_statement := CASE table_name
          WHEN 'sales' THEN format('UPDATE public.sales SET business_id = %L, client_id = %L, appointment_id = NULL, subtotal = 20, discount = 2, total = 18, status = ''COMPLETED'', sold_at = now(), created_by = %L WHERE id = %L',biz[2],client_ids[2],users[1],row_id)
          WHEN 'sale_items' THEN format('UPDATE public.sale_items SET sale_id = %L, item_name_snapshot = ''Changed'', unit_price_snapshot = 20, quantity = 2, line_total = 40, unit_cost_snapshot = CASE item_type WHEN ''PRODUCT'' THEN 5 END WHERE id = %L',sale_ids[4],row_id)
          ELSE format('UPDATE public.payments SET business_id = %L, sale_id = %L, amount = 20, payment_method = ''OTHER'', notes = ''Changed'', created_by = %L WHERE id = %L',biz[2],sale_ids[4],users[1],row_id) END;
        FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
          statement := CASE operation
            WHEN 'SELECT' THEN format('SELECT count(*) FROM public.%I WHERE id = %L',table_name,row_id)
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
                IF actual_count <> expected_count THEN RAISE EXCEPTION 'Unexpected visible rows: expected %, actual %',expected_count,actual_count; END IF;
              ELSE
                EXECUTE statement;
                GET DIAGNOSTICS affected = ROW_COUNT;
                IF operation = 'INSERT' OR affected <> 0 THEN RAISE EXCEPTION 'Direct financial write succeeded'; END IF;
              END IF;
            EXCEPTION WHEN insufficient_privilege THEN
              IF operation <> 'INSERT' OR SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
            END;
            RESET ROLE;
            RAISE EXCEPTION 'Rollback action' USING ERRCODE = 'ZB077';
          EXCEPTION WHEN SQLSTATE 'ZB077' THEN NULL;
            WHEN OTHERS THEN RAISE EXCEPTION 'BF077 %, %, row %, %: %',person.label,table_name,idx,operation,SQLERRM;
          END;
          checks := checks + 1;
        END LOOP;
      END LOOP;
    END LOOP;

    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role',person.database_role)::text,true);
    PERFORM set_config('request.jwt.claim.sub',coalesce(person.user_id::text,''),true);
    EXECUTE format('SET LOCAL ROLE %I',person.database_role);
    SET LOCAL search_path = pg_temp, public;
    FOR idx IN 1..22 LOOP
      row_id := CASE WHEN idx <= 20 THEN payment_ids[idx] WHEN idx = 21 THEN gen_random_uuid() ELSE NULL END;
      IF idx <= 20 THEN
        allowed := payment_sides[idx] = ANY(person.active_sides)
          AND (person.business_role = 'OWNER' OR users[payment_creators[idx]] = person.user_id)
          AND payment_sides[idx] = sale_sides[payment_sales[idx]];
      ELSE allowed := false; END IF;
      IF person.database_role = 'anon' THEN
        BEGIN
          PERFORM private.can_read_payment(row_id);
          RAISE EXCEPTION 'Anon invoked private helper';
        EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      ELSE
        SELECT private.can_read_payment(row_id) INTO helper_result;
        IF helper_result IS DISTINCT FROM allowed THEN RAISE EXCEPTION 'Direct helper mismatch: %, row %',person.label,idx; END IF;
      END IF;
      helper_checks := helper_checks + 1;
    END LOOP;
    RESET ROLE;
    SET LOCAL search_path = '';

    IF person.database_role = 'authenticated' THEN
      SET LOCAL ROLE authenticated;
      BEGIN
        CREATE TABLE private.unauthorized_object (id integer);
        RAISE EXCEPTION 'Authenticated can create private objects';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      RESET ROLE;
    END IF;
    -- Two unimplemented domains remain closed to every ordinary identity.
    EXECUTE format('SET LOCAL ROLE %I',person.database_role);
    FOREACH table_name IN ARRAY ARRAY['expense_categories','expenses'] LOOP
      EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO actual_count;
      IF actual_count <> 0 THEN RAISE EXCEPTION 'Future SELECT opened'; END IF;
      EXECUTE format('UPDATE public.%I SET created_at = created_at',table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION 'Future UPDATE opened'; END IF;
      EXECUTE format('DELETE FROM public.%I',table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION 'Future DELETE opened'; END IF;
      future_checks := future_checks + 3;
    END LOOP;
    RESET ROLE;
  END LOOP;

  -- The approved exception: own payments 14/15 expose neither their parent's
  -- sales nor lines. Appointment/client access is not financial authorization.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[4],'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',users[4]::text,true);
  SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM public.payments WHERE id IN (payment_ids[14],payment_ids[15])) <> 2
     OR (SELECT count(*) FROM public.sales WHERE id IN (sale_ids[1],sale_ids[3])) <> 0
     OR (SELECT count(*) FROM public.sale_items WHERE sale_id IN (sale_ids[1],sale_ids[3])) <> 0
     OR (SELECT count(*) FROM public.payments WHERE id = payment_ids[16]) <> 0
     OR (SELECT count(*) FROM public.appointments WHERE id = appointment) <> 1
     OR (SELECT count(*) FROM public.clients WHERE id = client_ids[1]) <> 1 THEN
    RAISE EXCEPTION 'Payment/parent visibility or client/appointment authorization contract failed';
  END IF;
  RESET ROLE;

  -- Revoke all memberships of each active actor (including both AB tenants).
  FOR member_idx IN 1..7 LOOP
    BEGIN
      UPDATE public.business_members SET is_active = false WHERE user_id = users[member_idx];
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[member_idx],'role','authenticated')::text,true);
      PERFORM set_config('request.jwt.claim.sub',users[member_idx]::text,true);
      SET LOCAL ROLE authenticated;
      FOREACH table_name IN ARRAY ARRAY['sales','sale_items','payments'] LOOP
        EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO actual_count;
        IF actual_count <> 0 THEN RAISE EXCEPTION 'Revoked financial access persists'; END IF;
        revocation_checks := revocation_checks + 1;
      END LOOP;
      FOR idx IN 1..20 LOOP
        IF private.can_read_payment(payment_ids[idx]) THEN RAISE EXCEPTION 'Revoked helper access persists'; END IF;
        revocation_checks := revocation_checks + 1;
      END LOOP;
      RESET ROLE;
      UPDATE public.business_members SET is_active = true WHERE user_id = users[member_idx];
      SET LOCAL ROLE authenticated;
      FOR idx IN 1..20 LOOP
        allowed := (CASE WHEN member_idx IN (3,7) THEN true WHEN member_idx IN (2,6) THEN payment_sides[idx] = 2 ELSE payment_sides[idx] = 1 END)
          AND (member_idx <= 3 OR payment_creators[idx] = member_idx)
          AND payment_sides[idx] = sale_sides[payment_sales[idx]];
        IF private.can_read_payment(payment_ids[idx]) IS DISTINCT FROM allowed THEN RAISE EXCEPTION 'Reactivated helper scope differs'; END IF;
        revocation_checks := revocation_checks + 1;
      END LOOP;
      RESET ROLE;
      RAISE EXCEPTION 'Rollback membership change' USING ERRCODE = 'ZB077';
    EXCEPTION WHEN SQLSTATE 'ZB077' THEN NULL; END;
  END LOOP;

  SET LOCAL ROLE service_role;
  IF (SELECT count(*) FROM public.sales) <> 13 OR (SELECT count(*) FROM public.sale_items) <> 26
     OR (SELECT count(*) FROM public.payments) <> 20 THEN RAISE EXCEPTION 'Service role visibility changed'; END IF;
  BEGIN
    PERFORM private.can_read_payment(payment_ids[1]);
    RAISE EXCEPTION 'Service role obtained private EXECUTE';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  FOREACH table_name IN ARRAY ARRAY['sales','sale_items','payments'] LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.%I t',table_name) INTO rows;
    IF rows IS DISTINCT FROM baseline -> table_name THEN RAISE EXCEPTION 'Financial fixtures modified: %',table_name; END IF;
  END LOOP;
  IF checks <> 2360 OR helper_checks <> 220 OR revocation_checks <> 301 OR future_checks <> 60 THEN
    RAISE EXCEPTION 'Incomplete BF-077 checks: CRUD %, helper %, revocation %, future %',checks,helper_checks,revocation_checks,future_checks;
  END IF;
  RAISE NOTICE 'BF-077 passed: % effective-role CRUD checks, % direct helper checks, % membership revocation/reactivation, % future-table denials; OWNER/BARBER A/B/AB, own payment with hidden parent, four inconsistent payments, all sale statuses/payment methods, both line types, anon/nonmember/inactive, hostile search_path, no client writes and unchanged financial fixtures',checks,helper_checks,revocation_checks,future_checks;
END;
$$;

ROLLBACK;
