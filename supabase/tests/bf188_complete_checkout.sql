\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE f record; r text;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.complete_checkout(uuid,uuid,uuid,uuid,numeric,text,jsonb)'::regprocedure;
  IF NOT f.prosecdef OR f.proretset OR f.prorettype<>'jsonb'::regtype OR f.provolatile<>'v'
    OR f.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_appointment_id','p_client_id','p_discount_amount','p_payment_method','p_items']::text[]
    OR f.pronargdefaults<>0 OR f.proowner<>'postgres'::regrole OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
    OR has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('service_role',f.oid,'EXECUTE')
    OR EXISTS(SELECT 1 FROM aclexplode(f.proacl) WHERE grantee=0 OR is_grantable) THEN
    RAISE EXCEPTION 'Invalid public checkout signature/security boundary';
  END IF;
  FOREACH r IN ARRAY ARRAY['lock_checkout_products','persist_checkout_sale','persist_checkout_items','persist_checkout_payment','persist_checkout_stock','complete_checkout_appointment','get_checkout_replay'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='private' AND p.proname=r AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'Private stage boundary changed';END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public')<>41
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND (NOT c.relrowsecurity OR c.relforcerowsecurity))
    OR EXISTS(SELECT 1 FROM pg_proc WHERE proname='void_sale') THEN RAISE EXCEPTION 'BF188 exceeded scope';END IF;
END $$;
DO $$
DECLARE u uuid:=gen_random_uuid();b uuid:=gen_random_uuid();s uuid:=gen_random_uuid();op uuid:=gen_random_uuid();outcome jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES(u);
  INSERT INTO public.businesses(id,name,is_active) VALUES(b,'BF188',false);
  INSERT INTO public.business_members(business_id,user_id,role) VALUES(b,u,'OWNER');
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(s,b,'Free',0,15);
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  SET LOCAL ROLE authenticated;
  outcome:=public.complete_checkout(b,op,NULL,NULL,0,'CASH',jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',s,'quantity',1)));
  IF outcome->'sale'->>'status'<>'COMPLETED' OR outcome->'payments'<>'[]'::jsonb
    OR jsonb_array_length(outcome->'items')<>1 THEN RAISE EXCEPTION 'Invalid free direct checkout';END IF;
  IF public.complete_checkout(b,op,NULL,NULL,NULL,NULL,NULL) IS DISTINCT FROM outcome THEN RAISE EXCEPTION 'Replay validated new payload';END IF;
  RESET ROLE;
END $$;
ROLLBACK;
\echo 'PASS BF188 exact public signature, authenticated only, private stages, active OWNER/free direct/replay'
