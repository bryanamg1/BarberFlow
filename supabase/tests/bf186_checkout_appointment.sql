\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.expect_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected SQLSTATE %',expected;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>expected THEN RAISE; END IF;
END;
$$;
DO $$
DECLARE
  u uuid:=gen_random_uuid(); barber uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
  b uuid:=gen_random_uuid(); fb uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); fc uuid:=gen_random_uuid();
  a uuid; op uuid; original jsonb; history jsonb; outcome public.appointments%ROWTYPE;
  sale public.sales%ROWTYPE; src text; fn record; r text; actor uuid;
BEGIN
  SELECT * INTO STRICT fn FROM pg_proc WHERE oid='private.complete_checkout_appointment(uuid,uuid)'::regprocedure;
  IF fn.prosecdef OR fn.provolatile<>'v' OR fn.proretset OR fn.prorettype<>'public.appointments'::regtype
    OR fn.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id']::text[]
    OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR fn.proowner<>'postgres'::regrole THEN
    RAISE EXCEPTION 'Unsafe internal completion metadata';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(r,fn.oid,'EXECUTE') THEN RAISE EXCEPTION 'Internal completion exposed'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE proname='complete_checkout') THEN RAISE EXCEPTION 'BF188 exposed prematurely'; END IF;
  INSERT INTO auth.users(id) VALUES(u),(barber),(stranger);
  INSERT INTO public.businesses(id,name) VALUES(b,'BF186'),(fb,'Foreign');
  INSERT INTO public.business_members(id,business_id,user_id,role) VALUES(m,b,u,'OWNER'),(gen_random_uuid(),b,barber,'BARBER');
  INSERT INTO public.clients(id,business_id,first_name) VALUES(c,b,'Client'),(fc,fb,'Foreign');
  FOREACH src IN ARRAY ARRAY['PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW'] LOOP
    a:=gen_random_uuid();op:=gen_random_uuid();
    INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
      VALUES(a,b,c,m,'2026-10-14T09:00Z','2026-10-14T09:30Z',src,u);
    INSERT INTO public.appointment_services(appointment_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,quantity,line_total)
      VALUES(a,'Historical snapshot',10,30,1,10);
    history:=(SELECT jsonb_agg(to_jsonb(t)) FROM public.appointment_services t WHERE appointment_id=a);
    PERFORM set_config('request.jwt.claim.sub',u::text,true);
    IF src IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN
      sale:=private.persist_checkout_sale(b,op,a,NULL,0,0,0);
      outcome:=private.complete_checkout_appointment(b,op);
      IF outcome.status<>'COMPLETED' OR outcome.client_id<>c THEN RAISE EXCEPTION 'Missing completion'; END IF;
      original:=to_jsonb(outcome);
      outcome:=private.complete_checkout_appointment(b,op);
      IF to_jsonb(outcome) IS DISTINCT FROM original THEN RAISE EXCEPTION 'Replay wrote appointment'; END IF;
      PERFORM pg_temp.expect_error(format('SELECT private.persist_checkout_sale(%L,%L,%L,NULL,0,0,0)',b,gen_random_uuid(),a),'PT409');
      IF (SELECT count(*) FROM public.sales WHERE appointment_id=a)<>1 THEN RAISE EXCEPTION 'Duplicate sale'; END IF;
      FOREACH actor IN ARRAY ARRAY[barber,stranger] LOOP
        PERFORM set_config('request.jwt.claim.sub',actor::text,true);
        PERFORM pg_temp.expect_error(format('SELECT private.complete_checkout_appointment(%L,%L)',b,op),'42501');
      END LOOP;
      PERFORM set_config('request.jwt.claim.sub','',true);
      PERFORM pg_temp.expect_error(format('SELECT private.complete_checkout_appointment(%L,%L)',b,op),'42501');
      PERFORM set_config('request.jwt.claim.sub',u::text,true);
      UPDATE public.business_members SET is_active=false WHERE id=m;
      PERFORM pg_temp.expect_error(format('SELECT private.complete_checkout_appointment(%L,%L)',b,op),'42501');
      UPDATE public.business_members SET is_active=true WHERE id=m;
    ELSE
      PERFORM pg_temp.expect_error(format('SELECT private.persist_checkout_sale(%L,%L,%L,NULL,0,0,0)',b,op,a),'PT409');
      -- Defensive stage test against a preexisting legacy linked header.
      INSERT INTO public.sales(business_id,operation_id,appointment_id,client_id,status,subtotal,discount,total,created_by)
        VALUES(b,op,a,c,'COMPLETED',0,0,0,u);
      IF src<>'COMPLETED' THEN
        PERFORM pg_temp.expect_error(format('SELECT private.complete_checkout_appointment(%L,%L)',b,op),'PT409');
      END IF;
    END IF;
    IF (SELECT jsonb_agg(to_jsonb(t)) FROM public.appointment_services t WHERE appointment_id=a) IS DISTINCT FROM history THEN
      RAISE EXCEPTION 'Appointment snapshots changed';
    END IF;
  END LOOP;
  PERFORM pg_temp.expect_error(format('SELECT private.complete_checkout_appointment(%L,%L)',b,gen_random_uuid()),'22023');
  PERFORM pg_temp.expect_error(format('SELECT private.complete_checkout_appointment(%L,NULL)',b),'22023');
  PERFORM pg_temp.expect_error(format('SELECT private.complete_checkout_appointment(%L,%L)',fb,op),'42501');
  op:=gen_random_uuid();
  sale:=private.persist_checkout_sale(b,op,NULL,NULL,0,0,0);
  outcome:=private.complete_checkout_appointment(b,op);
  IF outcome.id IS NOT NULL THEN RAISE EXCEPTION 'Direct sale should skip appointment'; END IF;

  a:=gen_random_uuid();op:=gen_random_uuid();
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
    VALUES(a,b,c,m,'2026-10-14T09:00Z','2026-10-14T09:30Z','PENDING',u);
  original:=(SELECT to_jsonb(t) FROM public.appointments t WHERE id=a);
  BEGIN
    sale:=private.persist_checkout_sale(b,op,a,NULL,0,0,0);
    PERFORM private.complete_checkout_appointment(b,op);
    RAISE EXCEPTION USING ERRCODE='ZT186';
  EXCEPTION WHEN SQLSTATE 'ZT186' THEN NULL;
  END;
  IF (SELECT to_jsonb(t) FROM public.appointments t WHERE id=a) IS DISTINCT FROM original
    OR EXISTS(SELECT 1 FROM public.sales WHERE business_id=b AND operation_id=op) THEN
    RAISE EXCEPTION 'Completion did not roll back with sale';
  END IF;
  -- Cross-business FK alone does not imply tenant consistency.
  INSERT INTO public.sales(business_id,operation_id,appointment_id,client_id,status,subtotal,discount,total,created_by)
    VALUES(fb,op,a,c,'COMPLETED',0,0,0,u);
  INSERT INTO public.business_members(business_id,user_id,role) VALUES(fb,u,'OWNER');
  PERFORM pg_temp.expect_error(format('SELECT private.complete_checkout_appointment(%L,%L)',fb,op),'42501');
  IF EXISTS(SELECT 1 FROM public.payments WHERE business_id IN (b,fb))
    OR EXISTS(SELECT 1 FROM public.stock_movements WHERE business_id IN (b,fb))
    OR EXISTS(SELECT 1 FROM public.sale_items WHERE sale_id IN (SELECT id FROM public.sales WHERE business_id IN (b,fb))) THEN
    RAISE EXCEPTION 'Completion duplicated another stage';
  END IF;
  RAISE NOTICE 'BF186 eligibility/roles/tenant/replay/snapshots/rollback/private surface PASS';
END;
$$;
ROLLBACK;
