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
    'stock_movements.stock_movements_select_members'
  ];
  expected record;
  actual record;
  col record;
BEGIN
  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public')
     IS DISTINCT FROM (SELECT array_agg(p ORDER BY p) FROM unnest(policy_names) AS names(p)) THEN
    RAISE EXCEPTION 'Expected exactly the 35 approved public policy identities';
  END IF;
  -- Literal expressions are the independent metadata oracle; only whitespace
  -- is normalized, retaining every operator, cast and tenant correlation.
  FOR expected IN SELECT * FROM (VALUES
    ('product_categories','product_categories_select_members','SELECT','public.is_business_member(business_id)',NULL),
    ('product_categories','product_categories_insert_owners','INSERT',NULL,'public.has_business_role(business_id, ARRAY[''OWNER''::text])'),
    ('product_categories','product_categories_update_owners','UPDATE','public.has_business_role(business_id, ARRAY[''OWNER''::text])','public.has_business_role(business_id, ARRAY[''OWNER''::text])'),
    ('products','products_select_members','SELECT','public.is_business_member(business_id)',NULL),
    ('products','products_insert_owners','INSERT',NULL,$policy$(public.has_business_role(business_id, ARRAY['OWNER'::text]) AND ((category_id IS NULL) OR (EXISTS ( SELECT 1
      FROM public.product_categories category
      WHERE ((category.id = products.category_id) AND (category.business_id = products.business_id))))))$policy$),
    ('products','products_update_owners','UPDATE','public.has_business_role(business_id, ARRAY[''OWNER''::text])',$policy$(public.has_business_role(business_id, ARRAY['OWNER'::text]) AND ((category_id IS NULL) OR (EXISTS ( SELECT 1
      FROM public.product_categories category
      WHERE ((category.id = products.category_id) AND (category.business_id = products.business_id))))))$policy$),
    ('stock_movements','stock_movements_select_members','SELECT','public.is_business_member(business_id)',NULL)
  ) AS policies(table_name,policy_name,command,using_expression,check_expression) LOOP
    SELECT * INTO STRICT actual FROM pg_policies WHERE schemaname = 'public'
      AND tablename = expected.table_name AND policyname = expected.policy_name;
    IF actual.cmd <> expected.command OR actual.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
       OR actual.permissive <> 'PERMISSIVE'
       OR regexp_replace(actual.qual,'[[:space:]]','','g') IS DISTINCT FROM regexp_replace(expected.using_expression,'[[:space:]]','','g')
       OR regexp_replace(actual.with_check,'[[:space:]]','','g') IS DISTINCT FROM regexp_replace(expected.check_expression,'[[:space:]]','','g') THEN
      RAISE EXCEPTION 'Incorrect BF-076 command/roles/USING/WITH CHECK: %',expected.policy_name;
    END IF;
  END LOOP;
  FOR col IN
    SELECT c.oid,c.relname,a.attname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relname IN ('product_categories','products')
  LOOP
    IF has_table_privilege('authenticated',col.oid,'UPDATE')
       OR has_column_privilege('authenticated',col.oid,col.attname,'UPDATE') IS DISTINCT FROM (col.attname <> 'business_id')
       OR NOT has_column_privilege('service_role',col.oid,col.attname,'UPDATE')
       OR NOT has_column_privilege('anon',col.oid,col.attname,'UPDATE') THEN
      RAISE EXCEPTION 'Incorrect catalog column grant: %.%',col.relname,col.attname;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN
      ('sales','sale_items','payments','purchases','purchase_items','expense_categories','expenses')) THEN
    RAISE EXCEPTION 'Future domain policy opened';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')) <> 19
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
                  AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Expected 19 RLS tables, FORCE off';
  END IF;
  IF (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') IS DISTINCT FROM
      ARRAY['has_business_role','is_business_member','prevent_stock_movement_changes','set_updated_at']::text[]
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef) <> 2 THEN
    RAISE EXCEPTION 'Unexpected public function/SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.stock_movements'::regclass
                 AND tgname = 'stock_movements_append_only' AND tgenabled = 'O'
                 AND tgfoid = 'public.prevent_stock_movement_changes()'::regprocedure
                 AND tgtype = 27 AND NOT tgisinternal)
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.stock_movements'::regclass AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'Append-only trigger changed';
  END IF;
  RAISE NOTICE 'BF-076 metadata passed: exactly 35 identities, seven exact inventory policies, authenticated only, catalog business_id excluded, 19 RLS tables, FORCE off, seven future tables closed, four public functions/two approved definers, existing ledger trigger';
END;
$$;

DO $$
DECLARE
  users uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
                        gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  biz uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  members uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  categories uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  products uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  movements uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
                           gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  types constant text[] := ARRAY['PURCHASE','SALE','LOSS','ADJUSTMENT','RETURN'];
  baseline jsonb := '{}'::jsonb;
  rows jsonb;
  person record;
  scenario record;
  table_name text;
  operation text;
  statement text;
  insert_statement text;
  row_id uuid;
  allowed boolean;
  actual_count bigint;
  affected bigint;
  expected_count bigint;
  side integer;
  idx integer;
  checks integer := 0;
  boundary_checks integer := 0;
  column_checks integer := 0;
  revocation_checks integer := 0;
  ledger_checks integer := 0;
BEGIN
  INSERT INTO auth.users (id) SELECT unnest(users);
  INSERT INTO public.businesses (id,name) VALUES (biz[1],'BF076 A'),(biz[2],'BF076 B');
  -- users: OWNER A/B, BARBER A/B, OWNER AB, nonmember, inactive OWNER A.
  FOR idx IN 1..4 LOOP
    INSERT INTO public.business_members (id,business_id,user_id,role)
      VALUES (members[idx],biz[CASE WHEN idx IN (1,3) THEN 1 ELSE 2 END],users[idx],CASE WHEN idx <= 2 THEN 'OWNER' ELSE 'BARBER' END);
  END LOOP;
  INSERT INTO public.business_members (business_id,user_id,role,is_active) VALUES
    (biz[1],users[5],'OWNER',true),(biz[2],users[5],'OWNER',true),(biz[1],users[7],'OWNER',false);
  FOR idx IN 1..4 LOOP
    side := CASE WHEN idx <= 2 THEN 1 ELSE 2 END;
    INSERT INTO public.product_categories (id,business_id,name,is_active)
      VALUES (categories[idx],biz[side],'Category ' || idx,idx IN (1,3));
    INSERT INTO public.products (id,business_id,category_id,name,sale_price,default_purchase_cost,is_active)
      VALUES (products[idx],biz[side],categories[idx],'Product ' || idx,10,4,idx IN (1,3));
  END LOOP;
  FOR idx IN 1..10 LOOP
    side := CASE WHEN idx <= 5 THEN 1 ELSE 2 END;
    INSERT INTO public.stock_movements (id,business_id,product_id,type,quantity_delta,created_by)
      VALUES (movements[idx],biz[side],products[CASE side WHEN 1 THEN 1 ELSE 3 END],types[(idx-1)%5+1],2,users[side]);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['product_categories','products','stock_movements'] LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.%I t',table_name) INTO rows;
    baseline := baseline || jsonb_build_object(table_name,rows);
  END LOOP;

  -- Expectations derive from fixture identities, never from the policy helpers.
  -- Every action rolls back separately, preventing a denial from hiding behind
  -- fixtures deleted/archived/modified by an earlier successful operation.
  FOR person IN SELECT * FROM (VALUES
    (users[1],ARRAY[biz[1]],'OWNER','authenticated','Owner A'),
    (users[2],ARRAY[biz[2]],'OWNER','authenticated','Owner B'),
    (users[3],ARRAY[biz[1]],'BARBER','authenticated','Barber A'),
    (users[4],ARRAY[biz[2]],'BARBER','authenticated','Barber B'),
    (users[5],biz,'OWNER','authenticated','Owner AB'),
    (users[6],ARRAY[]::uuid[],NULL,'authenticated','No membership'),
    (users[7],ARRAY[]::uuid[],NULL,'authenticated','Inactive membership'),
    (NULL::uuid,ARRAY[]::uuid[],NULL,'anon','Anonymous')
  ) AS people(user_id,active_businesses,business_role,database_role,label) LOOP
    FOREACH table_name IN ARRAY ARRAY['product_categories','products','stock_movements'] LOOP
      FOR idx IN 1..CASE WHEN table_name = 'stock_movements' THEN 10 ELSE 4 END LOOP
        side := CASE WHEN idx <= CASE WHEN table_name = 'stock_movements' THEN 5 ELSE 2 END THEN 1 ELSE 2 END;
        row_id := CASE table_name WHEN 'product_categories' THEN categories[idx]
                      WHEN 'products' THEN products[idx] ELSE movements[idx] END;
        insert_statement := CASE table_name
          WHEN 'product_categories' THEN format('INSERT INTO public.product_categories (business_id,name,is_active) VALUES (%L,''Inserted'',%L)',biz[side],idx IN (1,3))
          WHEN 'products' THEN format('INSERT INTO public.products (business_id,category_id,name,sale_price,default_purchase_cost,is_active) VALUES (%L,%L,''Inserted'',10,4,%L)',biz[side],categories[idx],idx IN (1,3))
          ELSE format('INSERT INTO public.stock_movements (business_id,product_id,type,quantity_delta,created_by) VALUES (%L,%L,%L,2,%L)',biz[side],products[CASE side WHEN 1 THEN 1 ELSE 3 END],types[(idx-1)%5+1],coalesce(person.user_id,users[1])) END;
        FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
          allowed := coalesce(person.database_role = 'authenticated' AND biz[side] = ANY(person.active_businesses)
            AND (operation = 'SELECT' OR (table_name <> 'stock_movements' AND person.business_role = 'OWNER' AND operation IN ('INSERT','UPDATE'))),false);
          expected_count := CASE WHEN allowed THEN 1 ELSE 0 END;
          statement := CASE operation
            WHEN 'SELECT' THEN format('SELECT count(*) FROM public.%I WHERE id = %L',table_name,row_id)
            WHEN 'INSERT' THEN insert_statement
            WHEN 'UPDATE' THEN CASE WHEN table_name = 'stock_movements' THEN
              format('UPDATE public.stock_movements SET notes = ''Edited'' WHERE id = %L',row_id)
              ELSE format('UPDATE public.%I SET name = ''Edited'', is_active = %L WHERE id = %L',table_name,idx NOT IN (1,3),row_id) END
            ELSE format('DELETE FROM public.%I WHERE id = %L',table_name,row_id) END;
          BEGIN
            PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role',person.database_role)::text,true);
            PERFORM set_config('request.jwt.claim.sub',coalesce(person.user_id::text,''),true);
            EXECUTE format('SET LOCAL ROLE %I',person.database_role);
            IF auth.uid() IS DISTINCT FROM person.user_id OR current_user <> person.database_role THEN
              RAISE EXCEPTION 'Identity simulation failed';
            END IF;
            BEGIN
              IF operation = 'SELECT' THEN
                EXECUTE statement INTO actual_count;
                IF actual_count <> expected_count THEN RAISE EXCEPTION 'Unexpected visible count'; END IF;
              ELSE
                EXECUTE statement;
                GET DIAGNOSTICS affected = ROW_COUNT;
                IF operation = 'INSERT' AND NOT allowed THEN RAISE EXCEPTION 'Unauthorized INSERT succeeded'; END IF;
                IF affected <> expected_count THEN RAISE EXCEPTION 'Unexpected affected count'; END IF;
              END IF;
            EXCEPTION WHEN insufficient_privilege THEN
              IF operation <> 'INSERT' OR allowed OR SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
            END;
            RESET ROLE;
            RAISE EXCEPTION 'Rollback matrix action' USING ERRCODE = 'ZB076';
          EXCEPTION WHEN SQLSTATE 'ZB076' THEN NULL;
          WHEN OTHERS THEN RAISE EXCEPTION 'Matrix failed: %, %, row %, %: %',person.label,table_name,idx,operation,SQLERRM;
          END;
          checks := checks + 1;
        END LOOP;
      END LOOP;
    END LOOP;
    -- Exact stock sum proves all five types are readable, not just a row sample.
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role',person.database_role)::text,true);
    PERFORM set_config('request.jwt.claim.sub',coalesce(person.user_id::text,''),true);
    EXECUTE format('SET LOCAL ROLE %I',person.database_role);
    FOR side IN 1..2 LOOP
      SELECT count(*),coalesce(sum(quantity_delta),0) INTO actual_count,affected FROM public.stock_movements WHERE business_id = biz[side];
      expected_count := CASE WHEN biz[side] = ANY(person.active_businesses) THEN 5 ELSE 0 END;
      IF actual_count <> expected_count OR affected <> expected_count * 2 THEN RAISE EXCEPTION 'Movement type/stock visibility failed'; END IF;
    END LOOP;
    RESET ROLE;
  END LOOP;

  -- Check both directions even when OWNER AB can see BOTH categories. NULL and
  -- archived same-tenant categories are valid; activity is not an RLS predicate.
  FOR person IN SELECT * FROM (VALUES (users[1],ARRAY[1],'Owner A'),(users[2],ARRAY[2],'Owner B'),(users[5],ARRAY[1,2],'Owner AB'))
    AS people(user_id,sides,label) LOOP
    FOREACH side IN ARRAY person.sides LOOP
      idx := CASE side WHEN 1 THEN 1 ELSE 3 END;
      FOR scenario IN SELECT * FROM (VALUES
        ('foreign category INSERT',format('INSERT INTO public.products (business_id,category_id,name,sale_price,default_purchase_cost) VALUES (%L,%L,''Foreign'',10,4)',biz[side],categories[CASE side WHEN 1 THEN 3 ELSE 1 END]),false),
        ('foreign category UPDATE',format('UPDATE public.products SET category_id = %L WHERE id = %L',categories[CASE side WHEN 1 THEN 3 ELSE 1 END],products[idx]),false),
        ('NULL category INSERT',format('INSERT INTO public.products (business_id,category_id,name,sale_price,default_purchase_cost) VALUES (%L,NULL,''No category'',10,4)',biz[side]),true),
        ('NULL category UPDATE',format('UPDATE public.products SET category_id = NULL WHERE id = %L',products[idx]),true),
        ('archived category INSERT',format('INSERT INTO public.products (business_id,category_id,name,sale_price,default_purchase_cost) VALUES (%L,%L,''Archived category'',10,4)',biz[side],categories[idx+1]),true),
        ('archived category UPDATE',format('UPDATE public.products SET category_id = %L WHERE id = %L',categories[idx+1],products[idx]),true)
      ) AS cases(label,statement,allowed) LOOP
        BEGIN
          PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role','authenticated')::text,true);
          PERFORM set_config('request.jwt.claim.sub',person.user_id::text,true);
          SET LOCAL ROLE authenticated;
          BEGIN
            EXECUTE scenario.statement;
            GET DIAGNOSTICS affected = ROW_COUNT;
            IF NOT scenario.allowed OR affected <> 1 THEN RAISE EXCEPTION 'Unexpected boundary success/count'; END IF;
          EXCEPTION WHEN insufficient_privilege THEN
            IF scenario.allowed OR SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
          END;
          RESET ROLE;
          RAISE EXCEPTION 'Rollback category boundary' USING ERRCODE = 'ZB076';
        EXCEPTION WHEN SQLSTATE 'ZB076' THEN NULL;
        WHEN OTHERS THEN RAISE EXCEPTION 'Category boundary failed: %, side %, %: %',person.label,side,scenario.label,SQLERRM;
        END;
        boundary_checks := boundary_checks + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Admin controls establish valid FKs/source rows, then the same visible source
  -- must fail with column privileges, even for an OWNER authorized on both sides.
  FOR side IN 1..2 LOOP
    idx := CASE side WHEN 1 THEN 1 ELSE 3 END;
    FOR scenario IN SELECT * FROM (VALUES
      ('product_categories',categories[idx],format('UPDATE public.product_categories SET business_id = %L WHERE id = %L',biz[3-side],categories[idx])),
      ('products',products[idx],format('UPDATE public.products SET business_id = %L, category_id = %L WHERE id = %L',biz[3-side],categories[CASE side WHEN 1 THEN 3 ELSE 1 END],products[idx]))
    ) AS cases(table_name,row_id,statement) LOOP
      BEGIN
        EXECUTE scenario.statement;
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Invalid administrator transfer control'; END IF;
        RAISE EXCEPTION 'Rollback administrator control' USING ERRCODE = 'ZB076';
      EXCEPTION WHEN SQLSTATE 'ZB076' THEN NULL; END;
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[5],'role','authenticated')::text,true);
      PERFORM set_config('request.jwt.claim.sub',users[5]::text,true);
      SET LOCAL ROLE authenticated;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE id = %L',scenario.table_name,scenario.row_id) INTO actual_count;
      IF actual_count <> 1 OR NOT public.has_business_role(biz[1],ARRAY['OWNER']) OR NOT public.has_business_role(biz[2],ARRAY['OWNER']) THEN
        RAISE EXCEPTION 'Invalid dual OWNER/source visibility';
      END IF;
      BEGIN
        EXECUTE scenario.statement;
        RAISE EXCEPTION 'Protected business_id changed';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM NOT LIKE '%permission denied%' OR SQLERRM LIKE '%row-level security%' THEN RAISE; END IF;
      END;
      RESET ROLE;
      column_checks := column_checks + 1;
    END LOOP;
  END LOOP;

  -- Immediate membership revocation/reactivation for OWNER/BARBER in A and B.
  FOR idx IN 1..4 LOOP
    BEGIN
      side := CASE WHEN idx IN (1,3) THEN 1 ELSE 2 END;
      UPDATE public.business_members SET is_active = false WHERE id = members[idx];
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[idx],'role','authenticated')::text,true);
      PERFORM set_config('request.jwt.claim.sub',users[idx]::text,true);
      SET LOCAL ROLE authenticated;
      FOREACH table_name IN ARRAY ARRAY['product_categories','products','stock_movements'] LOOP
        EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO actual_count;
        IF actual_count <> 0 THEN RAISE EXCEPTION 'Revoked SELECT persists'; END IF;
        EXECUTE format('UPDATE public.%I SET created_at = created_at',table_name);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'Revoked UPDATE persists'; END IF;
        EXECUTE format('DELETE FROM public.%I',table_name);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'Revoked DELETE persists'; END IF;
        BEGIN
          CASE table_name
            WHEN 'product_categories' THEN INSERT INTO public.product_categories (business_id,name) VALUES (biz[side],'Revoked');
            WHEN 'products' THEN INSERT INTO public.products (business_id,name,sale_price,default_purchase_cost) VALUES (biz[side],'Revoked',10,4);
            ELSE INSERT INTO public.stock_movements (business_id,product_id,type,quantity_delta,created_by) VALUES (biz[side],products[CASE side WHEN 1 THEN 1 ELSE 3 END],'ADJUSTMENT',2,users[idx]);
          END CASE;
          RAISE EXCEPTION 'Revoked INSERT persists';
        EXCEPTION WHEN insufficient_privilege THEN
          IF SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
        END;
        revocation_checks := revocation_checks + 4;
      END LOOP;
      RESET ROLE;
      UPDATE public.business_members SET is_active = true WHERE id = members[idx];
      SET LOCAL ROLE authenticated;
      FOREACH table_name IN ARRAY ARRAY['product_categories','products','stock_movements'] LOOP
        EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO actual_count;
        expected_count := CASE table_name WHEN 'stock_movements' THEN 5 ELSE 2 END;
        IF actual_count <> expected_count THEN RAISE EXCEPTION 'Reactivation did not restore exact scope'; END IF;
        revocation_checks := revocation_checks + 1;
      END LOOP;
      RESET ROLE;
      RAISE EXCEPTION 'Rollback membership change' USING ERRCODE = 'ZB076';
    EXCEPTION WHEN SQLSTATE 'ZB076' THEN NULL; END;
  END LOOP;

  -- No client write policy means zero rows touched, BEFORE the append-only
  -- trigger. Privileged callers still reach that unchanged trigger (55000).
  FOREACH table_name IN ARRAY ARRAY['postgres','service_role'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',table_name);
    SELECT count(*) INTO actual_count FROM public.stock_movements;
    IF actual_count <> 10 THEN RAISE EXCEPTION 'Privileged visibility changed'; END IF;
    FOREACH operation IN ARRAY ARRAY['UPDATE','DELETE'] LOOP
      BEGIN
        statement := CASE operation WHEN 'UPDATE' THEN format('UPDATE public.stock_movements SET notes = ''Forbidden'' WHERE id = %L',movements[1])
          ELSE format('DELETE FROM public.stock_movements WHERE id = %L',movements[1]) END;
        EXECUTE statement;
        RAISE EXCEPTION 'Privileged ledger mutation succeeded';
      EXCEPTION WHEN SQLSTATE '55000' THEN
        IF SQLERRM <> 'Stock movements are append-only; insert a compensating movement instead' THEN RAISE; END IF;
      END;
      ledger_checks := ledger_checks + 1;
    END LOOP;
    RESET ROLE;
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['product_categories','products','stock_movements'] LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.%I t',table_name) INTO rows;
    IF rows IS DISTINCT FROM baseline -> table_name THEN RAISE EXCEPTION 'Unexpected persistent fixture changes: %',table_name; END IF;
  END LOOP;
  IF checks <> 576 OR boundary_checks <> 24 OR column_checks <> 4 OR revocation_checks <> 60 OR ledger_checks <> 4 THEN
    RAISE EXCEPTION 'Incomplete BF-076 test execution';
  END IF;
  RAISE NOTICE 'BF-076 passed: % CRUD checks (128 categories, 128 products, 320 ledger), % category boundaries, % dual-OWNER column denials, % membership revocation/reactivation, % privileged append-only denials; all movement types, archived visibility/reactivation, derived sums and unchanged fixtures',checks,boundary_checks,column_checks,revocation_checks,ledger_checks;
END;
$$;

ROLLBACK;
