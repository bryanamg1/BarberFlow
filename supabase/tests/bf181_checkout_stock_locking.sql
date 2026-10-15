\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  b uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  u uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 5));
  p uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 6));
  helper record;
  result jsonb;
  expected jsonb;
  before_products jsonb;
  before_ledger jsonb;
  role_name text;
  code text;
  detail text;
  i integer;
  checks integer := 0;
BEGIN
  SELECT * INTO STRICT helper FROM pg_proc
  WHERE oid = 'private.lock_checkout_products(uuid,uuid[],integer[])'::regprocedure;
  IF helper.prosecdef OR helper.provolatile <> 'v' OR NOT helper.proretset
     OR helper.pronargs <> 3 OR helper.pronargdefaults <> 0
     OR helper.proowner <> 'postgres'::regrole
     OR helper.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR helper.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_product_ids','p_quantities','product_id','requested_quantity','current_stock']::text[]
     OR EXISTS (SELECT 1 FROM aclexplode(helper.proacl) a WHERE a.grantee <> helper.proowner OR a.is_grantable) THEN
    RAISE EXCEPTION 'BF181 unsafe internal helper metadata';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'complete_checkout')
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') <> 41
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r' AND (NOT c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'BF181 exposed checkout or changed policies/RLS';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,helper.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'BF181 helper exposed to %',role_name;
    END IF;
  END LOOP;
  checks := checks + 5;

  INSERT INTO auth.users(id) SELECT unnest(u);
  INSERT INTO public.businesses(id,name) VALUES(b[1],'BF181 A'),(b[2],'BF181 B');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (b[1],u[1],'OWNER',true),(b[1],u[2],'BARBER',true),
    (b[1],u[3],'OWNER',false),(b[2],u[4],'OWNER',true);
  FOR i IN 1..6 LOOP
    INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost,is_active)
    VALUES(p[i],b[CASE WHEN i=4 THEN 2 ELSE 1 END],'BF181 '||i,10,4,i<>3);
  END LOOP;
  INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES
    (b[1],p[1],'PURCHASE',10,u[1]),(b[1],p[1],'SALE',-2,u[1]),
    (b[1],p[2],'PURCHASE',5,u[1]),(b[1],p[3],'PURCHASE',5,u[1]),
    (b[1],p[6],'PURCHASE',2147483647,u[1]),(b[1],p[6],'PURCHASE',2147483647,u[1]),
    -- Independently valid but inconsistent legacy FK ownership is excluded.
    (b[2],p[1],'ADJUSTMENT',9999,u[4]);
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO before_products FROM public.products t;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO before_ledger FROM public.stock_movements t;

  -- Test the private implementation under its future server owner's context,
  -- while always deriving the caller identity from auth.uid().
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  SELECT jsonb_agg(to_jsonb(t) ORDER BY product_id) INTO result
  FROM private.lock_checkout_products(b[1],ARRAY[p[2],p[1],p[1]],ARRAY[1,3,5]) t;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY product_id) INTO expected
  FROM (VALUES(p[1],8::bigint,8::bigint),(p[2],1::bigint,5::bigint)) AS t(product_id,requested_quantity,current_stock);
  IF result IS DISTINCT FROM expected THEN RAISE EXCEPTION 'BF181 aggregate/derived/scoped stock mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM private.lock_checkout_products(b[1],ARRAY[]::uuid[],ARRAY[]::integer[])) THEN
    RAISE EXCEPTION 'BF181 service-only input must require no product';
  END IF;
  SELECT to_jsonb(t) INTO result FROM private.lock_checkout_products(b[1],ARRAY[p[6],p[6]],ARRAY[2147483647,2147483647]) t;
  IF (result->>'requested_quantity')::bigint <> 4294967294 OR (result->>'current_stock')::bigint <> 4294967294 THEN
    RAISE EXCEPTION 'BF181 int4 duplicate aggregation overflow';
  END IF;
  -- Pair by ordinality, not array lower bound.
  SELECT to_jsonb(t) INTO result FROM private.lock_checkout_products(b[1],array_fill(p[1],ARRAY[1],ARRAY[0]),ARRAY[2]) t;
  IF (result->>'requested_quantity')::bigint <> 2 THEN RAISE EXCEPTION 'BF181 array pairing'; END IF;
  checks := checks + 4;

  FOR i IN 1..14 LOOP
    BEGIN
      CASE i
        WHEN 1 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[p[1]],ARRAY[9]);
        WHEN 2 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[p[5]],ARRAY[1]);
        WHEN 3 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[p[3]],ARRAY[1]);
        WHEN 4 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[p[4]],ARRAY[1]);
        WHEN 5 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[gen_random_uuid()],ARRAY[1]);
        WHEN 6 THEN PERFORM private.lock_checkout_products(b[1],NULL,ARRAY[1]);
        WHEN 7 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[p[1]],ARRAY[0]);
        WHEN 8 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[p[1],p[1]],ARRAY[5,4]);
        WHEN 9 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[p[1]],ARRAY[1,2]);
        WHEN 10 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[p[1]],NULL);
        WHEN 11 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[NULL]::uuid[],ARRAY[1]);
        WHEN 12 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[p[1]],ARRAY[NULL]::integer[]);
        WHEN 13 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[p[1]],ARRAY[-1]);
        WHEN 14 THEN PERFORM private.lock_checkout_products(b[1],ARRAY[[p[1]]],ARRAY[1]);
      END CASE;
      RAISE EXCEPTION 'BF181 invalid product request accepted';
    EXCEPTION WHEN SQLSTATE 'PT409' OR SQLSTATE '22023' THEN
      GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE, detail=PG_EXCEPTION_DETAIL;
      IF code <> (CASE WHEN i IN(1,2,8) THEN 'PT409' ELSE '22023' END)
         OR detail IS DISTINCT FROM (CASE WHEN i IN(1,2,8) THEN 'INSUFFICIENT_STOCK' ELSE 'INVALID_CHECKOUT' END) THEN
        RAISE EXCEPTION 'BF181 wrong normalized failure';
      END IF;
      checks := checks + 1;
    END;
  END LOOP;
  FOR i IN 2..5 LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[i],'role','authenticated')::text,true);
    BEGIN
      PERFORM private.lock_checkout_products(b[1],ARRAY[p[1]],ARRAY[1]);
      RAISE EXCEPTION 'BF181 denied identity accepted';
    EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  END LOOP;
  PERFORM set_config('request.jwt.claims','{}',true);
  BEGIN
    PERFORM private.lock_checkout_products(b[1],ARRAY[]::uuid[],ARRAY[]::integer[]);
    RAISE EXCEPTION 'BF181 identity required even with empty product list';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM private.lock_checkout_products(b[1],ARRAY[p[1]],ARRAY[1]);
    RAISE EXCEPTION 'BF181 direct client helper call allowed';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1; END;
  RESET ROLE;
  IF before_products IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t)
     OR before_ledger IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_movements t) THEN
    RAISE EXCEPTION 'BF181 mutated catalog/history or appended SALE';
  END IF;
  RAISE NOTICE 'BF181 PASS: % assertion groups; private locks only, no writes', checks + 1;
END;
$$;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$
DECLARE b uuid; u uuid;
BEGIN
  SELECT business_id,user_id INTO b,u FROM public.business_members WHERE role='OWNER' AND is_active LIMIT 1;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  BEGIN
    PERFORM private.lock_checkout_products(b,ARRAY[]::uuid[],ARRAY[]::integer[]);
    RAISE EXCEPTION 'BF181 stale snapshot isolation allowed';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
END;
$$;
ROLLBACK;
