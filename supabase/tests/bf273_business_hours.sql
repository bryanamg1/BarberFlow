\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';
DO $$
DECLARE fn record;
BEGIN
  SELECT * INTO STRICT fn FROM pg_proc WHERE oid='public.save_business_hours(uuid,jsonb)'::regprocedure;
  IF fn.prosecdef OR fn.provolatile <> 'v' OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR fn.proowner <> 'postgres'::regrole
     OR fn.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_days','id','business_id','day_of_week','open_time','close_time','is_closed']::text[]
     OR NOT has_function_privilege('authenticated',fn.oid,'EXECUTE')
     OR has_function_privilege('anon',fn.oid,'EXECUTE')
     OR has_function_privilege('service_role',fn.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'Hours RPC must be an authenticated-only invoker with empty search_path';
  END IF;
  IF has_column_privilege('authenticated','public.business_hours','business_id','UPDATE')
     OR (SELECT count(*) FROM pg_policies WHERE schemaname='public') <> 46
     OR (SELECT count(*) FROM pg_tables WHERE schemaname='public') <> 19 THEN
    RAISE EXCEPTION 'Hours RPC must not relax existing RLS or immutable tenant grants';
  END IF;
END;
$$;
DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  barber_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  own_business uuid := gen_random_uuid();
  other_business uuid := gen_random_uuid();
  week jsonb;
  broken jsonb;
  before_hours jsonb;
  after_hours jsonb;
  before_appointments jsonb;
  after_appointments jsonb;
  ids_before uuid[];
  ids_after uuid[];
  historical_client uuid;
  historical_barber uuid;
  n integer;
BEGIN
  INSERT INTO auth.users(id) VALUES(owner_id),(barber_id),(outsider_id);
  INSERT INTO public.businesses(id,name,currency_code,timezone)
    VALUES(own_business,'BF273 own','ARS','America/Argentina/Buenos_Aires'),(other_business,'BF273 other','USD','UTC');
  INSERT INTO public.business_members(business_id,user_id,role)
    VALUES(own_business,owner_id,'OWNER'),(own_business,barber_id,'BARBER'),(other_business,outsider_id,'OWNER');
  SELECT id INTO historical_barber FROM public.business_members WHERE business_id=own_business AND user_id=barber_id;
  INSERT INTO public.clients(business_id,first_name) VALUES(own_business,'Historical fixture') RETURNING id INTO historical_client;
  INSERT INTO public.appointments(business_id,client_id,barber_member_id,start_at,end_at,created_by,created_at,updated_at)
    VALUES(own_business,historical_client,historical_barber,'2026-01-01T12:00:00Z','2026-01-01T12:30:00Z',owner_id,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
  SELECT jsonb_agg(jsonb_build_object('day_of_week',day,'open_time','09:00:00.123456','close_time','18:00:00.123456','is_closed',day=0) ORDER BY day)
    INTO week FROM generate_series(0,6) AS day;
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO before_appointments FROM public.appointments a;
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.save_business_hours(own_business,week);
  IF n <> 7 THEN RAISE EXCEPTION 'Owner must create exactly seven weekdays'; END IF;
  SELECT array_agg(id ORDER BY day_of_week) INTO ids_before FROM public.business_hours WHERE business_id=own_business;
  week := jsonb_set(week,'{1,close_time}','"24:00:00"');
  SELECT count(*) INTO n FROM public.save_business_hours(own_business,week);
  SELECT array_agg(id ORDER BY day_of_week) INTO ids_after FROM public.business_hours WHERE business_id=own_business;
  IF n <> 7 OR ids_before IS DISTINCT FROM ids_after THEN RAISE EXCEPTION 'Upsert must preserve existing identities'; END IF;
  IF (SELECT open_time FROM public.business_hours WHERE business_id=own_business AND day_of_week=0) <> '09:00:00.123456'::time
     OR (SELECT close_time FROM public.business_hours WHERE business_id=own_business AND day_of_week=1) <> '24:00'::time THEN
    RAISE EXCEPTION 'Closed precision or end-of-day boundary lost';
  END IF;
  SELECT jsonb_agg(to_jsonb(h) ORDER BY h.day_of_week) INTO before_hours FROM public.business_hours h WHERE h.business_id=own_business;
  FOR broken IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    '[]'::jsonb, '{}'::jsonb, 'null'::jsonb,
    jsonb_set(week,'{6,day_of_week}','0'), jsonb_set(week,'{6,day_of_week}','7'),
    jsonb_set(week,'{6,day_of_week}','1.5'), jsonb_set(week,'{6,day_of_week}','"6"'),
    jsonb_set(week,'{2,is_closed}','"false"'), jsonb_set(week,'{2,open_time}','null'),
    jsonb_set(week,'{2,open_time}','""'), jsonb_set(week,'{2,close_time}','"09:00"'),
    jsonb_set(week,'{2,close_time}','"08:00"'), jsonb_set(week,'{2,close_time}','"24:00:01"'),
    jsonb_set(week,'{2,open_time}','"09:00Z"'), jsonb_set(week,'{2,open_time}','"09:00:00.1234567"')
  )) LOOP
    BEGIN
      PERFORM public.save_business_hours(own_business,broken);
      RAISE EXCEPTION 'Invalid week was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  SELECT jsonb_agg(to_jsonb(h) ORDER BY h.day_of_week) INTO after_hours FROM public.business_hours h WHERE h.business_id=own_business;
  IF before_hours IS DISTINCT FROM after_hours THEN RAISE EXCEPTION 'Rejected week must not partially save'; END IF;
  BEGIN
    PERFORM public.save_business_hours(other_business,week);
    RAISE EXCEPTION 'Cross-business hours write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',barber_id::text,true);
  BEGIN
    PERFORM public.save_business_hours(own_business,week);
    RAISE EXCEPTION 'BARBER write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',outsider_id::text,true);
  BEGIN
    PERFORM public.save_business_hours(own_business,week);
    RAISE EXCEPTION 'Nonmember write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  UPDATE public.business_members SET is_active=false WHERE business_id=own_business AND user_id=owner_id;
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.save_business_hours(own_business,week);
    RAISE EXCEPTION 'Inactive OWNER write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.save_business_hours(own_business,week);
    RAISE EXCEPTION 'Missing identity accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.save_business_hours(own_business,week);
    RAISE EXCEPTION 'Anonymous RPC execution accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO after_appointments FROM public.appointments a;
  IF before_appointments IS DISTINCT FROM after_appointments THEN RAISE EXCEPTION 'Hours save rewrote appointment history'; END IF;
  IF EXISTS(SELECT 1 FROM public.business_hours WHERE business_id=other_business) THEN RAISE EXCEPTION 'Foreign business changed'; END IF;
  RAISE NOTICE 'BF273: seven-row atomic invoker upsert, precision/24h,15invalid weeks, identity/OWNER/BARBER/tenant/inactive/anon and unchanged appointments PASS';
END;
$$;
ROLLBACK;
