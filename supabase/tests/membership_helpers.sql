\set ON_ERROR_STOP on
BEGIN;

-- Local administrative fixtures only. BF-073 scopes direct reads; helper semantics
-- remain unchanged. No policy, helper mock or data survives this test.
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
    'stock_movements.stock_movements_select_members'
  ];
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_nonmember uuid := gen_random_uuid();
  v_inactive_user uuid := gen_random_uuid();
  v_business_a uuid := gen_random_uuid();
  v_business_b uuid := gen_random_uuid();
  v_inactive_business uuid := gen_random_uuid();
  v_missing_business uuid := gen_random_uuid();
  v_case record;
  v_function record;
  v_count bigint;
  v_members_before jsonb;
  v_members_after jsonb;
  v_businesses_before jsonb;
  v_users_before jsonb;
  v_checks integer := 0;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('public.is_business_member(uuid)', ARRAY['target_business_id']::text[]),
      ('public.has_business_role(uuid,text[])', ARRAY['target_business_id', 'allowed_roles']::text[])
    ) AS expected(signature, argument_names)
  LOOP
    SELECT p.*, l.lanname INTO STRICT v_function
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = to_regprocedure(v_case.signature);
    IF NOT v_function.prosecdef OR v_function.provolatile <> 's'
       OR v_function.lanname <> 'sql' OR v_function.prorettype <> 'pg_catalog.bool'::regtype
       OR v_function.proretset OR v_function.proisstrict OR v_function.proleakproof
       OR v_function.pronargdefaults <> 0 OR v_function.proargmodes IS NOT NULL
       OR v_function.proargnames IS DISTINCT FROM v_case.argument_names
       OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION 'Incorrect signature, scalar boolean, SQL/STABLE/DEFINER or search_path: %', v_case.signature;
    END IF;
    IF pg_get_userbyid(v_function.proowner) <> 'postgres'
       OR v_function.proowner <> (SELECT relowner FROM pg_class WHERE oid = 'public.business_members'::regclass)
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid = v_function.proowner AND rolbypassrls) THEN
      RAISE EXCEPTION 'Unexpected owner or missing owner RLS bypass: %', v_case.signature;
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(v_function.proacl)
               WHERE grantee = 0 AND privilege_type = 'EXECUTE')
       OR has_function_privilege('anon', v_function.oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_function.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_function.oid, 'EXECUTE WITH GRANT OPTION') THEN
      RAISE EXCEPTION 'Incorrect PUBLIC/anon/authenticated EXECUTE permissions: %', v_case.signature;
    END IF;
    -- The existing Supabase default ACL grants service_role EXECUTE. No special
    -- service_role grant is required or introduced by the migration.
    IF NOT has_function_privilege('service_role', v_function.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Existing service_role EXECUTE unexpectedly removed: %', v_case.signature;
    END IF;
    RAISE NOTICE '%: owner postgres, SQL/STABLE/DEFINER, boolean only, pinned search_path, authenticated/service_role EXECUTE, no PUBLIC/anon EXECUTE', v_case.signature;
  END LOOP;

  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')) <> 19
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'BF-072 must preserve 19 RLS tables and no FORCE';
  END IF;
  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public')
     IS DISTINCT FROM (SELECT array_agg(p ORDER BY p) FROM unnest(v_policy_names) AS names(p)) THEN
    RAISE EXCEPTION 'Expected exactly the 35 approved BF-073/BF-074/BF-075/BF-076 policies and no others';
  END IF;

  INSERT INTO auth.users (id) VALUES (v_user_a), (v_user_b), (v_nonmember), (v_inactive_user);
  INSERT INTO public.businesses (id, name, is_active)
    VALUES (v_business_a, 'Membership A', true), (v_business_b, 'Membership B', true),
           (v_inactive_business, 'Inactive business with active membership', false);
  INSERT INTO public.business_members (business_id, user_id, role, is_active)
    VALUES (v_business_a, v_user_a, 'OWNER', true),
           (v_business_b, v_user_b, 'BARBER', true),
           (v_business_a, v_inactive_user, 'OWNER', false),
           (v_business_b, v_inactive_user, 'BARBER', false),
           (v_inactive_business, v_user_a, 'BARBER', true);
  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO v_members_before FROM public.business_members m;
  SELECT jsonb_agg(to_jsonb(b) ORDER BY id) INTO v_businesses_before FROM public.businesses b;
  SELECT jsonb_agg(to_jsonb(u) ORDER BY id) INTO v_users_before FROM auth.users u;

  -- A caller-controlled relation with the same name must never replace the
  -- qualified public relation in the definer. The fake cross-business OWNER
  -- would turn denied cases true if the helper used an unsafe relation lookup.
  CREATE TEMP TABLE business_members (business_id uuid, user_id uuid, role text, is_active boolean);
  INSERT INTO pg_temp.business_members VALUES (v_business_b, v_user_a, 'OWNER', true);
  SET LOCAL search_path = pg_temp, public, auth;

  SET LOCAL ROLE authenticated;
  FOR v_case IN
    SELECT * FROM (VALUES
      (v_user_a, v_business_a, ARRAY['OWNER']::text[], true, true, 'OWNER exact'),
      (v_user_a, v_business_a, ARRAY['BARBER']::text[], true, false, 'OWNER is not BARBER'),
      (v_user_a, v_business_a, ARRAY['OWNER','BARBER']::text[], true, true, 'OWNER in set'),
      (v_user_b, v_business_b, ARRAY['BARBER']::text[], true, true, 'BARBER exact'),
      (v_user_b, v_business_b, ARRAY['OWNER']::text[], true, false, 'BARBER is not OWNER'),
      (v_user_b, v_business_b, ARRAY['OWNER','BARBER']::text[], true, true, 'BARBER in set'),
      (v_user_a, v_business_b, ARRAY['OWNER','BARBER']::text[], false, false, 'A cannot use B'),
      (v_user_b, v_business_a, ARRAY['OWNER','BARBER']::text[], false, false, 'B cannot use A'),
      (v_nonmember, v_business_a, ARRAY['OWNER','BARBER']::text[], false, false, 'No membership'),
      (v_inactive_user, v_business_a, ARRAY['OWNER','BARBER']::text[], false, false, 'Inactive OWNER'),
      (v_inactive_user, v_business_b, ARRAY['OWNER','BARBER']::text[], false, false, 'Inactive BARBER'),
      (v_user_a, NULL::uuid, ARRAY['OWNER','BARBER']::text[], false, false, 'NULL business'),
      (v_user_a, v_missing_business, ARRAY['OWNER','BARBER']::text[], false, false, 'Missing business'),
      (v_user_a, v_business_a, ARRAY[]::text[], true, false, 'Empty role set'),
      (v_user_a, v_business_a, NULL::text[], true, false, 'NULL role set'),
      (v_user_a, v_business_a, ARRAY[NULL]::text[], true, false, 'NULL role element'),
      (v_user_a, v_business_a, ARRAY['OWNER',NULL]::text[], true, true, 'Match plus NULL'),
      (v_user_a, v_business_a, ARRAY['owner']::text[], true, false, 'Literal case sensitivity'),
      (v_user_a, v_business_a, ARRAY['UNKNOWN']::text[], true, false, 'Unknown allowed role'),
      (v_user_a, v_business_a, ARRAY['OWNER','OWNER']::text[], true, true, 'Duplicate allowed roles'),
      (NULL::uuid, v_business_a, ARRAY['OWNER','BARBER']::text[], false, false, 'Missing auth.uid'),
      (v_user_a, v_inactive_business, ARRAY['BARBER']::text[], true, true, 'Only membership activity matters'),
      (v_user_a, v_inactive_business, ARRAY['OWNER']::text[], true, false, 'Inactive business grants no extra role')
    ) AS cases(user_id, business_id, roles, expected_member, expected_role, label)
  LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_case.user_id)::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_case.user_id::text, ''), true);
    IF current_user <> 'authenticated' OR auth.uid() IS DISTINCT FROM v_case.user_id
       OR NOT row_security_active('public.business_members'::regclass) THEN
      RAISE EXCEPTION 'Identity/RLS simulation failed: %', v_case.label;
    END IF;
    SELECT count(*) INTO v_count FROM public.business_members;
    IF v_count <> (CASE v_case.user_id WHEN v_user_a THEN 3 WHEN v_user_b THEN 2 ELSE 0 END)
       OR EXISTS (SELECT 1 FROM public.business_members
                  WHERE NOT (CASE v_case.user_id
                    WHEN v_user_a THEN business_id IN (v_business_a, v_inactive_business)
                    WHEN v_user_b THEN business_id = v_business_b ELSE false END)) THEN
      RAISE EXCEPTION 'Direct membership rows differ from BF-073 tenant scope: %', v_case.label;
    END IF;
    IF public.is_business_member(v_case.business_id) IS DISTINCT FROM v_case.expected_member
       OR public.has_business_role(v_case.business_id, v_case.roles) IS DISTINCT FROM v_case.expected_role THEN
      RAISE EXCEPTION 'Membership/role result mismatch: %', v_case.label;
    END IF;
    IF current_setting('search_path') <> 'pg_temp, public, auth' THEN
      RAISE EXCEPTION 'Definer search_path escaped into caller context';
    END IF;
    v_checks := v_checks + 2;
  END LOOP;
  RESET ROLE;

  -- Authorization must observe deactivation/reactivation across SQL statements,
  -- rather than caching a previous successful membership result indefinitely.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_user_a)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  UPDATE public.business_members SET is_active = false WHERE business_id = v_business_a AND user_id = v_user_a;
  SET LOCAL ROLE authenticated;
  IF public.is_business_member(v_business_a) IS DISTINCT FROM false
     OR public.has_business_role(v_business_a, ARRAY['OWNER']) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Deactivated membership still authorizes';
  END IF;
  RESET ROLE;
  UPDATE public.business_members SET is_active = true WHERE business_id = v_business_a AND user_id = v_user_a;
  SET LOCAL ROLE authenticated;
  IF public.is_business_member(v_business_a) IS DISTINCT FROM true
     OR public.has_business_role(v_business_a, ARRAY['OWNER']) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Reactivated membership is not visible';
  END IF;
  RESET ROLE;
  v_checks := v_checks + 4;

  -- With a NULL uid an authorized caller gets false (covered above). Actual
  -- anon cannot execute either helper: the stricter EXECUTE boundary wins.
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'anon uid must be NULL'; END IF;
  BEGIN
    PERFORM public.is_business_member(v_business_a);
    RAISE EXCEPTION 'anon can execute is_business_member';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.has_business_role(v_business_a, ARRAY['OWNER']);
    RAISE EXCEPTION 'anon can execute has_business_role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- A service role bypass must not make the helper impersonate an arbitrary
  -- member: it still derives its answer only from the current request identity.
  SET LOCAL ROLE service_role;
  IF public.is_business_member(v_business_a) IS DISTINCT FROM false
     OR public.has_business_role(v_business_a, ARRAY['OWNER']) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'service_role without uid bypasses helper identity checks';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role', 'sub', v_user_a)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  IF public.is_business_member(v_business_a) IS DISTINCT FROM true
     OR public.has_business_role(v_business_b, ARRAY['OWNER','BARBER']) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'service_role helper does not preserve membership semantics';
  END IF;
  RESET ROLE;

  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO v_members_after FROM public.business_members m;
  IF v_members_after IS DISTINCT FROM v_members_before
     OR (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.businesses b) IS DISTINCT FROM v_businesses_before
     OR (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u) IS DISTINCT FROM v_users_before THEN
    RAISE EXCEPTION 'Helpers changed fixture data';
  END IF;
  IF (SELECT array_agg(tablename || '.' || policyname ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public')
     IS DISTINCT FROM (SELECT array_agg(p ORDER BY p) FROM unnest(v_policy_names) AS names(p)) THEN
    RAISE EXCEPTION 'Expected exactly the 35 approved BF-073/BF-074/BF-075/BF-076 policies and no others';
  END IF;
  RAISE NOTICE 'BF-072 passed: % authenticated helper results, scoped direct membership reads, no recursion, hostile search_path, NULL safety, literal roles, revocation, anon EXECUTE denial, service_role semantics, 35 approved policies and unchanged fixtures', v_checks;
END;
$$;

ROLLBACK;
