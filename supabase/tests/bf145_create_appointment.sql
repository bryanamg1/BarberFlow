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
DECLARE fn record; r text; t text; p text; c record;
BEGIN
  SELECT * INTO STRICT fn FROM pg_proc WHERE oid='public.create_appointment_with_services(uuid,uuid,uuid,uuid,timestamptz,jsonb,integer,text)'::regprocedure;
  IF NOT fn.prosecdef OR fn.provolatile<>'v' OR fn.proretset OR fn.prorettype<>'jsonb'::regtype
    OR fn.proowner<>'postgres'::regrole OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR fn.pronargs<>8 OR fn.pronargdefaults<>2
    OR fn.proargnames IS DISTINCT FROM ARRAY['p_appointment_id','p_business_id','p_client_id','p_barber_member_id','p_start_at','p_service_items','p_duration_override','p_notes']::text[] THEN
    RAISE EXCEPTION 'Create RPC metadata differs';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(r,fn.oid,'EXECUTE') IS DISTINCT FROM (r='authenticated') THEN RAISE EXCEPTION 'Wrong create EXECUTE'; END IF;
    FOREACH t IN ARRAY ARRAY['appointments','appointment_services'] LOOP
      FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
        IF has_table_privilege(r,'public.'||t,p) IS DISTINCT FROM (r='service_role') THEN RAISE EXCEPTION 'Direct DML grant leaked'; END IF;
      END LOOP;
      FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=('public.'||t)::regclass AND attnum>0 AND NOT attisdropped LOOP
        FOREACH p IN ARRAY ARRAY['INSERT','UPDATE'] LOOP
          IF has_column_privilege(r,'public.'||t,c.attname,p) IS DISTINCT FROM (r='service_role') THEN RAISE EXCEPTION 'Direct column DML grant leaked'; END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public')<>41
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('appointments','appointment_services') AND cmd='SELECT')<>2
    OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('appointments','appointment_services') AND cmd<>'SELECT')
    OR EXISTS(SELECT 1 FROM pg_class tbl JOIN pg_namespace ns ON ns.oid=tbl.relnamespace WHERE ns.nspname='public' AND tbl.relkind='r' AND (NOT tbl.relrowsecurity OR tbl.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Read policies/RLS/write fence differs';
  END IF;
END;
$$;
DO $$
DECLARE
  owner_id uuid:=gen_random_uuid(); barber_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  biz uuid:=gen_random_uuid(); foreign_biz uuid:=gen_random_uuid(); owner_member uuid:=gen_random_uuid(); barber_member uuid:=gen_random_uuid(); foreign_member uuid:=gen_random_uuid();
  client_id uuid:=gen_random_uuid(); foreign_client uuid:=gen_random_uuid(); service_id uuid:=gen_random_uuid(); foreign_service uuid:=gen_random_uuid();
  request_id uuid:=gen_random_uuid(); another_id uuid:=gen_random_uuid(); replay jsonb; original jsonb; row_value jsonb; item jsonb; payload jsonb;
  statement text; base text; state text; scenario record; n integer;
BEGIN
  INSERT INTO auth.users(id) VALUES(owner_id),(barber_id),(outsider);
  INSERT INTO public.businesses(id,name,timezone) VALUES(biz,'Create RPC test','UTC'),(foreign_biz,'Foreign create','UTC');
  INSERT INTO public.business_members(id,business_id,user_id,role) VALUES
    (owner_member,biz,owner_id,'OWNER'),(barber_member,biz,barber_id,'BARBER'),(foreign_member,foreign_biz,outsider,'OWNER');
  INSERT INTO public.clients(id,business_id,first_name) VALUES(client_id,biz,'Test'),(foreign_client,foreign_biz,'Foreign');
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(service_id,biz,'Original catalog',0.29,15),(foreign_service,foreign_biz,'Foreign',10,30);
  INSERT INTO public.business_settings(business_id,appointment_interval_minutes,default_service_buffer_minutes) VALUES(biz,20,10);
  INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time) VALUES(biz,3,'09:10','12:10');
  payload:=jsonb_build_array(jsonb_build_object('service_id',service_id,'quantity',2,'unit_price_snapshot',9999,'service_name_snapshot','Forged'));
  base:=format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb',request_id,biz,client_id,barber_member,'2026-10-14T09:10Z',payload);
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  SET LOCAL ROLE authenticated;
  original:=public.create_appointment_with_services(request_id,biz,client_id,barber_member,'2026-10-14T09:10Z',payload,NULL,'  original notes  ');
  IF jsonb_typeof(original)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(original))<>12
    OR original->>'id'<>request_id::text OR original->>'status'<>'PENDING' OR original->>'created_by'<>owner_id::text
    OR (original->>'end_at')::timestamptz<>'2026-10-14T09:40Z'::timestamptz OR original->>'notes'<>'  original notes  ' THEN
    RAISE EXCEPTION 'Wrong parent projection/server fields/end/notes';
  END IF;
  item:=original->'appointment_services'->0;
  IF (SELECT count(*) FROM jsonb_object_keys(item))<>9 OR item->>'service_name_snapshot'<>'Original catalog'
    OR (item->>'unit_price_snapshot')::numeric<>0.29 OR (item->>'quantity')::integer<>2
    OR (item->>'duration_minutes_snapshot')::integer<>15 OR (item->>'line_total')::numeric<>0.58 THEN
    RAISE EXCEPTION 'Snapshots must come from server catalog and exact numeric multiplication';
  END IF;
  -- The entire occupied interval, including posterior buffer, blocks a new create.
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',another_id,biz,client_id,barber_member,'2026-10-14T09:30Z',payload),'PT409');
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',another_id,biz,client_id,barber_member,'2026-10-14T09:11Z',payload),'PT422');
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',another_id,biz,client_id,barber_member,'2026-10-14T11:50Z',payload),'PT422');
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM public.appointments WHERE id=another_id) OR (SELECT count(*) FROM public.appointment_services WHERE appointment_id=request_id)<>1 THEN
    RAISE EXCEPTION 'Failed create left partial data';
  END IF;
  UPDATE public.services SET name='Changed',price=80,duration_minutes=120,is_active=false WHERE id=service_id;
  UPDATE public.clients SET is_active=false WHERE id=client_id;
  SET LOCAL ROLE authenticated;
  replay:=public.create_appointment_with_services(request_id,biz,NULL,NULL,NULL,'[]');
  IF replay IS DISTINCT FROM original THEN RAISE EXCEPTION 'Authorized replay recalculated/changed history'; END IF;
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',another_id,biz,client_id,barber_member,'2026-10-14T10:10Z',payload),'PT422');
  RESET ROLE;
  UPDATE public.clients SET is_active=true WHERE id=client_id;
  UPDATE public.services SET is_active=true,duration_minutes=15 WHERE id=service_id;
  -- Owner can target their own working OWNER membership and override real duration.
  SET LOCAL ROLE authenticated;
  row_value:=public.create_appointment_with_services(gen_random_uuid(),biz,client_id,owner_member,'2026-10-14T09:10Z',payload,20,'');
  IF (row_value->>'end_at')::timestamptz<>'2026-10-14T09:30Z'::timestamptz OR row_value->>'notes'<>''
    OR (row_value->'appointment_services'->0->>'duration_minutes_snapshot')::integer<>15 THEN RAISE EXCEPTION 'Owner override must not rewrite catalog snapshot'; END IF;
  -- Duplicate catalog lines are allowed; two lines and summed durations are preserved.
  row_value:=public.create_appointment_with_services(gen_random_uuid(),biz,client_id,barber_member,'2026-10-14T10:10Z',jsonb_build_array(
    jsonb_build_object('service_id',service_id,'quantity',1),jsonb_build_object('service_id',service_id,'quantity',1)));
  IF jsonb_array_length(row_value->'appointment_services')<>2 OR (row_value->>'end_at')::timestamptz<>'2026-10-14T10:40Z'::timestamptz OR row_value->'notes'<>'null'::jsonb THEN RAISE EXCEPTION 'Duplicate/default notes contract differs'; END IF;
  RESET ROLE;
  -- Every malformed/foreign/inactive case rolls back completely.
  FOR scenario IN SELECT * FROM (VALUES
    (client_id,barber_member,'[]'::jsonb,NULL::integer,'PT422'),
    (client_id,barber_member,'{}'::jsonb,NULL::integer,'PT422'),
    (client_id,barber_member,'null'::jsonb,NULL::integer,'PT422'),
    (client_id,barber_member,'[null]'::jsonb,NULL::integer,'PT422'),
    (client_id,barber_member,'[{"service_id":"bad","quantity":1}]'::jsonb,NULL::integer,'PT422'),
    (client_id,barber_member,jsonb_build_array(jsonb_build_object('service_id',service_id,'quantity','1')),NULL::integer,'PT422'),
    (client_id,barber_member,jsonb_build_array(jsonb_build_object('service_id',service_id,'quantity',0)),NULL::integer,'PT422'),
    (client_id,barber_member,jsonb_build_array(jsonb_build_object('service_id',service_id,'quantity',1.5)),NULL::integer,'PT422'),
    (client_id,barber_member,jsonb_build_array(jsonb_build_object('service_id',service_id,'quantity',2147483648)),NULL::integer,'PT422'),
    (client_id,barber_member,payload,0,'PT422'),
    (foreign_client,barber_member,payload,NULL::integer,'PT422'),
    (client_id,barber_member,jsonb_build_array(jsonb_build_object('service_id',foreign_service,'quantity',1)),NULL::integer,'PT422'),
    (client_id,foreign_member,payload,NULL::integer,'42501')
  ) cases(c,m,items,override_value,error_code) LOOP
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb,%L)',another_id,biz,scenario.c,scenario.m,'2026-10-14T11:10Z',scenario.items,scenario.override_value),scenario.error_code);
    RESET ROLE;
    IF EXISTS(SELECT 1 FROM public.appointments WHERE id=another_id) OR EXISTS(SELECT 1 FROM public.appointment_services WHERE appointment_id=another_id) THEN RAISE EXCEPTION 'Invalid create left data'; END IF;
  END LOOP;
  UPDATE public.services SET is_active=false WHERE id=service_id;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',another_id,biz,client_id,barber_member,'2026-10-14T11:10Z',payload),'PT422');
  RESET ROLE;
  UPDATE public.services SET is_active=true,price=9999999999.99 WHERE id=service_id;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',another_id,biz,client_id,barber_member,'2026-10-14T11:10Z',payload),'PT422');
  RESET ROLE;
  UPDATE public.services SET price=0,duration_minutes=2147483647 WHERE id=service_id;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',another_id,biz,client_id,barber_member,'2026-10-14T11:10Z',payload),'PT422');
  RESET ROLE;
  UPDATE public.services SET price=80,duration_minutes=15 WHERE id=service_id;
  UPDATE public.business_hours SET is_closed=true WHERE business_id=biz;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',another_id,biz,client_id,barber_member,'2026-10-14T11:10Z',payload),'PT422');
  RESET ROLE;
  UPDATE public.business_hours SET is_closed=false WHERE business_id=biz;
  DELETE FROM public.business_settings WHERE business_id=biz;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',another_id,biz,client_id,barber_member,'2026-10-14T11:10Z',payload),'22023');
  RESET ROLE;
  INSERT INTO public.business_settings(business_id,appointment_interval_minutes,default_service_buffer_minutes) VALUES(biz,20,10);
  PERFORM set_config('request.jwt.claim.sub',barber_id::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(base||')','42501'); -- another creator cannot replay
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb,20)',another_id,biz,client_id,barber_member,'2026-10-14T11:10Z',payload),'42501');
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',another_id,biz,client_id,owner_member,'2026-10-14T11:10Z',payload),'42501');
  row_value:=public.create_appointment_with_services(another_id,biz,client_id,barber_member,'2026-10-14T11:10Z',payload);
  IF row_value->>'created_by'<>barber_id::text THEN RAISE EXCEPTION 'Barber own create failed'; END IF;
  RESET ROLE;
  UPDATE public.business_members SET is_active=false WHERE id=barber_member;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,NULL,NULL,NULL,NULL)',another_id,biz),'42501');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',gen_random_uuid(),biz,client_id,barber_member,'2026-10-14T11:50Z',payload),'42501');
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,NULL,NULL,NULL,NULL)',request_id,foreign_biz),'42501');
  RESET ROLE;
  INSERT INTO public.business_members(business_id,user_id,role) VALUES(foreign_biz,owner_id,'OWNER');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,NULL,NULL,NULL,NULL)',request_id,foreign_biz),'42501');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(base||')','42501');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub','',true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(base||')','42501');
  RESET ROLE;
  SET LOCAL ROLE anon;
  PERFORM pg_temp.expect_error(base||')','42501');
  RESET ROLE;
  RAISE NOTICE 'BF145 roles, refs, snapshots, duplicate lines, replay, grid/buffer, override, invalid inputs and rollback passed';
END;
$$;
DO $$
DECLARE u uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); first_fold jsonb; second_fold jsonb; spring jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES(u);
  INSERT INTO public.businesses(id,name,timezone) VALUES(b,'DST create','America/New_York');
  INSERT INTO public.business_members(id,business_id,user_id,role) VALUES(m,b,u,'OWNER');
  INSERT INTO public.clients(id,business_id,first_name) VALUES(c,b,'DST');
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(s,b,'DST service',0,30);
  INSERT INTO public.business_settings(business_id) VALUES(b);
  INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time) VALUES(b,0,'01:00','04:00');
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  SET LOCAL ROLE authenticated;
  first_fold:=public.create_appointment_with_services(gen_random_uuid(),b,c,m,'2026-11-01T05:00Z',jsonb_build_array(jsonb_build_object('service_id',s,'quantity',1)));
  second_fold:=public.create_appointment_with_services(gen_random_uuid(),b,c,m,'2026-11-01T06:00Z',jsonb_build_array(jsonb_build_object('service_id',s,'quantity',1)));
  spring:=public.create_appointment_with_services(gen_random_uuid(),b,c,m,'2026-03-08T06:30Z',jsonb_build_array(jsonb_build_object('service_id',s,'quantity',1)));
  IF (first_fold->>'end_at')::timestamptz<>'2026-11-01T05:30Z'::timestamptz
    OR (second_fold->>'end_at')::timestamptz<>'2026-11-01T06:30Z'::timestamptz
    OR (spring->>'end_at')::timestamptz<>'2026-03-08T07:00Z'::timestamptz THEN RAISE EXCEPTION 'Create must reuse DST slots and elapsed duration'; END IF;
  RESET ROLE;
  RAISE NOTICE 'BF145 creates both repeated civil starts and elapsed duration through spring DST';
END;
$$;
-- Deliberately fail the second line INSERT after a valid parent/first line path.
-- A nested transaction must remove the parent and every line as one unit.
CREATE FUNCTION pg_temp.fail_line_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.quantity=2 THEN RAISE EXCEPTION USING ERRCODE='ZT145',MESSAGE='Test second line failure'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER bf145_test_failure BEFORE INSERT ON public.appointment_services FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_line_insert();
DO $$
DECLARE u uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); a uuid:=gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES(u);
  INSERT INTO public.businesses(id,name,timezone) VALUES(b,'Atomic test','UTC');
  INSERT INTO public.business_members(id,business_id,user_id,role) VALUES(m,b,u,'OWNER');
  INSERT INTO public.clients(id,business_id,first_name) VALUES(c,b,'Atomic');
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(s,b,'Atomic',0,30);
  INSERT INTO public.business_settings(business_id) VALUES(b);
  INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time) VALUES(b,3,'09:00','11:00');
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.expect_error(format('SELECT public.create_appointment_with_services(%L,%L,%L,%L,%L,%L::jsonb)',a,b,c,m,'2026-10-14T09:00Z',jsonb_build_array(jsonb_build_object('service_id',s,'quantity',1),jsonb_build_object('service_id',s,'quantity',2))),'ZT145');
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM public.appointments WHERE id=a) OR EXISTS(SELECT 1 FROM public.appointment_services WHERE appointment_id=a) THEN RAISE EXCEPTION 'Partial parent/lines escaped rollback'; END IF;
  RAISE NOTICE 'BF145 real INSERT failure rolls back parent and snapshots';
END;
$$;
ROLLBACK;
