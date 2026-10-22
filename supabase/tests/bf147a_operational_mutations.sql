\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path='';
CREATE FUNCTION pg_temp.expect_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected SQLSTATE %',expected;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>expected THEN RAISE; END IF;
END;
$$;
DO $$
DECLARE fn record; name text; r text;
BEGIN
  FOREACH name IN ARRAY ARRAY['reschedule_appointment','update_appointment_notes','change_appointment_status'] LOOP
    SELECT p.* INTO STRICT fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=name;
    IF NOT fn.prosecdef OR fn.provolatile<>'v' OR fn.proretset OR fn.prorettype<>'jsonb'::regtype
      OR fn.proowner<>'postgres'::regrole OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION 'Unsafe operational RPC metadata';
    END IF;
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_function_privilege(r,fn.oid,'EXECUTE') IS DISTINCT FROM (r='authenticated') THEN
        RAISE EXCEPTION 'Unexpected operational execute grant';
      END IF;
    END LOOP;
  END LOOP;
  IF has_function_privilege('authenticated','private.lock_operational_appointment(uuid,uuid,uuid)','EXECUTE')
    OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('appointments','appointment_services') AND cmd<>'SELECT')
    OR has_any_column_privilege('authenticated','public.appointments','UPDATE') THEN
    RAISE EXCEPTION 'Internal helper or DML fence exposed';
  END IF;
END;
$$;
DO $$
DECLARE
  u uuid:=gen_random_uuid(); barber uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid();
  b uuid:=gen_random_uuid(); foreign_b uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); bm uuid:=gen_random_uuid(); fm uuid:=gen_random_uuid();
  c uuid:=gen_random_uuid(); a uuid; other_a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
  src text; dst text; allowed boolean; before_value jsonb; result jsonb; snapshots jsonb;
  count_cases integer:=0;
BEGIN
  INSERT INTO auth.users(id) VALUES(u),(barber),(other_user);
  INSERT INTO public.businesses(id,name,timezone) VALUES(b,'BF147A','UTC'),(foreign_b,'Foreign','UTC');
  INSERT INTO public.business_members(id,business_id,user_id,role) VALUES(m,b,u,'OWNER'),(bm,b,barber,'BARBER'),(fm,foreign_b,other_user,'OWNER');
  INSERT INTO public.clients(id,business_id,first_name) VALUES(c,b,'Historical');
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(s,b,'Old service',20,30);
  INSERT INTO public.business_settings(business_id,appointment_interval_minutes,default_service_buffer_minutes) VALUES(b,30,0);
  INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time) VALUES(b,3,'09:00','18:00');
  -- Exhaustive independently specified D01 matrix, including forbidden targets.
  FOREACH src IN ARRAY ARRAY['PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW'] LOOP
    FOREACH dst IN ARRAY ARRAY['PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW'] LOOP
      a:=gen_random_uuid();
      INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by,updated_at)
        VALUES(a,b,c,bm,'2026-10-14T09:00Z','2026-10-14T09:30Z',src,u,'2020-01-01Z');
      before_value:=(SELECT to_jsonb(t) FROM public.appointments t WHERE id=a);
      allowed:= dst IN ('CONFIRMED','IN_PROGRESS','CANCELLED','NO_SHOW') AND (
        src=dst OR src='PENDING' OR (src='CONFIRMED' AND dst IN ('IN_PROGRESS','CANCELLED','NO_SHOW'))
        OR (src='IN_PROGRESS' AND dst IN ('CANCELLED','NO_SHOW')));
      PERFORM set_config('request.jwt.claim.sub',u::text,true);
      SET LOCAL ROLE authenticated;
      IF allowed THEN
        result:=public.change_appointment_status(b,a,dst);
        IF result->>'status'<>dst OR (SELECT count(*) FROM jsonb_object_keys(result))<>11 THEN RAISE EXCEPTION 'Wrong transition/wire shape'; END IF;
        IF src=dst AND result IS DISTINCT FROM before_value THEN RAISE EXCEPTION 'Same-state wrote audit fields'; END IF;
      ELSE
        PERFORM pg_temp.expect_error(format('SELECT public.change_appointment_status(%L,%L,%L)',b,a,dst),
          CASE WHEN dst IN ('PENDING','COMPLETED') THEN 'PT422' ELSE 'PT409' END);
      END IF;
      RESET ROLE;
      IF NOT allowed AND (SELECT to_jsonb(t) FROM public.appointments t WHERE id=a) IS DISTINCT FROM before_value THEN
        RAISE EXCEPTION 'Denied transition mutated appointment';
      END IF;
      DELETE FROM public.appointments WHERE id=a;
      count_cases:=count_cases+1;
    END LOOP;
  END LOOP;
  a:=gen_random_uuid();
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
    VALUES(a,b,c,bm,'2026-10-14T09:00Z','2026-10-14T09:45Z','PENDING',u),
      (other_a,b,c,m,'2026-10-14T15:00Z','2026-10-14T15:30Z','PENDING',u);
  INSERT INTO public.appointment_services(appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,quantity,line_total)
    VALUES(a,s,'Old service',20,30,1,20);
  snapshots:=(SELECT jsonb_agg(to_jsonb(t)) FROM public.appointment_services t WHERE appointment_id=a);
  UPDATE public.services SET name='New name',price=99,duration_minutes=180,is_active=false WHERE id=s;
  PERFORM set_config('request.jwt.claim.sub',barber::text,true);
  SET LOCAL ROLE authenticated;
  result:=public.update_appointment_notes(b,a,'  original text  ');
  IF result->>'notes'<>'  original text  ' THEN RAISE EXCEPTION 'Notes rewritten'; END IF;
  result:=public.update_appointment_notes(b,a,'');
  IF result->>'notes'<>'' THEN RAISE EXCEPTION 'Empty notes lost'; END IF;
  result:=public.update_appointment_notes(b,a,NULL);
  IF result->'notes'<>'null'::jsonb THEN RAISE EXCEPTION 'Null notes lost'; END IF;
  result:=public.reschedule_appointment(b,a,bm,'2026-10-14T10:00Z');
  IF (result->>'end_at')::timestamptz<>'2026-10-14T10:45Z'::timestamptz THEN RAISE EXCEPTION 'Historical duration changed'; END IF;
  PERFORM pg_temp.expect_error(format('SELECT public.reschedule_appointment(%L,%L,%L,%L)',b,a,m,'2026-10-14T11:00Z'),'42501');
  PERFORM pg_temp.expect_error(format('SELECT public.reschedule_appointment(%L,%L,%L,%L,30)',b,a,bm,'2026-10-14T11:00Z'),'42501');
  PERFORM pg_temp.expect_error(format('SELECT public.update_appointment_notes(%L,%L,NULL)',b,other_a),'42501');
  PERFORM pg_temp.expect_error(format('SELECT public.change_appointment_status(%L,%L,%L)',b,other_a,'CONFIRMED'),'42501');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  SET LOCAL ROLE authenticated;
  result:=public.reschedule_appointment(b,a,m,'2026-10-14T11:00Z',60);
  IF result->>'barber_member_id'<>m::text OR (result->>'end_at')::timestamptz<>'2026-10-14T12:00Z'::timestamptz THEN RAISE EXCEPTION 'OWNER override failed'; END IF;
  PERFORM pg_temp.expect_error(format('SELECT public.reschedule_appointment(%L,%L,%L,%L)',b,a,m,'2026-10-14T15:00Z'),'PT409');
  PERFORM pg_temp.expect_error(format('SELECT public.reschedule_appointment(%L,%L,%L,%L)',b,a,m,'2026-10-14T11:01Z'),'PT422');
  PERFORM pg_temp.expect_error(format('SELECT public.reschedule_appointment(%L,%L,%L,%L,0)',b,a,m,'2026-10-14T12:00Z'),'PT422');
  PERFORM pg_temp.expect_error(format('SELECT public.reschedule_appointment(%L,%L,%L,%L)',b,a,fm,'2026-10-14T12:00Z'),'42501');
  PERFORM pg_temp.expect_error(format('SELECT public.update_appointment_notes(%L,%L,NULL)',foreign_b,a),'42501');
  PERFORM pg_temp.expect_error(format('SELECT public.update_appointment_notes(%L,%L,NULL)',b,gen_random_uuid()),'42501');
  RESET ROLE;
  UPDATE public.business_members SET is_active=false WHERE id=m;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.change_appointment_status(%L,%L,%L)',b,a,'CONFIRMED'),'42501');
  RESET ROLE;
  UPDATE public.business_members SET is_active=true WHERE id=m;
  PERFORM set_config('request.jwt.claim.sub','',true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.update_appointment_notes(%L,%L,NULL)',b,a),'42501');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  FOREACH src IN ARRAY ARRAY['COMPLETED','CANCELLED','NO_SHOW'] LOOP
    UPDATE public.appointments SET status=src WHERE id=a;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.expect_error(format('SELECT public.update_appointment_notes(%L,%L,%L)',b,a,'forbidden'),'PT409');
    PERFORM pg_temp.expect_error(format('SELECT public.reschedule_appointment(%L,%L,%L,%L)',b,a,m,'2026-10-14T12:00Z'),'PT409');
    RESET ROLE;
  END LOOP;
  UPDATE public.appointments SET status='PENDING' WHERE id=a;
  before_value:=(SELECT to_jsonb(t) FROM public.appointments t WHERE id=a);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.update_appointment_notes(b,a,'rolled back');
    RAISE EXCEPTION USING ERRCODE='ZT147';
  EXCEPTION WHEN SQLSTATE 'ZT147' THEN NULL;
  END;
  RESET ROLE;
  IF (SELECT to_jsonb(t) FROM public.appointments t WHERE id=a) IS DISTINCT FROM before_value
    OR (SELECT jsonb_agg(to_jsonb(t)) FROM public.appointment_services t WHERE appointment_id=a) IS DISTINCT FROM snapshots
    OR EXISTS(SELECT 1 FROM public.sales WHERE business_id=b)
    OR EXISTS(SELECT 1 FROM public.stock_movements WHERE business_id=b) THEN
    RAISE EXCEPTION 'Rollback/history/no-commerce boundary broken';
  END IF;
  RAISE NOTICE 'BF147A: % exhaustive D01 pairs; roles/tenant/notes/reschedule/snapshots/rollback PASS',count_cases;
END;
$$;
ROLLBACK;
