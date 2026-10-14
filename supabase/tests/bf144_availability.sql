\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path='';
DO $$
DECLARE fn record; helper record; role_name text;
BEGIN
  SELECT * INTO STRICT fn FROM pg_proc WHERE oid='public.get_availability(uuid,uuid,date,integer,uuid)'::regprocedure;
  IF fn.prosecdef OR fn.provolatile<>'s' OR fn.pronargs<>5 OR fn.pronargdefaults<>1
     OR NOT fn.proretset OR fn.prorettype<>'record'::regtype OR fn.proowner<>'postgres'::regrole
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR fn.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_barber_member_id','p_date','p_duration_minutes','p_exclude_appointment_id','start_at','end_at','available']::text[] THEN
    RAISE EXCEPTION 'Availability wire/security metadata differs';
  END IF;
  SELECT * INTO STRICT helper FROM pg_proc WHERE oid='private.appointment_slot_candidates(date,text,time,time,integer,integer,integer)'::regprocedure;
  IF helper.prosecdef OR helper.provolatile<>'s' OR helper.proowner<>'postgres'::regrole
     OR helper.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION 'Pure candidate helper must remain a hardened stable invoker';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,fn.oid,'EXECUTE') IS DISTINCT FROM (role_name='authenticated')
      OR has_function_privilege(role_name,'private.appointment_slot_candidates(date,text,time,time,integer,integer,integer)','EXECUTE') IS DISTINCT FROM (role_name='authenticated') THEN
      RAISE EXCEPTION 'Unexpected availability/helper EXECUTE for %',role_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public')<>41
    OR (SELECT count(*) FROM pg_tables WHERE schemaname='public')<>19
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Availability must preserve existing tables/RLS/policies';
  END IF;
END;
$$;
DO $$
DECLARE
  test_owner uuid:=gen_random_uuid(); test_barber uuid:=gen_random_uuid(); other_barber uuid:=gen_random_uuid();
  foreign_user uuid:=gen_random_uuid(); inactive_user uuid:=gen_random_uuid();
  own_business uuid:=gen_random_uuid(); foreign_business uuid:=gen_random_uuid(); unowned_business uuid:=gen_random_uuid();
  owner_member uuid:=gen_random_uuid(); own_member uuid:=gen_random_uuid(); other_member uuid:=gen_random_uuid(); foreign_member uuid:=gen_random_uuid(); inactive_member uuid:=gen_random_uuid();
  own_client uuid:=gen_random_uuid(); foreign_client uuid:=gen_random_uuid();
  test_appointment uuid:=gen_random_uuid(); foreign_appointment uuid:=gen_random_uuid(); hidden_appointment uuid:=gen_random_uuid();
  expected_starts timestamptz[]:=ARRAY['2026-10-14T12:10:00Z','2026-10-14T12:30:00Z','2026-10-14T12:50:00Z','2026-10-14T13:10:00Z','2026-10-14T13:30:00Z']::timestamptz[];
  starts timestamptz[]; flags boolean[]; n integer; state text; bad_duration integer; bad_date date; bad_id uuid;
  before_history jsonb; after_history jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES(test_owner),(test_barber),(other_barber),(foreign_user),(inactive_user);
  INSERT INTO public.businesses(id,name,currency_code,timezone) VALUES
    (own_business,'Availability test','ARS','America/Argentina/Buenos_Aires'),
    (foreign_business,'Foreign availability','ARS','UTC'),(unowned_business,'Unowned','ARS','UTC');
  INSERT INTO public.business_members(id,business_id,user_id,role,is_active) VALUES
    (owner_member,own_business,test_owner,'OWNER',true),(own_member,own_business,test_barber,'BARBER',true),
    (other_member,own_business,other_barber,'BARBER',true),(foreign_member,foreign_business,foreign_user,'OWNER',true),
    (inactive_member,own_business,inactive_user,'BARBER',false);
  INSERT INTO public.clients(id,business_id,first_name) VALUES(own_client,own_business,'Test'),(foreign_client,foreign_business,'Other');
  INSERT INTO public.business_settings(business_id,appointment_interval_minutes,default_service_buffer_minutes)
    VALUES(own_business,20,10);
  INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time) VALUES(own_business,3,'09:10','11:10');
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES
    (foreign_appointment,foreign_business,foreign_client,foreign_member,'2026-10-14T12:50Z','2026-10-14T13:20Z',foreign_user);
  PERFORM set_config('request.jwt.claim.sub',test_owner::text,true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(s.start_at ORDER BY s.start_at),array_agg(s.available ORDER BY s.start_at) INTO starts,flags
    FROM public.get_availability(own_business,own_member,'2026-10-14',30) AS s;
  IF starts IS DISTINCT FROM expected_starts OR flags IS DISTINCT FROM ARRAY[true,true,true,true,true] THEN
    RAISE EXCEPTION 'Opening-anchored interval/closing-buffer/no-appointments grid differs';
  END IF;
  IF (SELECT max(s.end_at) FROM public.get_availability(own_business,own_member,'2026-10-14',30,NULL) s)<>'2026-10-14T14:00Z'::timestamptz THEN
    RAISE EXCEPTION 'end_at must exclude posterior buffer';
  END IF;
  SELECT count(*) INTO n FROM public.get_availability(own_business,owner_member,'2026-10-14',30);
  IF n<>5 THEN RAISE EXCEPTION 'Active OWNER is also a valid working member'; END IF;
  FOR bad_duration IN SELECT value FROM unnest(ARRAY[NULL,0,-1]::integer[]) AS bad(value) LOOP
    BEGIN PERFORM public.get_availability(own_business,own_member,'2026-10-14',bad_duration);
      RAISE EXCEPTION 'Invalid duration accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  FOR bad_date IN SELECT value FROM unnest(ARRAY[NULL,'infinity','-infinity','0001-01-01 BC']::date[]) AS bad(value) LOOP
    BEGIN PERFORM public.get_availability(own_business,own_member,bad_date,30);
      RAISE EXCEPTION 'Invalid date accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  SELECT count(*) INTO n FROM public.get_availability(own_business,own_member,'2026-10-14',2147483647);
  IF n<>0 THEN RAISE EXCEPTION 'Oversized positive duration should have no fitting slots, without overflow'; END IF;
  FOREACH bad_id IN ARRAY ARRAY[foreign_member,inactive_member,gen_random_uuid()] LOOP
    BEGIN PERFORM public.get_availability(own_business,bad_id,'2026-10-14',30);
      RAISE EXCEPTION 'Inactive/foreign/missing target accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN PERFORM public.get_availability(unowned_business,own_member,'2026-10-14',30);
    RAISE EXCEPTION 'Nonmember business accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  FOREACH bad_id IN ARRAY ARRAY[foreign_appointment,gen_random_uuid()] LOOP
    BEGIN PERFORM public.get_availability(own_business,own_member,'2026-10-14',30,bad_id);
      RAISE EXCEPTION 'Foreign/missing exclusion accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  RESET ROLE;
  INSERT INTO public.business_members(business_id,user_id,role) VALUES(foreign_business,test_owner,'OWNER');
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.get_availability(own_business,own_member,'2026-10-14',30,foreign_appointment);
    RAISE EXCEPTION 'Even dual OWNER may not exclude foreign tenant'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES
    (test_appointment,own_business,own_client,own_member,'2026-10-14T12:50Z','2026-10-14T13:20Z',test_owner);
  FOR state IN SELECT unnest(ARRAY['PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW']) LOOP
    UPDATE public.appointments SET status=state WHERE id=test_appointment;
    SET LOCAL ROLE authenticated;
    SELECT array_agg(s.available ORDER BY s.start_at) INTO flags FROM public.get_availability(own_business,own_member,'2026-10-14',30) s;
    IF flags IS DISTINCT FROM (CASE WHEN state IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN ARRAY[true,false,false,false,true] ELSE ARRAY[true,true,true,true,true] END) THEN
      RAISE EXCEPTION 'Blocking/adjacent/buffer behavior incorrect for %',state;
    END IF;
    IF NOT (SELECT bool_and(s.available) FROM public.get_availability(own_business,own_member,'2026-10-14',30,test_appointment) s) THEN
      RAISE EXCEPTION 'Exclusion must remove the target conflict for every status';
    END IF;
    RESET ROLE;
  END LOOP;
  UPDATE public.appointments SET status='PENDING' WHERE id=test_appointment;
  PERFORM set_config('request.jwt.claim.sub',test_barber::text,true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(s.available ORDER BY s.start_at) INTO flags FROM public.get_availability(own_business,own_member,'2026-10-14',30) s;
  IF flags IS DISTINCT FROM ARRAY[true,false,false,false,true] THEN RAISE EXCEPTION 'BARBER must see own conflict created by OWNER'; END IF;
  IF NOT (SELECT bool_and(s.available) FROM public.get_availability(own_business,own_member,'2026-10-14',30,test_appointment) s) THEN RAISE EXCEPTION 'Self exclusion failed'; END IF;
  BEGIN PERFORM public.get_availability(own_business,other_member,'2026-10-14',30);
    RAISE EXCEPTION 'BARBER probed another calendar'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,created_by)
    VALUES(hidden_appointment,own_business,own_client,other_member,'2026-10-14T12:10Z','2026-10-14T14:10Z',test_owner);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.get_availability(own_business,own_member,'2026-10-14',30,hidden_appointment);
    RAISE EXCEPTION 'Hidden same-business exclusion accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  UPDATE public.business_settings SET allow_overlapping_appointments=true WHERE business_id=own_business;
  PERFORM set_config('request.jwt.claim.sub',test_owner::text,true);
  SET LOCAL ROLE authenticated;
  IF NOT (SELECT bool_and(s.available) FROM public.get_availability(own_business,own_member,'2026-10-14',30) s) THEN RAISE EXCEPTION 'Overlap flag not honored'; END IF;
  RESET ROLE;
  UPDATE public.business_settings SET allow_overlapping_appointments=false,default_service_buffer_minutes=0,appointment_interval_minutes=30 WHERE business_id=own_business;
  UPDATE public.business_hours SET open_time='09:20',close_time='11:20' WHERE business_id=own_business;
  SET LOCAL ROLE authenticated;
  SELECT array_agg(s.available ORDER BY s.start_at) INTO flags FROM public.get_availability(own_business,own_member,'2026-10-14',30) s;
  IF flags IS DISTINCT FROM ARRAY[true,false,true,true] THEN RAISE EXCEPTION 'Zero buffer adjacent endpoints/other barber filter incorrect'; END IF;
  RESET ROLE;
  UPDATE public.business_hours SET is_closed=true WHERE business_id=own_business;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.get_availability(own_business,own_member,'2026-10-14',30);
  IF n<>0 THEN RAISE EXCEPTION 'Closed day generated slots'; END IF;
  RESET ROLE;
  DELETE FROM public.business_hours WHERE business_id=own_business;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.get_availability(own_business,own_member,'2026-10-14',30);
  IF n<>0 THEN RAISE EXCEPTION 'Missing hours invented defaults'; END IF;
  RESET ROLE;
  INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time) VALUES(own_business,3,'00:10','01:10');
  DELETE FROM public.business_settings WHERE business_id=own_business;
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.get_availability(own_business,own_member,'2026-10-14',30);
    RAISE EXCEPTION 'Missing settings invented defaults'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  INSERT INTO public.business_settings(business_id) VALUES(own_business);
  UPDATE public.businesses SET timezone='Pacific/Kiritimati' WHERE id=own_business;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) INTO before_history FROM public.appointments a;
  SET LOCAL ROLE authenticated;
  SELECT array_agg(s.start_at ORDER BY s.start_at) INTO starts FROM public.get_availability(own_business,own_member,'2026-10-14',30) s;
  IF starts IS DISTINCT FROM ARRAY['2026-10-13T10:10Z','2026-10-13T10:40Z']::timestamptz[] THEN RAISE EXCEPTION 'Business civil date crossed UTC boundary incorrectly'; END IF;
  IF EXISTS (SELECT 1 FROM public.get_availability(own_business,own_member,'2026-10-14',30) s
    WHERE (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(to_jsonb(s)) AS key) IS DISTINCT FROM ARRAY['available','end_at','start_at']::text[]) THEN
    RAISE EXCEPTION 'Availability leaks fields outside three slot properties';
  END IF;
  RESET ROLE;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) INTO after_history FROM public.appointments a;
  IF before_history IS DISTINCT FROM after_history THEN RAISE EXCEPTION 'Availability modified history'; END IF;
  UPDATE public.businesses SET timezone='Invalid/Zone' WHERE id=own_business;
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.get_availability(own_business,own_member,'2026-10-14',30);
    RAISE EXCEPTION 'Invalid persisted timezone accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  UPDATE public.businesses SET timezone='UTC' WHERE id=own_business;
  UPDATE public.business_members SET is_active=false WHERE id=own_member;
  PERFORM set_config('request.jwt.claim.sub',test_barber::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.get_availability(own_business,own_member,'2026-10-14',30);
    RAISE EXCEPTION 'Inactive caller accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN PERFORM public.get_availability(own_business,own_member,'2026-10-14',30);
    RAISE EXCEPTION 'Missing identity accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.get_availability(own_business,own_member,'2026-10-14',30);
    RAISE EXCEPTION 'Anonymous execution accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE NOTICE 'BF144 authorization/grid/status/buffer/exclusion/privacy/readonly checks PASS';
END;
$$;
DO $$
DECLARE starts timestamptz[]; n integer;
BEGIN
  SELECT count(*) INTO n FROM private.appointment_slot_candidates('2026-03-08','America/New_York','00:00','04:00',30,30,0);
  IF n<>6 THEN RAISE EXCEPTION 'Spring gap must omit nonexistent civil slots'; END IF;
  SELECT count(*) INTO n FROM private.appointment_slot_candidates('2026-11-01','America/New_York','00:00','04:00',30,30,0);
  IF n<>10 THEN RAISE EXCEPTION 'Autumn fold must offer both UTC occurrences'; END IF;
  SELECT array_agg(s.start_at ORDER BY s.start_at) INTO starts FROM private.appointment_slot_candidates('2026-11-01','America/New_York','01:30','01:45',5,5,0) s;
  IF starts IS DISTINCT FROM ARRAY['2026-11-01T05:30Z','2026-11-01T05:35Z','2026-11-01T05:40Z','2026-11-01T06:30Z','2026-11-01T06:35Z','2026-11-01T06:40Z']::timestamptz[] THEN RAISE EXCEPTION 'Fold civil closing holes lost'; END IF;
  SELECT count(*) INTO n FROM private.appointment_slot_candidates('2026-03-08','America/New_York','02:30','04:00',30,30,0);
  IF n<>2 THEN RAISE EXCEPTION 'Nonexistent opening should retain later fitting civil candidates'; END IF;
  SELECT count(*) INTO n FROM private.appointment_slot_candidates('2011-12-30','Pacific/Apia','00:00','24:00',30,30,0);
  IF n<>0 THEN RAISE EXCEPTION 'Skipped civil date generated slots'; END IF;
  SELECT count(*) INTO n FROM private.appointment_slot_candidates('2026-04-05','Australia/Lord_Howe','00:00','04:00',30,30,0);
  IF n<>9 THEN RAISE EXCEPTION 'Half-hour DST fold incorrect'; END IF;
  SELECT count(*) INTO n FROM private.appointment_slot_candidates('1900-01-01','Europe/Paris','09:00:00.123456','10:00:00.123456',30,30,0);
  IF n<>2 THEN RAISE EXCEPTION 'Historical second offset/microseconds lost'; END IF;
  SELECT array_agg(s.start_at ORDER BY s.start_at) INTO starts FROM private.appointment_slot_candidates('2026-11-01','America/New_York','00:00','04:00',7,10,0) s;
  IF EXISTS(SELECT 1 FROM unnest(starts) AS t WHERE mod(extract(epoch FROM ((t AT TIME ZONE 'America/New_York')-'2026-11-01T00:00'::timestamp))::bigint,420)<>0) THEN RAISE EXCEPTION 'DST shifted a non-divisor civil grid'; END IF;
  RAISE NOTICE 'BF144 DST gaps/folds/civil holes/half-hour/skipped-date/historical second offsets/microseconds PASS';
END;
$$;
ROLLBACK;
