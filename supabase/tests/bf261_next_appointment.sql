\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.bf261_assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'BF261: %', label; END IF;
END $$;
CREATE FUNCTION pg_temp.bf261_error(statement text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN SQLSTATE '42501' THEN RETURN;
  END;
  RAISE EXCEPTION 'BF261 expected access denied';
END $$;
CREATE FUNCTION pg_temp.bf261_identity(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(u::text,''), true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',u,'role','authenticated')::text,true);
END $$;

DO $$
DECLARE
  b uuid:=gen_random_uuid(); foreign_b uuid:=gen_random_uuid(); empty_b uuid:=gen_random_uuid();
  owner_id uuid:=gen_random_uuid(); barber_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  owner_member uuid:=gen_random_uuid(); barber_member uuid:=gen_random_uuid(); client uuid:=gen_random_uuid();
  item uuid; low_id uuid; high_id uuid; result jsonb; state text; f record;
  visible_keys text[]; groups integer:=0;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.get_next_appointment(uuid)'::regprocedure;
  PERFORM pg_temp.bf261_assert(f.prorettype='jsonb'::regtype AND f.pronargs=1
    AND f.proargnames=ARRAY['p_business_id']::text[] AND f.pronargdefaults=0
    AND NOT f.prosecdef AND f.provolatile='s' AND f.proconfig=ARRAY['search_path=""']::text[],
    'exact physical contract, stable invoker and empty search_path');
  PERFORM pg_temp.bf261_assert(has_function_privilege('authenticated',f.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',f.oid,'EXECUTE')
    AND NOT has_function_privilege('service_role',f.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(f.proacl) WHERE grantee=0), 'authenticated-only ACL');
  PERFORM pg_temp.bf261_assert((SELECT count(*)=1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_next_appointment'),'no overload');
  groups:=groups+1;

  INSERT INTO auth.users(id) VALUES(owner_id),(barber_id),(outsider);
  INSERT INTO public.businesses(id,name,timezone) VALUES(b,'BF261','America/Argentina/Buenos_Aires'),
    (foreign_b,'Foreign','UTC'),(empty_b,'Empty','America/New_York');
  INSERT INTO public.business_members(id,business_id,user_id,role) VALUES
    (owner_member,b,owner_id,'OWNER'),(barber_member,b,barber_id,'BARBER'),
    (gen_random_uuid(),empty_b,owner_id,'OWNER'),(gen_random_uuid(),foreign_b,outsider,'OWNER');
  INSERT INTO public.clients(id,business_id,first_name) VALUES(client,b,'BF261 fixture');
  PERFORM pg_temp.bf261_identity(owner_id);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf261_assert(public.get_next_appointment(b) IS NULL
    AND public.get_next_appointment(empty_b) IS NULL,'genuine empty is SQL NULL');
  PERFORM set_config('role','postgres',true);
  groups:=groups+1;

  FOREACH state IN ARRAY ARRAY['PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW'] LOOP
    item:=gen_random_uuid();
    INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
      VALUES(item,b,client,barber_member,now()+interval '1 minute',now()+interval '31 minutes',state,owner_id);
    PERFORM set_config('role','authenticated',true);
    result:=public.get_next_appointment(b);
    PERFORM pg_temp.bf261_assert(CASE WHEN state IN ('PENDING','CONFIRMED') THEN result->>'id'=item::text
      ELSE result IS NULL END,'exact status filter '||state);
    PERFORM set_config('role','postgres',true);
    DELETE FROM public.appointments WHERE id=item;
  END LOOP;
  groups:=groups+1;

  item:=gen_random_uuid();
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
    VALUES(item,b,client,barber_member,now()-interval '1 microsecond',now()+interval '30 minutes','PENDING',owner_id);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf261_assert(public.get_next_appointment(b) IS NULL,'past by a microsecond excluded by DB clock');
  PERFORM set_config('role','postgres',true);
  UPDATE public.appointments SET start_at=now() WHERE id=item;
  PERFORM set_config('role','authenticated',true);
  result:=public.get_next_appointment(b);
  PERFORM pg_temp.bf261_assert(result->>'id'=item::text,'start exactly DB now included');
  SELECT array_agg(k ORDER BY k) INTO visible_keys FROM jsonb_object_keys(result) AS k;
  PERFORM pg_temp.bf261_assert(visible_keys=ARRAY['barber_member_id','business_id','client_id','created_at','created_by','end_at','id','notes','start_at','status','updated_at']
    AND result->'notes'='null'::jsonb,'exact eleven fields and nullable notes');
  PERFORM set_config('timezone','Pacific/Auckland',true);
  PERFORM pg_temp.bf261_assert(public.get_next_appointment(b)->>'id'=item::text,'session timezone does not change eligibility');
  PERFORM set_config('role','postgres',true);
  DELETE FROM public.appointments WHERE id=item;
  groups:=groups+1;

  low_id:=least(gen_random_uuid(),gen_random_uuid()); high_id:=gen_random_uuid();
  IF high_id<low_id THEN item:=low_id;low_id:=high_id;high_id:=item; END IF;
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by) VALUES
    (high_id,b,client,barber_member,now()+interval '1 day',now()+interval '1 day 30 minutes','CONFIRMED',owner_id),
    (low_id,b,client,barber_member,now()+interval '1 day',now()+interval '1 day 30 minutes','PENDING',owner_id);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf261_assert(public.get_next_appointment(b)->>'id'=low_id::text,'tie by id ASC, limit one');
  PERFORM set_config('role','postgres',true);
  UPDATE public.appointments SET start_at=now()+interval '2 days',end_at=now()+interval '2 days 30 minutes' WHERE id=low_id;
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf261_assert(public.get_next_appointment(b)->>'id'=high_id::text,'earliest start before id');
  PERFORM set_config('role','postgres',true);
  DELETE FROM public.appointments WHERE business_id=b;
  UPDATE public.businesses SET timezone='America/New_York' WHERE id=b;
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
    VALUES(low_id,b,client,barber_member,now()+interval '100 years',now()+interval '100 years 1 hour','PENDING',owner_id);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf261_assert(public.get_next_appointment(b)->>'id'=low_id::text,'no artificial future horizon');
  PERFORM set_config('role','postgres',true);
  DELETE FROM public.appointments WHERE business_id=b;
  groups:=groups+1;

  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by) VALUES
    (low_id,b,client,owner_member,now()+interval '1 hour',now()+interval '2 hours','PENDING',owner_id),
    (high_id,b,client,barber_member,now()+interval '3 hours',now()+interval '4 hours','CONFIRMED',owner_id);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf261_assert(public.get_next_appointment(b)->>'id'=low_id::text,'OWNER sees earliest business appointment');
  PERFORM pg_temp.bf261_identity(barber_id);
  PERFORM pg_temp.bf261_assert(public.get_next_appointment(b)->>'id'=high_id::text,'BARBER RLS hides earlier other-assigned appointment');
  PERFORM pg_temp.bf261_error(format('SELECT public.get_next_appointment(%L)',foreign_b));
  PERFORM pg_temp.bf261_error('SELECT public.get_next_appointment(NULL)');
  PERFORM pg_temp.bf261_identity(outsider);
  PERFORM pg_temp.bf261_error(format('SELECT public.get_next_appointment(%L)',b));
  PERFORM set_config('role','postgres',true);
  UPDATE public.business_members SET is_active=false WHERE id=barber_member;
  PERFORM pg_temp.bf261_identity(barber_id);
  PERFORM set_config('role','authenticated',true);
  PERFORM pg_temp.bf261_error(format('SELECT public.get_next_appointment(%L)',b));
  PERFORM pg_temp.bf261_identity(NULL);
  PERFORM pg_temp.bf261_error(format('SELECT public.get_next_appointment(%L)',b));
  PERFORM set_config('role','anon',true);
  PERFORM pg_temp.bf261_error(format('SELECT public.get_next_appointment(%L)',b));
  PERFORM set_config('role','postgres',true);
  groups:=groups+1;
  RAISE NOTICE 'BF261 PASS: % groups; physical ACL, null, six statuses, DB clock, projection, order/horizon and auth/RLS',groups;
END $$;
ROLLBACK;
