\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

-- Static expected policy expressions, reviewed against the BF-075 contract.
-- Preserve parentheses and type casts; normalize whitespace only.
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
    'appointment_services.appointment_services_delete_authorized'
  ];
  expected record;
  actual record;
  col record;
BEGIN
  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public')
     IS DISTINCT FROM (SELECT array_agg(p ORDER BY p) FROM unnest(policy_names) AS names(p)) THEN
    RAISE EXCEPTION 'Expected exactly the 28 approved public policy identities';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('appointment_services', 'appointment_services_delete_authorized', 'DELETE', $policy$(EXISTS ( SELECT 1
   FROM public.appointments parent
  WHERE ((parent.id = appointment_services.appointment_id) AND (public.has_business_role(parent.business_id, ARRAY['OWNER'::text]) OR (EXISTS ( SELECT 1
           FROM public.business_members assigned
          WHERE ((assigned.id = parent.barber_member_id) AND (assigned.business_id = parent.business_id) AND (assigned.user_id = auth.uid()) AND (assigned.is_active = true) AND (assigned.role = 'BARBER'::text))))))))$policy$, NULL),
    ('appointment_services', 'appointment_services_insert_authorized', 'INSERT', NULL, $policy$(EXISTS ( SELECT 1
   FROM public.appointments parent
  WHERE ((parent.id = appointment_services.appointment_id) AND (public.has_business_role(parent.business_id, ARRAY['OWNER'::text]) OR (EXISTS ( SELECT 1
           FROM public.business_members assigned
          WHERE ((assigned.id = parent.barber_member_id) AND (assigned.business_id = parent.business_id) AND (assigned.user_id = auth.uid()) AND (assigned.is_active = true) AND (assigned.role = 'BARBER'::text))))) AND ((appointment_services.service_id IS NULL) OR (EXISTS ( SELECT 1
           FROM public.services service
          WHERE ((service.id = appointment_services.service_id) AND (service.business_id = parent.business_id))))))))$policy$),
    ('appointment_services', 'appointment_services_select_authorized', 'SELECT', $policy$(EXISTS ( SELECT 1
   FROM public.appointments parent
  WHERE (parent.id = appointment_services.appointment_id)))$policy$, NULL),
    ('appointment_services', 'appointment_services_update_authorized', 'UPDATE', $policy$(EXISTS ( SELECT 1
   FROM public.appointments parent
  WHERE ((parent.id = appointment_services.appointment_id) AND (public.has_business_role(parent.business_id, ARRAY['OWNER'::text]) OR (EXISTS ( SELECT 1
           FROM public.business_members assigned
          WHERE ((assigned.id = parent.barber_member_id) AND (assigned.business_id = parent.business_id) AND (assigned.user_id = auth.uid()) AND (assigned.is_active = true) AND (assigned.role = 'BARBER'::text))))))))$policy$, $policy$(EXISTS ( SELECT 1
   FROM public.appointments parent
  WHERE ((parent.id = appointment_services.appointment_id) AND (public.has_business_role(parent.business_id, ARRAY['OWNER'::text]) OR (EXISTS ( SELECT 1
           FROM public.business_members assigned
          WHERE ((assigned.id = parent.barber_member_id) AND (assigned.business_id = parent.business_id) AND (assigned.user_id = auth.uid()) AND (assigned.is_active = true) AND (assigned.role = 'BARBER'::text))))) AND ((appointment_services.service_id IS NULL) OR (EXISTS ( SELECT 1
           FROM public.services service
          WHERE ((service.id = appointment_services.service_id) AND (service.business_id = parent.business_id))))))))$policy$),
    ('appointments', 'appointments_insert_authorized', 'INSERT', NULL, $policy$((created_by = auth.uid()) AND (public.has_business_role(business_id, ARRAY['OWNER'::text]) OR (EXISTS ( SELECT 1
   FROM public.business_members assigned
  WHERE ((assigned.id = appointments.barber_member_id) AND (assigned.business_id = appointments.business_id) AND (assigned.user_id = auth.uid()) AND (assigned.is_active = true) AND (assigned.role = 'BARBER'::text))))) AND (EXISTS ( SELECT 1
   FROM public.clients client
  WHERE ((client.id = appointments.client_id) AND (client.business_id = appointments.business_id)))) AND (EXISTS ( SELECT 1
   FROM public.business_members member
  WHERE ((member.id = appointments.barber_member_id) AND (member.business_id = appointments.business_id)))))$policy$),
    ('appointments', 'appointments_select_authorized', 'SELECT', $policy$(public.has_business_role(business_id, ARRAY['OWNER'::text]) OR (EXISTS ( SELECT 1
   FROM public.business_members assigned
  WHERE ((assigned.id = appointments.barber_member_id) AND (assigned.business_id = appointments.business_id) AND (assigned.user_id = auth.uid()) AND (assigned.is_active = true) AND (assigned.role = 'BARBER'::text)))))$policy$, NULL),
    ('appointments', 'appointments_update_authorized', 'UPDATE', $policy$(public.has_business_role(business_id, ARRAY['OWNER'::text]) OR (EXISTS ( SELECT 1
   FROM public.business_members assigned
  WHERE ((assigned.id = appointments.barber_member_id) AND (assigned.business_id = appointments.business_id) AND (assigned.user_id = auth.uid()) AND (assigned.is_active = true) AND (assigned.role = 'BARBER'::text)))))$policy$, $policy$((public.has_business_role(business_id, ARRAY['OWNER'::text]) OR (EXISTS ( SELECT 1
   FROM public.business_members assigned
  WHERE ((assigned.id = appointments.barber_member_id) AND (assigned.business_id = appointments.business_id) AND (assigned.user_id = auth.uid()) AND (assigned.is_active = true) AND (assigned.role = 'BARBER'::text))))) AND (EXISTS ( SELECT 1
   FROM public.clients client
  WHERE ((client.id = appointments.client_id) AND (client.business_id = appointments.business_id)))) AND (EXISTS ( SELECT 1
   FROM public.business_members member
  WHERE ((member.id = appointments.barber_member_id) AND (member.business_id = appointments.business_id)))))$policy$)
  ) AS policies(table_name, policy_name, command, using_expression, check_expression) LOOP
    SELECT * INTO STRICT actual FROM pg_policies WHERE schemaname = 'public'
      AND tablename = expected.table_name AND policyname = expected.policy_name;
    IF actual.cmd <> expected.command OR actual.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
       OR actual.permissive <> 'PERMISSIVE'
       OR regexp_replace(actual.qual, '[[:space:]]', '', 'g') IS DISTINCT FROM regexp_replace(expected.using_expression, '[[:space:]]', '', 'g')
       OR regexp_replace(actual.with_check, '[[:space:]]', '', 'g') IS DISTINCT FROM regexp_replace(expected.check_expression, '[[:space:]]', '', 'g') THEN
      RAISE EXCEPTION 'Incorrect BF-075 policy command/roles/USING/WITH CHECK: %', expected.policy_name;
    END IF;
  END LOOP;
  FOR col IN
    SELECT c.oid, c.relname, a.attname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relname IN ('appointments', 'appointment_services')
  LOOP
    IF has_table_privilege('authenticated', col.oid, 'UPDATE')
       OR has_column_privilege('authenticated', col.oid, col.attname, 'UPDATE') IS DISTINCT FROM
          (CASE WHEN col.relname = 'appointments' THEN col.attname NOT IN ('business_id','created_by')
                ELSE col.attname <> 'appointment_id' END)
       OR NOT has_column_privilege('service_role', col.oid, col.attname, 'UPDATE')
       OR NOT has_column_privilege('anon', col.oid, col.attname, 'UPDATE') THEN
      RAISE EXCEPTION 'Incorrect immutable-column grant: %.%', col.relname, col.attname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')) <> 19
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
                  AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Expected 19 RLS tables without FORCE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(ARRAY[
      'product_categories','products','sales','sale_items','payments','purchases',
      'purchase_items','stock_movements','expense_categories','expenses'])) THEN
    RAISE EXCEPTION 'A future domain received a policy';
  END IF;
  RAISE NOTICE 'BF-075 metadata passed: exactly 28 known policies, seven exact appointment policies, authenticated only, three immutable columns, other UPDATE columns and service_role unchanged, ten future domains closed, 19 RLS tables without FORCE';
END;
$$;

DO $$
DECLARE
  users uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                        gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  biz uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  members uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                          gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  clients uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  services uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  appts uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                        gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  lines uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                       gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  future_tables constant text[] := ARRAY['product_categories','products','sales','sale_items','payments',
    'purchases','purchase_items','stock_movements','expense_categories','expenses'];
  person record;
  scenario record;
  table_name text;
  operation text;
  statement text;
  insert_statement text;
  row_id uuid;
  parent_business uuid;
  parent_member uuid;
  allowed boolean;
  expected_count bigint;
  actual_count bigint;
  affected bigint;
  message text;
  baseline_appointments jsonb;
  baseline_lines jsonb;
  idx integer;
  side integer;
  checks integer := 0;
  boundary_checks integer := 0;
  column_checks integer := 0;
  future_checks integer := 0;
  revocation_checks integer := 0;
BEGIN
  INSERT INTO auth.users (id) SELECT unnest(users);
  INSERT INTO public.businesses (id, name) VALUES (biz[1], 'BF075 A'), (biz[2], 'BF075 B');
  -- users: OWNER A/B, BARBER A1/A2/B1, OWNER AB, nonmember, inactive BARBER A.
  INSERT INTO public.business_members (id, business_id, user_id, role, is_active) VALUES
    (members[1], biz[1], users[1], 'OWNER', true),
    (members[2], biz[2], users[2], 'OWNER', true),
    (members[3], biz[1], users[3], 'BARBER', true),
    (members[4], biz[1], users[4], 'BARBER', true),
    (members[5], biz[2], users[5], 'BARBER', true),
    (members[6], biz[1], users[6], 'OWNER', true),
    (members[7], biz[2], users[6], 'OWNER', true),
    (members[8], biz[1], users[8], 'BARBER', false);
  INSERT INTO public.clients (id, business_id, first_name, is_active) VALUES
    (clients[1], biz[1], 'Client A', true), (clients[2], biz[2], 'Client B', true),
    (clients[3], biz[1], 'Archived client A', false);
  INSERT INTO public.services (id, business_id, name, price, duration_minutes, is_active) VALUES
    (services[1], biz[1], 'Service A', 10, 30, true), (services[2], biz[2], 'Service B', 10, 30, true),
    (services[3], biz[1], 'Archived service A', 10, 30, false);
  FOR idx IN 1..6 LOOP
    side := CASE idx WHEN 3 THEN 2 ELSE 1 END;
    parent_member := CASE idx WHEN 1 THEN members[3] WHEN 2 THEN members[4] WHEN 3 THEN members[5]
                             WHEN 4 THEN members[8] WHEN 5 THEN members[1] ELSE members[5] END;
    -- Row 6 is deliberately legacy-inconsistent administrative data: its B
    -- barber must not gain access to an A appointment merely by matching id.
    INSERT INTO public.appointments (id, business_id, client_id, barber_member_id, start_at, end_at, created_by)
      VALUES (appts[idx], biz[side], clients[side], parent_member,
              '2030-01-07T12:00:00Z', '2030-01-07T13:00:00Z', users[side]);
    INSERT INTO public.appointment_services
      (id, appointment_id, service_id, service_name_snapshot, unit_price_snapshot, duration_minutes_snapshot, line_total)
      VALUES (lines[idx], appts[idx], services[side], 'Historical snapshot', 10, 30, 10);
  END LOOP;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO baseline_appointments FROM public.appointments a;
  SELECT jsonb_agg(to_jsonb(l) ORDER BY id) INTO baseline_lines FROM public.appointment_services l;

  -- Independent expected authorization by fixture identity, not policy helpers.
  -- Every operation rolls back separately, keeping later prerequisites intact.
  FOR person IN SELECT * FROM (VALUES
    (users[1], ARRAY[biz[1]], 'OWNER', 0, 'authenticated', 'Owner A'),
    (users[2], ARRAY[biz[2]], 'OWNER', 0, 'authenticated', 'Owner B'),
    (users[3], ARRAY[biz[1]], 'BARBER', 1, 'authenticated', 'Barber A1'),
    (users[4], ARRAY[biz[1]], 'BARBER', 2, 'authenticated', 'Barber A2'),
    (users[5], ARRAY[biz[2]], 'BARBER', 3, 'authenticated', 'Barber B1'),
    (users[6], biz, 'OWNER', 0, 'authenticated', 'Owner AB'),
    (users[7], ARRAY[]::uuid[], NULL, 0, 'authenticated', 'No membership'),
    (users[8], ARRAY[]::uuid[], NULL, 0, 'authenticated', 'Inactive member'),
    (NULL::uuid, ARRAY[]::uuid[], NULL, 0, 'anon', 'Anonymous')
  ) AS people(user_id, active_businesses, business_role, assigned_index, database_role, label) LOOP
    FOREACH table_name IN ARRAY ARRAY['appointments','appointment_services'] LOOP
      FOR idx IN 1..3 LOOP
        side := CASE idx WHEN 3 THEN 2 ELSE 1 END;
        parent_business := biz[side];
        parent_member := members[idx+2];
        row_id := CASE table_name WHEN 'appointments' THEN appts[idx] ELSE lines[idx] END;
        insert_statement := CASE table_name WHEN 'appointments' THEN
          format('INSERT INTO public.appointments (business_id, client_id, barber_member_id, start_at, end_at, created_by) VALUES (%L,%L,%L,''2030-01-07T14:00:00Z'',''2030-01-07T15:00:00Z'',%L)', parent_business, clients[side], parent_member, person.user_id)
          ELSE format('INSERT INTO public.appointment_services (appointment_id, service_id, service_name_snapshot, unit_price_snapshot, duration_minutes_snapshot, line_total) VALUES (%L,%L,''Explicit snapshot'',10,30,10)', appts[idx], services[side]) END;
        FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
          allowed := person.database_role = 'authenticated' AND parent_business = ANY(person.active_businesses)
            AND (person.business_role = 'OWNER' OR person.assigned_index = idx)
            AND (operation <> 'DELETE' OR table_name = 'appointment_services');
          allowed := coalesce(allowed, false);
          expected_count := CASE WHEN allowed THEN 1 ELSE 0 END;
          statement := CASE operation
            WHEN 'SELECT' THEN format('SELECT count(*) FROM public.%I WHERE id = %L', table_name, row_id)
            WHEN 'INSERT' THEN insert_statement
            WHEN 'UPDATE' THEN CASE table_name WHEN 'appointments' THEN
              format('UPDATE public.appointments SET notes = ''Edited'', start_at = ''2030-01-07T16:00:00Z'', end_at = ''2030-01-07T17:00:00Z'', status = ''COMPLETED'' WHERE id = %L', row_id)
              ELSE format('UPDATE public.appointment_services SET service_name_snapshot = ''Edited snapshot'', unit_price_snapshot = 20, duration_minutes_snapshot = 45, quantity = 2, line_total = 40 WHERE id = %L', row_id) END
            WHEN 'DELETE' THEN format('DELETE FROM public.%I WHERE id = %L', table_name, row_id) END;
          BEGIN
            PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',person.user_id,'role',person.database_role)::text, true);
            PERFORM set_config('request.jwt.claim.sub', coalesce(person.user_id::text,''), true);
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
              END IF;
            EXCEPTION WHEN insufficient_privilege THEN
              GET STACKED DIAGNOSTICS message = MESSAGE_TEXT;
              IF operation <> 'INSERT' OR allowed OR message NOT LIKE '%row-level security%' THEN RAISE; END IF;
            END;
            RESET ROLE;
            RAISE EXCEPTION 'Rollback matrix operation' USING ERRCODE = 'ZB075';
          EXCEPTION WHEN SQLSTATE 'ZB075' THEN NULL;
          WHEN OTHERS THEN RAISE EXCEPTION 'Matrix failed: %, %, parent %, %: %', person.label, table_name, idx, operation, SQLERRM;
          END;
          checks := checks + 1;
        END LOOP;
      END LOOP;
    END LOOP;

    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',person.user_id,'role',person.database_role)::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(person.user_id::text,''), true);
    EXECUTE format('SET LOCAL ROLE %I', person.database_role);
    FOREACH table_name IN ARRAY future_tables LOOP
      EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO actual_count;
      IF actual_count <> 0 THEN RAISE EXCEPTION 'Future SELECT opened on %', table_name; END IF;
      EXECUTE format('UPDATE public.%I SET created_at = created_at', table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION 'Future UPDATE opened on %', table_name; END IF;
      EXECUTE format('DELETE FROM public.%I', table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION 'Future DELETE opened on %', table_name; END IF;
      future_checks := future_checks + 3;
    END LOOP;
    RESET ROLE;
  END LOOP;

  -- Insert/update boundaries must still hold for OWNER AB, who can see both
  -- catalogs and memberships; ordinary FK existence and RLS visibility are not enough.
  FOR person IN SELECT * FROM (VALUES
    (users[1], 'OWNER', 'Owner A'), (users[3], 'BARBER', 'Barber A1'), (users[6], 'OWNER', 'Owner AB')
  ) AS people(user_id,business_role,label) LOOP
    FOR scenario IN SELECT * FROM (VALUES
      ('foreign client INSERT', format('INSERT INTO public.appointments (business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES (%L,%L,%L,''2030-01-07T12:00Z'',''2030-01-07T13:00Z'',%L)',biz[1],clients[2],members[3],person.user_id), false),
      ('foreign client UPDATE', format('UPDATE public.appointments SET client_id = %L WHERE id = %L',clients[2],appts[1]), false),
      ('foreign member INSERT', format('INSERT INTO public.appointments (business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES (%L,%L,%L,''2030-01-07T12:00Z'',''2030-01-07T13:00Z'',%L)',biz[1],clients[1],members[5],person.user_id), false),
      ('foreign member UPDATE', format('UPDATE public.appointments SET barber_member_id = %L WHERE id = %L',members[5],appts[1]), false),
      ('spoof creator INSERT', format('INSERT INTO public.appointments (business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES (%L,%L,%L,''2030-01-07T12:00Z'',''2030-01-07T13:00Z'',%L)',biz[1],clients[1],members[3],users[2]), false),
      ('same-tenant member INSERT', format('INSERT INTO public.appointments (business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES (%L,%L,%L,''2030-01-07T12:00Z'',''2030-01-07T13:00Z'',%L)',biz[1],clients[1],members[4],person.user_id), person.business_role = 'OWNER'),
      ('same-tenant reassignment', format('UPDATE public.appointments SET barber_member_id = %L WHERE id = %L',members[4],appts[1]), person.business_role = 'OWNER'),
      ('inactive member INSERT', format('INSERT INTO public.appointments (business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES (%L,%L,%L,''2030-01-07T12:00Z'',''2030-01-07T13:00Z'',%L)',biz[1],clients[1],members[8],person.user_id), person.business_role = 'OWNER'),
      ('inactive member reassignment', format('UPDATE public.appointments SET barber_member_id = %L WHERE id = %L',members[8],appts[1]), person.business_role = 'OWNER'),
      ('OWNER membership assignment', format('UPDATE public.appointments SET barber_member_id = %L WHERE id = %L',members[1],appts[1]), person.business_role = 'OWNER'),
      ('archived client INSERT', format('INSERT INTO public.appointments (business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES (%L,%L,%L,''2030-01-07T12:00Z'',''2030-01-07T13:00Z'',%L)',biz[1],clients[3],members[3],person.user_id), true),
      ('archived client UPDATE', format('UPDATE public.appointments SET client_id = %L WHERE id = %L',clients[3],appts[1]), true),
      ('foreign service INSERT', format('INSERT INTO public.appointment_services (appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,line_total) VALUES (%L,%L,''Snapshot'',10,30,10)',appts[1],services[2]), false),
      ('foreign service UPDATE', format('UPDATE public.appointment_services SET service_id = %L WHERE id = %L',services[2],lines[1]), false),
      ('NULL service INSERT', format('INSERT INTO public.appointment_services (appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,line_total) VALUES (%L,NULL,''Snapshot only'',10,30,10)',appts[1]), true),
      ('NULL service UPDATE', format('UPDATE public.appointment_services SET service_id = NULL WHERE id = %L',lines[1]), true),
      ('archived service INSERT', format('INSERT INTO public.appointment_services (appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,line_total) VALUES (%L,%L,''Archived snapshot'',10,30,10)',appts[1],services[3]), true),
      ('archived service UPDATE', format('UPDATE public.appointment_services SET service_id = %L WHERE id = %L',services[3],lines[1]), true),
      ('COMPLETED to CONFIRMED', format('UPDATE public.appointments SET status = ''COMPLETED'' WHERE id = %L; UPDATE public.appointments SET status = ''CONFIRMED'' WHERE id = %L',appts[1],appts[1]), true)
    ) AS cases(label,statement,allowed) LOOP
      BEGIN
        PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role','authenticated')::text,true);
        PERFORM set_config('request.jwt.claim.sub',person.user_id::text,true);
        SET LOCAL ROLE authenticated;
        BEGIN
          EXECUTE scenario.statement;
          GET DIAGNOSTICS affected = ROW_COUNT;
          IF NOT scenario.allowed OR affected <> 1 THEN RAISE EXCEPTION 'Unexpected boundary success/row count'; END IF;
        EXCEPTION WHEN insufficient_privilege THEN
          IF scenario.allowed OR SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
        END;
        RESET ROLE;
        RAISE EXCEPTION 'Rollback boundary case' USING ERRCODE = 'ZB075';
      EXCEPTION WHEN SQLSTATE 'ZB075' THEN NULL;
      WHEN OTHERS THEN RAISE EXCEPTION 'Boundary failed: %, %: %',person.label,scenario.label,SQLERRM;
      END;
      boundary_checks := boundary_checks + 1;
    END LOOP;
  END LOOP;

  -- A BARBER cannot take an appointment owned by a different assigned barber.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[3],'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',users[3]::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE public.appointments SET barber_member_id = members[3] WHERE id = appts[2];
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'BARBER took another appointment'; END IF;
  RESET ROLE;
  -- Matching the referenced membership id alone is insufficient across tenants.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[5],'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',users[5]::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO actual_count FROM public.appointments WHERE id = appts[6];
  IF actual_count <> 0 THEN RAISE EXCEPTION 'BARBER read a legacy cross-tenant assignment'; END IF;
  SELECT count(*) INTO actual_count FROM public.appointment_services WHERE id = lines[6];
  IF actual_count <> 0 THEN RAISE EXCEPTION 'Child leaked a legacy cross-tenant assignment'; END IF;
  RESET ROLE;

  -- Authorized source rows and otherwise-valid administrator controls guarantee
  -- these failures are column privileges (42501), not hidden rows or FK errors.
  FOR person IN SELECT * FROM (VALUES (users[6], 'Owner AB'),(users[3], 'Barber A1')) AS people(user_id,label) LOOP
    FOR scenario IN SELECT * FROM (VALUES
      ('appointments',appts[1],format('UPDATE public.appointments SET business_id = %L, client_id = %L, barber_member_id = %L WHERE id = %L',biz[2],clients[2],members[5],appts[1])),
      ('appointments',appts[1],format('UPDATE public.appointments SET created_by = %L WHERE id = %L',users[2],appts[1])),
      ('appointment_services',lines[1],format('UPDATE public.appointment_services SET appointment_id = %L WHERE id = %L',appts[2],lines[1])),
      ('appointment_services',lines[1],format('UPDATE public.appointment_services SET appointment_id = %L, service_id = %L WHERE id = %L',appts[3],services[2],lines[1]))
    ) AS cases(table_name,row_id,statement) LOOP
      BEGIN
        EXECUTE scenario.statement;
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 1 THEN RAISE EXCEPTION 'Invalid administrator control'; END IF;
        RAISE EXCEPTION 'Rollback administrator control' USING ERRCODE = 'ZB075';
      EXCEPTION WHEN SQLSTATE 'ZB075' THEN NULL; END;
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role','authenticated')::text,true);
      PERFORM set_config('request.jwt.claim.sub',person.user_id::text,true);
      SET LOCAL ROLE authenticated;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE id = %L',scenario.table_name,scenario.row_id) INTO actual_count;
      IF actual_count <> 1 THEN RAISE EXCEPTION 'Source is not visible to authorized caller'; END IF;
      BEGIN
        EXECUTE scenario.statement;
        RAISE EXCEPTION 'Protected column changed';
      EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM NOT LIKE '%permission denied%' OR SQLERRM LIKE '%row-level security%' THEN
          RAISE EXCEPTION 'Expected column privilege boundary: %',SQLERRM;
        END IF;
      END;
      RESET ROLE;
      column_checks := column_checks + 1;
    END LOOP;
  END LOOP;

  -- Revocation/reactivation of both literal roles in A/B, using the same identity.
  FOR idx IN 1..5 LOOP
    BEGIN
      side := CASE WHEN idx IN (2,5) THEN 2 ELSE 1 END;
      UPDATE public.business_members SET is_active = false WHERE id = members[idx];
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[idx],'role','authenticated')::text,true);
      PERFORM set_config('request.jwt.claim.sub',users[idx]::text,true);
      SET LOCAL ROLE authenticated;
      IF public.is_business_member(biz[side]) OR public.has_business_role(biz[side],ARRAY['OWNER','BARBER']) THEN
        RAISE EXCEPTION 'Revoked helper authorization persists';
      END IF;
      FOREACH table_name IN ARRAY ARRAY['appointments','appointment_services'] LOOP
        EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO actual_count;
        IF actual_count <> 0 THEN RAISE EXCEPTION 'Revoked SELECT persists'; END IF;
        EXECUTE format('UPDATE public.%I SET created_at = created_at',table_name);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'Revoked UPDATE persists'; END IF;
        EXECUTE format('DELETE FROM public.%I',table_name);
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'Revoked DELETE persists'; END IF;
        BEGIN
          IF table_name = 'appointments' THEN
            INSERT INTO public.appointments (business_id,client_id,barber_member_id,start_at,end_at,created_by)
              VALUES (biz[side],clients[side],members[idx],'2030-01-07T12:00Z','2030-01-07T13:00Z',users[idx]);
          ELSE
            INSERT INTO public.appointment_services (appointment_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,line_total)
              VALUES (appts[CASE idx WHEN 2 THEN 3 WHEN 3 THEN 1 WHEN 4 THEN 2 WHEN 5 THEN 3 ELSE 1 END],'Revoked',10,30,10);
          END IF;
          RAISE EXCEPTION 'Revoked INSERT persists';
        EXCEPTION WHEN insufficient_privilege THEN
          IF SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
        END;
        revocation_checks := revocation_checks + 4;
      END LOOP;
      RESET ROLE;
      UPDATE public.business_members SET is_active = true WHERE id = members[idx];
      SET LOCAL ROLE authenticated;
      expected_count := CASE idx WHEN 1 THEN 5 ELSE 1 END;
      FOREACH table_name IN ARRAY ARRAY['appointments','appointment_services'] LOOP
        EXECUTE format('SELECT count(*) FROM public.%I',table_name) INTO actual_count;
        IF actual_count <> expected_count THEN RAISE EXCEPTION 'Reactivation did not restore exact authorized scope'; END IF;
        revocation_checks := revocation_checks + 1;
      END LOOP;
      RESET ROLE;
      RAISE EXCEPTION 'Rollback revocation/reactivation' USING ERRCODE = 'ZB075';
    EXCEPTION WHEN SQLSTATE 'ZB075' THEN NULL; END;
  END LOOP;

  -- Historical inactive assignment is visible to OWNER, and returns to BARBER
  -- when that exact membership becomes active again, without rewriting history.
  BEGIN
    UPDATE public.business_members SET is_active = true WHERE id = members[8];
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[8],'role','authenticated')::text,true);
    PERFORM set_config('request.jwt.claim.sub',users[8]::text,true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO actual_count FROM public.appointments WHERE id = appts[4];
    IF actual_count <> 1 THEN RAISE EXCEPTION 'Historical assignment did not reactivate'; END IF;
    SELECT count(*) INTO actual_count FROM public.appointment_services WHERE id = lines[4];
    IF actual_count <> 1 THEN RAISE EXCEPTION 'Historical child did not reactivate'; END IF;
    RESET ROLE;
    RAISE EXCEPTION 'Rollback historical reactivation' USING ERRCODE = 'ZB075';
  EXCEPTION WHEN SQLSTATE 'ZB075' THEN NULL; END;

  IF (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.appointments a) IS DISTINCT FROM baseline_appointments
     OR (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.appointment_services l) IS DISTINCT FROM baseline_lines THEN
    RAISE EXCEPTION 'Denied operations or temporary controls changed fixtures';
  END IF;
  RAISE NOTICE 'BF-075 passed: % role/parent CRUD checks, % tenant/audit/assignment/nullable-service boundaries, % column privilege denials, % revocation/reactivation checks, % future-domain denials, no recursion, historical inactive assignment and unchanged fixtures',checks,boundary_checks,column_checks,revocation_checks,future_checks;
END;
$$;

ROLLBACK;
