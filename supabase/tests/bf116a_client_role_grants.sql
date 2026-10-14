\set ON_ERROR_STOP on
BEGIN;

-- Effective privileges, not just explicit GRANT text. Any inherited/PUBLIC
-- grant is included by has_*_privilege; column grants are checked separately.
DO $$
DECLARE
  target record;
  col record;
  role_name text;
  privilege_name text;
  expected boolean;
  checks integer := 0;
  read_only constant text[] := ARRAY['sales','sale_items','payments','purchases','purchase_items','stock_movements','appointments','appointment_services'];
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Run this local suite as migration owner postgres'; END IF;
  IF (SELECT count(*) FROM pg_tables WHERE schemaname='public') <> 19
     OR (SELECT count(*) FROM pg_policies WHERE schemaname='public') <> 41 THEN
    RAISE EXCEPTION 'Unexpected table/policy inventory';
  END IF;
  FOR target IN SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') LOOP
    IF target.relowner <> 'postgres'::regrole OR NOT target.relrowsecurity OR target.relforcerowsecurity THEN
      RAISE EXCEPTION 'Ownership/RLS changed: %',target.relname;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF NOT has_schema_privilege(role_name,'public','USAGE')
         OR has_schema_privilege(role_name,'public','CREATE') THEN
        RAISE EXCEPTION 'Unexpected public schema privileges: %',role_name;
      END IF;
      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        expected := CASE role_name
          WHEN 'anon' THEN false
          WHEN 'service_role' THEN true
          ELSE CASE privilege_name
            WHEN 'SELECT' THEN true
            WHEN 'INSERT' THEN target.relname <> 'businesses' AND NOT target.relname = ANY(read_only)
            WHEN 'UPDATE' THEN target.relname IN ('profiles','businesses')
            WHEN 'DELETE' THEN target.relname IN ('business_hours')
            ELSE false END END;
        IF has_table_privilege(role_name,target.oid,privilege_name) IS DISTINCT FROM expected THEN
          RAISE EXCEPTION 'Wrong effective table grant: % % %',role_name,target.relname,privilege_name;
        END IF;
        checks := checks+1;
      END LOOP;
      IF role_name <> 'service_role' AND
         (pg_has_role(role_name,target.relowner,'USAGE') OR
          (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname=role_name)) THEN
        RAISE EXCEPTION 'Client role can bypass RLS: %',role_name;
      END IF;
      FOR col IN SELECT * FROM pg_attribute WHERE attrelid=target.oid AND attnum>0 AND NOT attisdropped LOOP
        FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
          expected := CASE role_name WHEN 'anon' THEN false WHEN 'service_role' THEN true
            ELSE CASE privilege_name
              WHEN 'SELECT' THEN true
              WHEN 'INSERT' THEN target.relname <> 'businesses' AND NOT target.relname = ANY(read_only)
              WHEN 'UPDATE' THEN CASE
                WHEN target.relname = ANY(read_only) THEN false
                WHEN target.relname IN ('profiles','businesses') THEN true
                WHEN target.relname='expenses' THEN col.attname = ANY(ARRAY['category_id','description','amount','payment_method','expense_date','receipt_path','notes'])
                WHEN target.relname='appointment_services' THEN false
                WHEN target.relname='appointments' THEN false
                ELSE col.attname <> 'business_id' END
              ELSE false END END;
          IF has_column_privilege(role_name,target.oid,col.attname,privilege_name) IS DISTINCT FROM expected THEN
            RAISE EXCEPTION 'Wrong effective column grant: % %.% %',role_name,target.relname,col.attname,privilege_name;
          END IF;
          checks := checks+1;
        END LOOP;
      END LOOP;
    END LOOP;
    IF EXISTS (SELECT 1 FROM aclexplode(target.relacl) WHERE grantee=0) THEN
      RAISE EXCEPTION 'PUBLIC table grant: %',target.relname;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private')) <> 12 THEN
    RAISE EXCEPTION 'Unexpected helper/RPC inventory';
  END IF;
  FOR target IN SELECT p.*,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') LOOP
    IF target.proowner <> 'postgres'::regrole OR target.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR target.prosecdef IS DISTINCT FROM (target.proname IN ('is_business_member','has_business_role','can_read_payment','get_client_stats','guard_business_currency_change','create_appointment_with_services'))
       OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(target.proacl,acldefault('f',target.proowner))) WHERE grantee=0 AND privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'Unsafe function owner/search_path/definer/PUBLIC ACL: %',target.proname;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      expected := CASE role_name WHEN 'anon' THEN false
        WHEN 'authenticated' THEN target.proname IN ('is_business_member','has_business_role','can_read_payment','get_client_stats','save_business_hours','get_availability','appointment_slot_candidates','create_appointment_with_services')
        ELSE target.nspname='public' AND target.proname NOT IN ('get_client_stats','save_business_hours','get_availability','create_appointment_with_services') END;
      IF has_function_privilege(role_name,target.oid,'EXECUTE') IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'Wrong function EXECUTE: % %',role_name,target.proname;
      END IF;
      checks := checks+1;
    END LOOP;
  END LOOP;
  IF NOT has_schema_privilege('authenticated','private','USAGE')
     OR has_schema_privilege('authenticated','private','CREATE')
     OR has_schema_privilege('anon','private','USAGE')
     OR has_schema_privilege('service_role','private','USAGE')
     OR NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role') THEN
    RAISE EXCEPTION 'Private schema/service_role contract changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relkind='S') THEN
    RAISE EXCEPTION 'Unexpected existing public sequence';
  END IF;
  RAISE NOTICE 'BF-116A effective ACL passed: % table/column/function checks; 19 RLS tables, 41 policies, private helper and service_role preserved',checks;
END;
$$;

-- Exercise defaults with real objects created by the actual migration owner.
-- No RLS on this probe: SQL grants alone must close the creation-time window.
CREATE TABLE public.bf116a_grant_probe (id integer);
CREATE SEQUENCE public.bf116a_sequence_probe;
DO $$
DECLARE r text; p text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege(r,'public.bf116a_grant_probe',p) IS DISTINCT FROM (r='service_role') THEN
        RAISE EXCEPTION 'Unsafe/missing future table default: % %',r,p;
      END IF;
    END LOOP;
    FOREACH p IN ARRAY ARRAY['USAGE','SELECT','UPDATE'] LOOP
      IF has_sequence_privilege(r,'public.bf116a_sequence_probe',p) IS DISTINCT FROM (r='service_role') THEN
        RAISE EXCEPTION 'Unsafe/missing future sequence default: % %',r,p;
      END IF;
    END LOOP;
  END LOOP;
  SET LOCAL ROLE anon;
  BEGIN PERFORM 1 FROM public.bf116a_grant_probe;
    RAISE EXCEPTION 'Anon can query a new public table';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  BEGIN INSERT INTO public.bf116a_grant_probe VALUES (1);
    RAISE EXCEPTION 'Authenticated can write a new public table';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  INSERT INTO public.bf116a_grant_probe VALUES (nextval('public.bf116a_sequence_probe'));
  UPDATE public.bf116a_grant_probe SET id=id+1;
  DELETE FROM public.bf116a_grant_probe;
  RESET ROLE;
  RAISE NOTICE 'BF-116A future defaults passed: 33 effective grants, denied client access and retained service_role DML/sequence use';
END;
$$;
DROP TABLE public.bf116a_grant_probe;
DROP SEQUENCE public.bf116a_sequence_probe;

DO $$
DECLARE
  owner_id uuid := gen_random_uuid(); barber_id uuid := gen_random_uuid();
  biz uuid := gen_random_uuid(); foreign_biz uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid(); client_id uuid := gen_random_uuid();
  actor uuid; affected bigint; total bigint;
BEGIN
  INSERT INTO auth.users(id) VALUES(owner_id),(barber_id);
  INSERT INTO public.businesses(id,name) VALUES(biz,'BF116A A'),(foreign_biz,'BF116A B');
  INSERT INTO public.business_members(business_id,user_id,role) VALUES(biz,owner_id,'OWNER');
  INSERT INTO public.business_members(id,business_id,user_id,role) VALUES(member_id,biz,barber_id,'BARBER');
  INSERT INTO public.clients(id,business_id,first_name,updated_at) VALUES(client_id,biz,'Existing','2026-01-01T00:00:00Z');
  INSERT INTO public.clients(business_id,first_name) VALUES(foreign_biz,'Foreign');
  FOREACH actor IN ARRAY ARRAY[owner_id,barber_id] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    PERFORM set_config('request.jwt.claim.sub',actor::text,true);
    SET LOCAL ROLE authenticated;
    IF NOT row_security_active('public.clients') THEN RAISE EXCEPTION 'RLS inactive'; END IF;
    SELECT count(*) INTO total FROM public.clients WHERE business_id=foreign_biz;
    IF total <> 0 THEN RAISE EXCEPTION 'Cross-business read'; END IF;
    INSERT INTO public.clients(business_id,first_name) VALUES(biz,'Allowed');
    UPDATE public.clients SET notes='Allowed' WHERE id=client_id;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected <> 1 OR (SELECT updated_at FROM public.clients WHERE id=client_id) <> transaction_timestamp() THEN
      RAISE EXCEPTION 'Legitimate write/timestamp trigger broken without direct EXECUTE';
    END IF;
    UPDATE public.clients SET notes='Denied' WHERE business_id=foreign_biz;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Cross-business update'; END IF;
    BEGIN INSERT INTO public.clients(business_id,first_name) VALUES(foreign_biz,'Denied');
      RAISE EXCEPTION 'Cross-business insert';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%row-level security%' THEN RAISE; END IF;
    END;
    BEGIN UPDATE public.clients SET business_id=foreign_biz WHERE id=client_id;
      RAISE EXCEPTION 'Tenant column writable';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN DELETE FROM public.clients WHERE id=client_id;
      RAISE EXCEPTION 'Archive-only table deletable';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
  END LOOP;
  UPDATE public.business_members SET is_active=false WHERE id=member_id;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO total FROM public.clients;
  IF total <> 0 THEN RAISE EXCEPTION 'Inactive member retains access'; END IF;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN PERFORM 1 FROM public.clients;
    RAISE EXCEPTION 'Anon retains business SELECT';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE NOTICE 'BF-116A role operations passed: OWNER/BARBER allowed writes, timestamp trigger, tenant/column/DELETE denial, inactive member and anon denial';
END;
$$;
ROLLBACK;
