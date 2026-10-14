\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';

DO $$
DECLARE
  fn record;
BEGIN
  SELECT p.* INTO STRICT fn FROM pg_proc p
    WHERE p.oid = 'public.get_client_stats(uuid,uuid)'::regprocedure;
  IF fn.pronargs <> 2 OR fn.pronargdefaults <> 0
     OR fn.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_client_id',
       'total_appointments','completed_visits','no_show_count','last_visit_at',
       'next_appointment_at','total_spent']::text[]
     OR fn.proallargtypes IS DISTINCT FROM ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid,
       'bigint'::regtype::oid,'bigint'::regtype::oid,'bigint'::regtype::oid,
       'timestamptz'::regtype::oid,'timestamptz'::regtype::oid,'numeric'::regtype::oid]
     OR fn.proargmodes IS DISTINCT FROM ARRAY['i','i','t','t','t','t','t','t']::"char"[]
     OR fn.prorettype <> 'record'::regtype OR NOT fn.proretset
     OR NOT fn.prosecdef OR fn.provolatile <> 's' OR fn.proisstrict OR fn.proleakproof
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR fn.proowner <> 'postgres'::regrole
     OR fn.proowner <> (SELECT relowner FROM pg_class WHERE oid = 'public.clients'::regclass)
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='get_client_stats') <> 1 THEN
    RAISE EXCEPTION 'BF-245 signature, typed aggregate projection or execution context differs';
  END IF;
  IF NOT has_function_privilege('authenticated',fn.oid,'EXECUTE')
     OR has_function_privilege('anon',fn.oid,'EXECUTE')
     OR has_function_privilege('service_role',fn.oid,'EXECUTE')
     OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(fn.proacl,acldefault('f',fn.proowner))) acl
       WHERE acl.grantee NOT IN (fn.proowner,'authenticated'::regrole)
          OR acl.privilege_type <> 'EXECUTE' OR acl.is_grantable) THEN
    RAISE EXCEPTION 'BF-245 EXECUTE must be authenticated-only, no PUBLIC or backend default';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public') <> 41
     OR (SELECT count(*) FROM pg_tables WHERE schemaname='public') <> 19
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p')
         AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'BF-245 must preserve 19 RLS tables, FORCE off and41 policies';
  END IF;
  RAISE NOTICE 'BF-245 metadata passed: native six-column signature, STABLE definer, postgres owner, empty path, authenticated-only EXECUTE';
END;
$$;

-- Hostile caller path must not replace any relation read by the definer.
CREATE TEMP TABLE appointments (business_id uuid,client_id uuid,status text,start_at timestamptz);
CREATE TEMP TABLE sales (business_id uuid,client_id uuid,status text,total numeric);
CREATE TEMP TABLE clients (id uuid,business_id uuid);
CREATE TEMP TABLE business_members (business_id uuid,user_id uuid,role text,is_active boolean);

DO $$
DECLARE
  users uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,7));
  biz uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  client_ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,6));
  members uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,6));
  appointment_ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,16));
  sale_ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,9));
  service_id uuid := gen_random_uuid();
  missing_id uuid := gen_random_uuid();
  reference_now timestamptz := now();
  actual record;
  before_rows jsonb := '{}'::jsonb;
  rows jsonb;
  source_table text;
  person record;
  target record;
  error_state text;
  error_message text;
  expected_spent numeric;
  visible_count bigint;
  checks integer := 0;
BEGIN
  INSERT INTO auth.users (id) SELECT unnest(users);
  INSERT INTO public.businesses (id,name,timezone) VALUES
    (biz[1],'BF245 A','America/Argentina/Buenos_Aires'),(biz[2],'BF245 B','UTC');
  -- Owner A, barbers A1/A2, inactive owner/barber A, outsider, owner B.
  INSERT INTO public.business_members (id,business_id,user_id,role,is_active) VALUES
    (members[1],biz[1],users[1],'OWNER',true),
    (members[2],biz[1],users[2],'BARBER',true),
    (members[3],biz[1],users[3],'BARBER',true),
    (members[4],biz[1],users[4],'OWNER',false),
    (members[5],biz[1],users[5],'BARBER',false),
    (members[6],biz[2],users[7],'OWNER',true);
  INSERT INTO public.clients (id,business_id,first_name,is_active) VALUES
    (client_ids[1],biz[1],'History',true),
    (client_ids[2],biz[1],'Empty',true),
    (client_ids[3],biz[1],'Archived',false),
    (client_ids[4],biz[2],'Foreign',true),
    (client_ids[5],biz[1],'Other',true),
    (client_ids[6],biz[1],'Large sum',true);

  -- Fifteen local history rows: two COMPLETED (including future), two NO_SHOW,
  -- PENDING/CONFIRMED future/past/exact-now, and invalid upcoming states.
  INSERT INTO public.appointments
    (id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
  SELECT appointment_ids[input.n],biz[1],client_ids[1],
    CASE WHEN input.n % 2 = 0 THEN members[2] ELSE members[3] END,
    reference_now + input.offset_minutes * interval '1 minute',
    reference_now + (input.offset_minutes + 30) * interval '1 minute',
    input.status,users[1]
  FROM (VALUES
    (1,'COMPLETED',-2880),(2,'COMPLETED',240),
    (3,'NO_SHOW',-1440),(4,'NO_SHOW',10),
    (5,'PENDING',120),(6,'CONFIRMED',60),
    (7,'PENDING',-120),(8,'CONFIRMED',-60),
    (9,'PENDING',0),(10,'CONFIRMED',0),
    (11,'IN_PROGRESS',5),(12,'CANCELLED',6),
    (13,'PENDING',180),(14,'CONFIRMED',90),(15,'CANCELLED',-30)
  ) AS input(n,status,offset_minutes);
  -- Deliberately inconsistent business/client FK data, possible under today's
  -- independent FKs: neither client-only nor business-only filtering is enough.
  INSERT INTO public.appointments
    (id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
  VALUES
    (appointment_ids[16],biz[2],client_ids[1],members[6],reference_now+interval '1 minute',reference_now+interval '31 minutes','COMPLETED',users[7]),
    (gen_random_uuid(),biz[1],client_ids[5],members[2],reference_now+interval '2 minutes',reference_now+interval '32 minutes','PENDING',users[1]),
    (gen_random_uuid(),biz[1],client_ids[3],members[3],reference_now-interval '1 day',reference_now-interval '23 hours','COMPLETED',users[1]);
  INSERT INTO public.sales
    (id,business_id,client_id,appointment_id,operation_id,status,subtotal,discount,total,sold_at,created_by)
  VALUES
    (sale_ids[1],biz[1],client_ids[1],NULL,gen_random_uuid(),'COMPLETED',1.00,0.71,0.29,reference_now,users[1]),
    (sale_ids[2],biz[1],client_ids[1],NULL,gen_random_uuid(),'COMPLETED',1.01,0,1.01,NULL,users[2]),
    (sale_ids[3],biz[1],client_ids[1],NULL,gen_random_uuid(),'DRAFT',100,0,100,reference_now,users[1]),
    (sale_ids[4],biz[1],client_ids[1],NULL,gen_random_uuid(),'VOIDED',200,0,200,reference_now,users[1]),
    (sale_ids[5],biz[1],NULL,appointment_ids[1],gen_random_uuid(),'COMPLETED',300,0,300,reference_now,users[1]),
    (sale_ids[6],biz[1],client_ids[5],NULL,gen_random_uuid(),'COMPLETED',400,0,400,reference_now,users[1]),
    (sale_ids[7],biz[2],client_ids[1],NULL,gen_random_uuid(),'COMPLETED',500,0,500,reference_now,users[7]),
    (sale_ids[8],biz[1],client_ids[6],NULL,gen_random_uuid(),'COMPLETED',9999999999.99,0,9999999999.99,reference_now,users[1]),
    (sale_ids[9],biz[1],client_ids[6],NULL,gen_random_uuid(),'COMPLETED',9999999999.99,0,9999999999.99,reference_now,users[1]);
  INSERT INTO public.services (id,business_id,name,price,duration_minutes)
    VALUES (service_id,biz[1],'Unrelated current catalog price',999,30);
  INSERT INTO public.sale_items (sale_id,item_type,service_id,item_name_snapshot,unit_price_snapshot,line_total)
    VALUES (sale_ids[1],'SERVICE',service_id,'Historical A',0.50,0.50),
           (sale_ids[1],'SERVICE',service_id,'Historical B',0.50,0.50);
  INSERT INTO public.payments (business_id,sale_id,payment_method,amount,created_by)
    VALUES (biz[1],sale_ids[1],'CASH',0.10,users[1]),
           (biz[1],sale_ids[1],'TRANSFER',0.19,users[1]);
  INSERT INTO public.appointment_services
    (appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,line_total)
    VALUES (appointment_ids[1],service_id,'Estimated appointment',999,30,999);

  -- Verify no source or unrelated domain rows change across successful/denied
  -- reads. All fixtures and helper test changes are rolled back by this suite.
  FOR source_table IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.%I t',source_table) INTO rows;
    before_rows := before_rows || jsonb_build_object(source_table,rows);
  END LOOP;
  PERFORM set_config('search_path','pg_temp, public',true);
  PERFORM set_config('role','authenticated',true);
  FOR person IN SELECT * FROM (VALUES (users[1],true),(users[2],false),(users[3],false))
    AS permitted(user_id,is_owner) LOOP
    PERFORM set_config('request.jwt.claim.sub',person.user_id::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role','authenticated')::text,true);
    IF current_user <> 'authenticated' OR auth.uid() <> person.user_id
       OR NOT row_security_active('public.appointments') THEN
      RAISE EXCEPTION 'BF-245 must exercise authenticated identity and real RLS';
    END IF;
    SELECT * INTO STRICT actual FROM public.get_client_stats(biz[1],client_ids[1]);
    expected_spent := CASE WHEN person.is_owner THEN 1.30::numeric ELSE NULL END;
    IF actual.total_appointments <> 15 OR actual.completed_visits <> 2 OR actual.no_show_count <> 2
       OR actual.last_visit_at IS DISTINCT FROM reference_now+interval '240 minutes'
       OR actual.next_appointment_at IS DISTINCT FROM reference_now+interval '60 minutes'
       OR actual.total_spent IS DISTINCT FROM expected_spent THEN
      RAISE EXCEPTION 'BF-245 six metrics/status/time/decimal/role/tenant semantics differ';
    END IF;
    checks := checks+6;
    -- Native return types, and exactly six aggregate fields with no row IDs.
    IF pg_typeof(actual.total_appointments) <> 'bigint'::regtype
       OR pg_typeof(actual.total_spent) <> 'numeric'::regtype
       OR pg_typeof(actual.last_visit_at) <> 'timestamptz'::regtype
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(to_jsonb(actual)) AS keys(key))
          IS DISTINCT FROM ARRAY['completed_visits','last_visit_at','next_appointment_at','no_show_count','total_appointments','total_spent']::text[] THEN
      RAISE EXCEPTION 'BF-245 returns only its typed aggregate projection';
    END IF;
    IF NOT person.is_owner THEN
      SELECT count(*) INTO visible_count FROM public.appointments
        WHERE business_id=biz[1] AND client_id=client_ids[1];
      IF visible_count NOT IN (7,8) THEN
        RAISE EXCEPTION 'BF-245 raw appointments must remain restricted while aggregate includes other barber';
      END IF;
      SELECT count(*) INTO visible_count FROM public.sales WHERE id=sale_ids[1];
      IF visible_count <> 0 THEN RAISE EXCEPTION 'BF-245 must not expand raw sales RLS'; END IF;
      checks := checks+2;
    END IF;
    SELECT * INTO STRICT actual FROM public.get_client_stats(biz[1],client_ids[2]);
    IF actual.total_appointments <> 0 OR actual.completed_visits <> 0 OR actual.no_show_count <> 0
       OR actual.last_visit_at IS NOT NULL OR actual.next_appointment_at IS NOT NULL
       OR actual.total_spent IS DISTINCT FROM (CASE WHEN person.is_owner THEN 0.00::numeric ELSE NULL END) THEN
      RAISE EXCEPTION 'BF-245 authorized empty client must succeed with zero/null semantics';
    END IF;
    SELECT * INTO STRICT actual FROM public.get_client_stats(biz[1],client_ids[3]);
    IF actual.total_appointments <> 1 OR actual.completed_visits <> 1
       OR actual.no_show_count <> 0 OR actual.last_visit_at IS DISTINCT FROM reference_now-interval '1 day'
       OR actual.next_appointment_at IS NOT NULL THEN
      RAISE EXCEPTION 'BF-245 archived client and no upcoming appointment must be supported';
    END IF;
    SELECT * INTO STRICT actual FROM public.get_client_stats(biz[1],client_ids[6]);
    IF actual.total_spent IS DISTINCT FROM (CASE WHEN person.is_owner THEN 19999999999.98::numeric ELSE NULL END) THEN
      RAISE EXCEPTION 'BF-245 SUM must not narrow to the individual numeric(12,2) row limit';
    END IF;
    checks := checks+3;
    -- Authorized missing and foreign-client requests produce identical errors.
    FOR target IN SELECT id FROM (VALUES (missing_id),(client_ids[4])) AS targets(id) LOOP
      error_state := NULL;
      BEGIN
        PERFORM public.get_client_stats(biz[1],target.id);
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS error_state=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT;
      END;
      IF error_state IS DISTINCT FROM 'P0002' OR error_message IS DISTINCT FROM 'CLIENT_NOT_FOUND' THEN
        RAISE EXCEPTION 'BF-245 missing/foreign client must have one safe not-found result';
      END IF;
      checks := checks+1;
    END LOOP;
  END LOOP;
  -- NULL identity, inactive OWNER/BARBER, no membership and other-tenant owner.
  FOR person IN SELECT * FROM (VALUES (NULL::uuid),(users[4]),(users[5]),(users[6]),(users[7]))
    AS denied(user_id) LOOP
    PERFORM set_config('request.jwt.claim.sub',COALESCE(person.user_id::text,''),true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',person.user_id,'role','authenticated')::text,true);
    FOR target IN SELECT id FROM (VALUES (client_ids[1]),(missing_id),(client_ids[4])) AS targets(id) LOOP
      error_state := NULL;
      BEGIN
        PERFORM public.get_client_stats(biz[1],target.id);
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS error_state=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT;
      END;
      IF error_state IS DISTINCT FROM '42501' OR error_message IS DISTINCT FROM 'CLIENT_ACCESS_DENIED' THEN
        RAISE EXCEPTION 'BF-245 unauthorized caller must be denied before client existence lookup';
      END IF;
      checks := checks+1;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub',users[1]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  error_state := NULL;
  BEGIN
    PERFORM public.get_client_stats(biz[2],client_ids[4]);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_state=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT;
  END;
  IF error_state IS DISTINCT FROM '42501' OR error_message IS DISTINCT FROM 'CLIENT_ACCESS_DENIED' THEN
    RAISE EXCEPTION 'BF-245 cross-business query must fail without leaking foreign activity';
  END IF;
  checks := checks+1;
  FOR target IN SELECT * FROM (VALUES (NULL::uuid,client_ids[1]),(biz[1],NULL::uuid)) AS bad(business_id,client_id) LOOP
    error_state := NULL;
    BEGIN
      PERFORM public.get_client_stats(target.business_id,target.client_id);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS error_state=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT;
    END;
    IF error_state IS DISTINCT FROM '22023' OR error_message IS DISTINCT FROM 'INVALID_INPUT' THEN
      RAISE EXCEPTION 'BF-245 NULL IDs must fail safely, not return an empty set';
    END IF;
    checks := checks+1;
  END LOOP;
  PERFORM set_config('role','anon',true);
  error_state := NULL;
  BEGIN
    PERFORM public.get_client_stats(biz[1],client_ids[1]);
  EXCEPTION WHEN insufficient_privilege THEN error_state := SQLSTATE;
  END;
  IF error_state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'BF-245 anon EXECUTE must fail'; END IF;
  checks := checks+1;
  PERFORM set_config('role','none',true);
  FOR source_table IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.%I t',source_table) INTO rows;
    IF COALESCE(rows,'null'::jsonb) IS DISTINCT FROM before_rows->source_table THEN
      RAISE EXCEPTION 'BF-245 read unexpectedly changed public.%',source_table;
    END IF;
  END LOOP;
  -- Revocation is effective on the next statement; inactive business alone does
  -- not override the existing active-membership helper contract.
  UPDATE public.businesses SET is_active=false WHERE id=biz[1];
  PERFORM set_config('role','authenticated',true);
  SELECT * INTO STRICT actual FROM public.get_client_stats(biz[1],client_ids[1]);
  IF actual.total_spent <> 1.30 THEN RAISE EXCEPTION 'BF-245 must not add a business.is_active filter'; END IF;
  PERFORM set_config('role','none',true);
  UPDATE public.business_members SET is_active=false WHERE id=members[1];
  PERFORM set_config('role','authenticated',true);
  error_state := NULL;
  BEGIN
    PERFORM public.get_client_stats(biz[1],client_ids[1]);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_state=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT;
  END;
  IF error_state IS DISTINCT FROM '42501' OR error_message IS DISTINCT FROM 'CLIENT_ACCESS_DENIED' THEN
    RAISE EXCEPTION 'BF-245 active OWNER must lose access after membership deactivation';
  END IF;
  PERFORM set_config('role','none',true);
  RAISE NOTICE 'BF-245 behavior passed: % grouped assertions, role/tenant negatives, cross-barber aggregate, exact money, native types, no writes across19 tables, revocation',checks+2;
END;
$$;

-- A test-only failing view proves BARBER never executes the financial branch.
-- Rollback restores the actual table, FKs and policies. Nothing is committed.
DO $$
<<financial_branch>>
DECLARE
  user_id uuid := gen_random_uuid();
  business_id uuid := gen_random_uuid();
  client_id uuid := gen_random_uuid();
  actual record;
BEGIN
  INSERT INTO auth.users (id) VALUES (user_id);
  INSERT INTO public.businesses (id,name) VALUES (business_id,'BF245 no sales query');
  INSERT INTO public.business_members (business_id,user_id,role) VALUES (business_id,user_id,'OWNER');
  INSERT INTO public.clients (id,business_id,first_name) VALUES (client_id,business_id,'No finance');
  ALTER TABLE public.sales RENAME TO bf245_test_sales;
  CREATE VIEW public.sales AS SELECT 1/0 AS total, NULL::uuid AS business_id,
    NULL::uuid AS client_id, NULL::text AS status;
  PERFORM set_config('role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',user_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true);
  BEGIN
    PERFORM public.get_client_stats(business_id,client_id);
    RAISE EXCEPTION 'BF-245 financial trap must be reached for OWNER';
  EXCEPTION WHEN division_by_zero THEN NULL;
  END;
  PERFORM set_config('role','none',true);
  UPDATE public.business_members AS member SET role='BARBER'
    WHERE member.business_id=financial_branch.business_id AND member.user_id=financial_branch.user_id;
  PERFORM set_config('role','authenticated',true);
  SELECT * INTO STRICT actual FROM public.get_client_stats(business_id,client_id);
  IF actual.total_spent IS NOT NULL OR actual.total_appointments <> 0 THEN
    RAISE EXCEPTION 'BF-245 BARBER must bypass the financial query entirely';
  END IF;
  PERFORM set_config('role','none',true);
  DROP VIEW public.sales;
  ALTER TABLE public.bf245_test_sales RENAME TO sales;
  RAISE NOTICE 'BF-245 BARBER financial query non-execution passed';
END;
$$;

ROLLBACK;
