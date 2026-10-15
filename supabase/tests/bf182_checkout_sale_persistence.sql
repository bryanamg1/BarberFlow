\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  b uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  u uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,6));
  c uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  m uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  a uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,8));
  states text[] := ARRAY['PENDING','CONFIRMED','IN_PROGRESS','CANCELLED','NO_SHOW','COMPLETED'];
  op uuid := gen_random_uuid();
  draft_op uuid := gen_random_uuid();
  void_op uuid := gen_random_uuid();
  legacy_op uuid := gen_random_uuid();
  extra_app uuid := gen_random_uuid();
  rpc record;
  row public.sales%ROWTYPE;
  replay public.sales%ROWTYPE;
  before_apps jsonb;
  before_snapshots jsonb;
  before_sales bigint;
  bad numeric;
  sub numeric;
  disc numeric;
  total numeric;
  i integer;
  field integer;
  role_name text;
  code text;
  detail text;
  checks integer := 0;
BEGIN
  SELECT * INTO STRICT rpc FROM pg_proc
  WHERE oid='private.persist_checkout_sale(uuid,uuid,uuid,uuid,numeric,numeric,numeric)'::regprocedure;
  IF rpc.prosecdef OR rpc.provolatile<>'v' OR rpc.proretset OR rpc.pronargs<>7
     OR rpc.pronargdefaults<>0 OR rpc.prorettype<>'public.sales'::regtype
     OR rpc.proowner<>'postgres'::regrole OR rpc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR rpc.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_appointment_id','p_client_id','p_subtotal','p_discount','p_total']::text[]
     OR EXISTS(SELECT 1 FROM aclexplode(rpc.proacl) acl WHERE acl.grantee<>rpc.proowner OR acl.is_grantable) THEN
    RAISE EXCEPTION 'BF182 unsafe internal signature/ownership/ACL';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,rpc.oid,'EXECUTE') THEN RAISE EXCEPTION 'BF182 exposed to %',role_name; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE proname='complete_checkout')
     OR (SELECT count(*) FROM pg_policies WHERE schemaname='public')<>41 THEN
    RAISE EXCEPTION 'BF182 changed public checkout/policies';
  END IF;
  checks:=checks+5;

  INSERT INTO auth.users(id) SELECT unnest(u);
  INSERT INTO public.businesses(id,name) VALUES(b[1],'BF182 A'),(b[2],'BF182 B');
  INSERT INTO public.business_members(id,business_id,user_id,role,is_active) VALUES
    (m[1],b[1],u[1],'OWNER',true),(m[2],b[2],u[3],'OWNER',true);
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (b[1],u[2],'BARBER',true),(b[1],u[4],'OWNER',false),(b[1],u[6],'OWNER',true);
  INSERT INTO public.clients(id,business_id,first_name,is_active) VALUES
    (c[1],b[1],'BF182 A',true),(c[2],b[2],'BF182 B',true),(c[3],b[1],'BF182 archived',false);
  FOR i IN 1..8 LOOP
    INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
    VALUES(a[i],b[CASE WHEN i=7 THEN 2 ELSE 1 END],c[CASE WHEN i IN(7,8) THEN 2 ELSE 1 END],
           m[CASE WHEN i=7 THEN 2 ELSE 1 END],'2026-01-01T10:00:00Z','2026-01-01T10:30:00Z',
           CASE WHEN i<=6 THEN states[i] ELSE 'PENDING' END,u[1]);
  END LOOP;
  INSERT INTO public.appointment_services(appointment_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,line_total)
  VALUES(a[1],'Historical appointment service',7,30,7);
  INSERT INTO public.sales(business_id,operation_id,status,subtotal,total,created_by,sold_at) VALUES
    (b[1],draft_op,'DRAFT',7,7,u[1],NULL),(b[1],void_op,'VOIDED',7,7,u[1],now());
  INSERT INTO public.sales(business_id,operation_id,appointment_id,client_id,status,subtotal,total,created_by,sold_at)
  VALUES(b[1],legacy_op,a[6],c[1],'COMPLETED',7,7,u[1],now());
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO before_apps FROM public.appointments t;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO before_snapshots FROM public.appointment_services t;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);

  row:=private.persist_checkout_sale(b[1],op,NULL,NULL,10.29,1.01,9.28);
  IF row.status<>'COMPLETED' OR row.operation_id<>op OR row.business_id<>b[1]
     OR row.client_id IS NOT NULL OR row.appointment_id IS NOT NULL
     OR row.subtotal<>10.29 OR row.discount<>1.01 OR row.total<>9.28
     OR row.created_by<>u[1] OR row.sold_at IS NULL OR row.created_at IS NULL OR row.updated_at IS NULL
     OR (SELECT count(*) FROM jsonb_object_keys(to_jsonb(row)))<>13 THEN
    RAISE EXCEPTION 'BF182 direct sale identity/totals/exact row mismatch';
  END IF;
  replay:=private.persist_checkout_sale(b[1],op,a[7],c[2],NULL,-1,'NaN');
  IF to_jsonb(replay) IS DISTINCT FROM to_jsonb(row) THEN RAISE EXCEPTION 'BF182 replay re-executed input'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[6],'role','authenticated')::text,true);
  replay:=private.persist_checkout_sale(b[1],op,NULL,NULL,0,0,0);
  IF to_jsonb(replay) IS DISTINCT FROM to_jsonb(row) THEN RAISE EXCEPTION 'BF182 replay changed original actor'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  replay:=private.persist_checkout_sale(b[1],void_op,NULL,NULL,0,0,0);
  IF replay.status<>'VOIDED' OR replay.total<>7 THEN RAISE EXCEPTION 'BF182 recompleted VOIDED sale'; END IF;
  replay:=private.persist_checkout_sale(b[1],legacy_op,a[6],c[1],0,0,0);
  IF replay.status<>'COMPLETED' OR replay.total<>7 THEN RAISE EXCEPTION 'BF182 replay revalidated terminal parent'; END IF;
  checks:=checks+5;

  FOR i IN 1..3 LOOP
    replay:=private.persist_checkout_sale(b[1],gen_random_uuid(),a[i],CASE WHEN i=2 THEN c[1] ELSE NULL END,1,0,1);
    IF replay.client_id<>c[1] OR replay.appointment_id<>a[i] THEN RAISE EXCEPTION 'BF182 client derivation/matching'; END IF;
    checks:=checks+1;
  END LOOP;
  replay:=private.persist_checkout_sale(b[1],gen_random_uuid(),NULL,c[3],0,0,0);
  IF replay.client_id<>c[3] OR replay.total<>0 THEN RAISE EXCEPTION 'BF182 invented active-client/positive-total rule'; END IF;
  replay:=private.persist_checkout_sale(b[1],gen_random_uuid(),NULL,NULL,9999999999.99,9999999999.99,0);
  IF replay.total<>0 THEN RAISE EXCEPTION 'BF182 full-discount/max handling'; END IF;
  checks:=checks+2;
  SELECT count(*) INTO before_sales FROM public.sales;

  FOR i IN 1..10 LOOP
    BEGIN
      CASE i
        WHEN 1 THEN PERFORM private.persist_checkout_sale(b[1],draft_op,NULL,NULL,7,0,7);
        WHEN 2 THEN PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),a[1],NULL,1,0,1);
        WHEN 3 THEN PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),a[4],NULL,1,0,1);
        WHEN 4 THEN PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),a[5],NULL,1,0,1);
        WHEN 5 THEN PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),a[6],NULL,1,0,1);
        WHEN 6 THEN PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),a[7],NULL,1,0,1);
        WHEN 7 THEN PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),a[8],NULL,1,0,1);
        WHEN 8 THEN PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),NULL,c[2],1,0,1);
        WHEN 9 THEN PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),gen_random_uuid(),NULL,1,0,1);
        WHEN 10 THEN PERFORM private.persist_checkout_sale(b[1],NULL,NULL,NULL,1,0,1);
      END CASE;
      RAISE EXCEPTION 'BF182 invalid request accepted';
    EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'PT409' THEN
      GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,detail=PG_EXCEPTION_DETAIL;
      IF code<>(CASE WHEN i BETWEEN 2 AND 5 THEN 'PT409' ELSE '22023' END)
         OR detail IS DISTINCT FROM (CASE WHEN i BETWEEN 2 AND 5 THEN 'INVALID_APPOINTMENT_STATUS' ELSE 'INVALID_CHECKOUT' END) THEN
        RAISE EXCEPTION 'BF182 unsafe error';
      END IF;
      checks:=checks+1;
    END;
  END LOOP;
  -- A same-business mismatching client must be rejected, not replaced silently.
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,created_by)
  VALUES(extra_app,b[1],c[1],m[1],'2026-01-02T10:00:00Z','2026-01-02T10:30:00Z',u[1]);
  BEGIN
    PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),extra_app,c[3],1,0,1);
    RAISE EXCEPTION 'BF182 mismatching explicit client accepted';
  EXCEPTION WHEN invalid_parameter_value THEN checks:=checks+1; END;
  -- Restore the manual fixture addition in the no-mutation snapshot baseline.
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO before_apps FROM public.appointments t;
  FOR field IN 1..3 LOOP
    FOREACH bad IN ARRAY ARRAY[-1::numeric,1.234::numeric,10000000000::numeric,'NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric,NULL::numeric] LOOP
      sub:=10;disc:=1;total:=9;
      IF field=1 THEN sub:=bad;ELSIF field=2 THEN disc:=bad;ELSE total:=bad;END IF;
      BEGIN
        PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),NULL,NULL,sub,disc,total);
        RAISE EXCEPTION 'BF182 invalid money accepted';
      EXCEPTION WHEN invalid_parameter_value THEN checks:=checks+1; END;
    END LOOP;
  END LOOP;
  BEGIN
    PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),NULL,NULL,10,11,0);
    RAISE EXCEPTION 'BF182 discount exceeded subtotal';
  EXCEPTION WHEN invalid_parameter_value THEN checks:=checks+1; END;
  BEGIN
    PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),NULL,NULL,10,1,10);
    RAISE EXCEPTION 'BF182 inconsistent total';
  EXCEPTION WHEN invalid_parameter_value THEN checks:=checks+1; END;
  IF (SELECT count(*) FROM public.sales)<>before_sales THEN RAISE EXCEPTION 'BF182 invalid requests wrote sales'; END IF;
  FOR i IN 2..5 LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[i],'role','authenticated')::text,true);
    BEGIN
      PERFORM private.persist_checkout_sale(b[1],op,NULL,NULL,0,0,0);
      RAISE EXCEPTION 'BF182 unauthorized replay';
    EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
  END LOOP;
  PERFORM set_config('request.jwt.claims','{}',true);
  BEGIN
    PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),NULL,NULL,0,0,0);
    RAISE EXCEPTION 'BF182 missing identity';
  EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM private.persist_checkout_sale(b[1],op,NULL,NULL,0,0,0);
    RAISE EXCEPTION 'BF182 direct OWNER client execution';
  EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
  RESET ROLE;

  -- Failure after a header insert rolls back that insert and its locks.
  BEGIN
    PERFORM private.persist_checkout_sale(b[1],gen_random_uuid(),NULL,NULL,1,0,1);
    RAISE EXCEPTION USING ERRCODE='P1820',MESSAGE='Synthetic subsequent-slice failure';
  EXCEPTION WHEN SQLSTATE 'P1820' THEN checks:=checks+1; END;
  IF (SELECT count(*) FROM public.sales)<>before_sales THEN RAISE EXCEPTION 'BF182 partial insert survived rollback'; END IF;
  IF before_apps IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.appointments t)
     OR before_snapshots IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.appointment_services t)
     OR EXISTS(SELECT 1 FROM public.sale_items) OR EXISTS(SELECT 1 FROM public.payments)
     OR EXISTS(SELECT 1 FROM public.stock_movements) THEN
    RAISE EXCEPTION 'BF182 wrote later checkout effects or mutated appointment history';
  END IF;
  RAISE NOTICE 'BF182 PASS: % assertion groups; sale headers only, no public checkout',checks+1;
END;
$$;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$ DECLARE b uuid; u uuid; BEGIN
  SELECT business_id,user_id INTO b,u FROM public.business_members WHERE role='OWNER' AND is_active LIMIT 1;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  BEGIN
    PERFORM private.persist_checkout_sale(b,gen_random_uuid(),NULL,NULL,0,0,0);
    RAISE EXCEPTION 'BF182 allowed stale snapshot isolation';
  EXCEPTION WHEN serialization_failure THEN NULL;END;
END;$$;
ROLLBACK;
