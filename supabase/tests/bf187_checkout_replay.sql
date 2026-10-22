\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE fn record; role_name text;
BEGIN
  SELECT * INTO STRICT fn FROM pg_proc WHERE oid='private.get_checkout_replay(uuid,uuid)'::regprocedure;
  IF fn.prosecdef OR fn.provolatile<>'v' OR fn.proretset OR fn.prorettype<>'jsonb'::regtype
    OR fn.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id']::text[]
    OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR fn.proowner<>'postgres'::regrole THEN
    RAISE EXCEPTION 'Unsafe replay gate metadata';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,fn.oid,'EXECUTE') THEN RAISE EXCEPTION 'Internal replay exposed'; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.complete_checkout(uuid,uuid,uuid,uuid,numeric,text,jsonb)'::regprocedure
      AND prosecdef AND prorettype='jsonb'::regtype AND pronargdefaults=0 AND proconfig=ARRAY['search_path=""']::text[]) THEN RAISE EXCEPTION 'BF188 public metadata mismatch'; END IF;
END $$;
CREATE FUNCTION pg_temp.expect_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Missing expected failure';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>expected THEN RAISE; END IF;
END $$;
DO $$
DECLARE u uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); op uuid:=gen_random_uuid();
  svc uuid:=gen_random_uuid(); s public.sales%ROWTYPE; first_result jsonb; result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES(u);
  INSERT INTO public.businesses(id,name) VALUES(b,'BF187 free direct sale');
  INSERT INTO public.business_members(business_id,user_id,role) VALUES(b,u,'OWNER');
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(svc,b,'Free',0,15);
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  IF private.get_checkout_replay(b,op) IS NOT NULL THEN RAISE EXCEPTION 'Unknown key leaked outcome'; END IF;
  s:=private.persist_checkout_sale(b,op,NULL,NULL,0,0,0);
  PERFORM pg_temp.expect_error(format('SELECT private.get_checkout_replay(%L,%L)',b,op),'22023');
  PERFORM private.persist_checkout_items(b,op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',svc,'quantity',1)));
  PERFORM private.persist_checkout_payment(b,op,'CASH');
  PERFORM private.persist_checkout_stock(b,op);
  PERFORM private.complete_checkout_appointment(b,op);
  first_result:=private.get_checkout_replay(b,op);
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(first_result) k) IS DISTINCT FROM ARRAY['items','payments','sale']::text[]
    OR jsonb_array_length(first_result->'items')<>1 OR first_result->'payments'<>'[]'::jsonb
    OR (SELECT count(*) FROM jsonb_object_keys(first_result->'sale'))<>13
    OR (SELECT count(*) FROM jsonb_object_keys(first_result->'items'->0))<>11 THEN
    RAISE EXCEPTION 'Wrong replay shape';
  END IF;
  UPDATE public.services SET name='Changed',price=50,is_active=false WHERE id=svc;
  result:=private.get_checkout_replay(b,op);
  IF result IS DISTINCT FROM first_result THEN RAISE EXCEPTION 'Catalog rewrote replay'; END IF;
  UPDATE public.sales SET status='VOIDED' WHERE id=s.id;
  result:=private.get_checkout_replay(b,op);
  IF result->'sale'->>'status'<>'VOIDED' OR result->'items' IS DISTINCT FROM first_result->'items'
    OR result->'payments' IS DISTINCT FROM first_result->'payments' THEN RAISE EXCEPTION 'VOIDED replay changed effects'; END IF;
  PERFORM pg_temp.expect_error(format('SELECT private.get_checkout_replay(%L,NULL)',b),'22023');
  UPDATE public.business_members SET is_active=false WHERE business_id=b;
  PERFORM pg_temp.expect_error(format('SELECT private.get_checkout_replay(%L,%L)',b,op),'42501');
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT private.get_checkout_replay(gen_random_uuid(),gen_random_uuid())','42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT private.get_checkout_replay(gen_random_uuid(),gen_random_uuid())','42501');
RESET ROLE;
ROLLBACK;
\echo 'PASS BF187 replay metadata, private ACL, free sale, catalog preservation, VOIDED and inactive membership'
