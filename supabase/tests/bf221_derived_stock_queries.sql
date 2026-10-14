\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  b uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  u uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  p uuid[] := ARRAY(SELECT ('00000000-0221-4000-8000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,8) i);
  baseline jsonb;
  rows jsonb;
  actual_ids uuid[];
  expected_stocks text[] := ARRAY['0','5','-2','0','6','-5','4294967294'];
  actor integer;
  i integer;
  rpc record;
  params record;
  checks integer := 0;
BEGIN
  FOR rpc IN SELECT proc.* FROM pg_proc proc WHERE proc.oid IN (
    'public.get_product_stock(uuid,uuid[])'::regprocedure,
    'public.get_low_stock_products(uuid,integer,integer)'::regprocedure) LOOP
    IF rpc.prosecdef OR rpc.provolatile<>'s' OR NOT rpc.proretset OR rpc.proargdefaults IS NOT NULL
       OR rpc.proowner<>'postgres'::regrole OR rpc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR EXISTS (SELECT 1 FROM aclexplode(rpc.proacl) acl WHERE acl.is_grantable OR acl.privilege_type<>'EXECUTE'
           OR acl.grantee NOT IN (rpc.proowner, 'authenticated'::regrole))
       OR NOT has_function_privilege('authenticated',rpc.oid,'EXECUTE')
       OR has_function_privilege('anon',rpc.oid,'EXECUTE') OR has_function_privilege('service_role',rpc.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Unsafe BF221 metadata: %',rpc.proname;
    END IF;
    checks:=checks+1;
  END LOOP;
  IF pg_get_function_result('public.get_product_stock(uuid,uuid[])'::regprocedure)
       <> 'TABLE(product_id uuid, current_stock text)'
     OR pg_get_function_result('public.get_low_stock_products(uuid,integer,integer)'::regprocedure)
       <> 'TABLE(product_id uuid, name text, minimum_stock integer, current_stock text)' THEN
    RAISE EXCEPTION 'Wrong BF220 wire projections';
  END IF;
  INSERT INTO auth.users (id) SELECT unnest(u);
  INSERT INTO public.businesses (id,name) VALUES (b[1],'BF221 A'),(b[2],'BF221 B');
  INSERT INTO public.business_members (business_id,user_id,role,is_active) VALUES
    (b[1],u[1],'OWNER',true),(b[1],u[2],'BARBER',true),(b[2],u[3],'OWNER',true),
    (b[1],u[5],'OWNER',false),(b[1],u[6],'OWNER',true),(b[2],u[6],'OWNER',true);
  FOR i IN 1..8 LOOP
    INSERT INTO public.products (id,business_id,name,sale_price,default_purchase_cost,minimum_stock,is_active)
    VALUES (p[i],b[CASE WHEN i=8 THEN 2 ELSE 1 END],
      CASE WHEN i<=3 THEN 'A' WHEN i=4 THEN 'B' ELSE 'Z'||i END,
      999,999,CASE WHEN i IN (2,5,6) THEN 5 WHEN i=4 THEN 3 ELSE 0 END,i<>6);
  END LOOP;
  -- Every movement type is signed already. Costs and type names do not set direction.
  INSERT INTO public.stock_movements (business_id,product_id,type,quantity_delta,unit_cost,created_by) VALUES
    (b[1],p[2],'PURCHASE',10,NULL,u[1]),(b[1],p[2],'SALE',-2,999,u[1]),
    (b[1],p[2],'LOSS',-1,0,u[1]),(b[1],p[2],'ADJUSTMENT',-3,NULL,u[1]),
    (b[1],p[2],'RETURN',1,NULL,u[1]),(b[1],p[3],'SALE',-2,NULL,u[1]),
    (b[1],p[4],'PURCHASE',2,NULL,u[1]),(b[1],p[4],'RETURN',-2,NULL,u[1]),
    (b[1],p[5],'LOSS',6,NULL,u[1]),(b[1],p[6],'ADJUSTMENT',-5,NULL,u[1]),
    (b[1],p[7],'PURCHASE',2147483647,NULL,u[1]),(b[1],p[7],'PURCHASE',2147483647,NULL,u[1]),
    (b[2],p[8],'PURCHASE',20,NULL,u[3]),
    -- Independently scoped legacy FKs allow these privileged inconsistent fixtures.
    (b[2],p[2],'PURCHASE',9999,NULL,u[3]),(b[1],p[8],'PURCHASE',1000,NULL,u[1]);
  SELECT jsonb_build_object('products',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t),
    'movements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_movements t)) INTO baseline;

  FOR actor IN 1..6 LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[actor],'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    IF actor IN (1,2,6) THEN
      SELECT jsonb_agg(to_jsonb(t) ORDER BY product_id) INTO rows
      FROM public.get_product_stock(b[1],ARRAY[p[7],p[2],p[1],p[2],p[3],p[4],p[5],p[6],p[8],gen_random_uuid()]) t;
      IF jsonb_array_length(rows)<>7 THEN RAISE EXCEPTION 'Missing/duplicate/foreign/inactive stock rows for actor %',actor; END IF;
      FOR i IN 1..7 LOOP
        IF rows->(i-1)->>'product_id'<>p[i]::text OR rows->(i-1)->>'current_stock'<>expected_stocks[i]
           OR jsonb_typeof(rows->(i-1)->'current_stock')<>'string'
           OR (SELECT count(*) FROM jsonb_object_keys(rows->(i-1)))<>2 THEN
          RAISE EXCEPTION 'Wrong exact signed stock/wire value: actor %, product %',actor,i;
        END IF;
        checks:=checks+1;
      END LOOP;
      SELECT array_agg(t.product_id) INTO actual_ids FROM public.get_product_stock(b[1],ARRAY[p[7],p[2],p[1]]) t;
      IF actual_ids IS DISTINCT FROM ARRAY[p[1],p[2],p[7]] THEN RAISE EXCEPTION 'Batch output order differs'; END IF;
      IF EXISTS (SELECT 1 FROM public.get_product_stock(b[1],ARRAY[]::uuid[]))
         OR EXISTS (SELECT 1 FROM public.get_product_stock(b[1],ARRAY[p[8],gen_random_uuid()])) THEN
        RAISE EXCEPTION 'Empty/unknown/foreign batch must return no rows';
      END IF;
      SELECT array_agg(t.product_id) INTO actual_ids FROM public.get_low_stock_products(b[1],1,2) t;
      IF actual_ids IS DISTINCT FROM ARRAY[p[1],p[2],p[3]] THEN RAISE EXCEPTION 'Low stock first page/sentinel/order/predicate incorrect'; END IF;
      SELECT array_agg(t.product_id) INTO actual_ids FROM public.get_low_stock_products(b[1],2,2) t;
      IF actual_ids IS DISTINCT FROM ARRAY[p[3],p[4]] THEN RAISE EXCEPTION 'Low stock second page incorrect'; END IF;
      IF EXISTS (SELECT 1 FROM public.get_low_stock_products(b[1],2147483647,100)) THEN RAISE EXCEPTION 'Large safe offset must be empty'; END IF;
      SELECT jsonb_agg(to_jsonb(t)) INTO rows FROM public.get_low_stock_products(b[1],1,100) t;
      IF jsonb_array_length(rows)<>4 OR EXISTS (SELECT 1 FROM jsonb_array_elements(rows) r
        WHERE (SELECT count(*) FROM jsonb_object_keys(r))<>4 OR jsonb_typeof(r->'current_stock')<>'string') THEN
        RAISE EXCEPTION 'Low stock must exclude inactive/above threshold and expose exact shape';
      END IF;
      checks:=checks+7;
      FOR params IN SELECT * FROM (VALUES(NULL::integer,25),(0,25),(-1,25),(1,NULL),(1,0),(1,101)) v(page,size) LOOP
        BEGIN PERFORM * FROM public.get_low_stock_products(b[1],params.page,params.size);
          RAISE EXCEPTION 'Invalid pagination accepted';
        EXCEPTION WHEN SQLSTATE '22023' THEN checks:=checks+1; END;
      END LOOP;
      BEGIN PERFORM * FROM public.get_product_stock(b[1],NULL); RAISE EXCEPTION 'Null array accepted';
      EXCEPTION WHEN SQLSTATE '22023' THEN checks:=checks+1; END;
      BEGIN PERFORM * FROM public.get_product_stock(b[1],ARRAY[p[1],NULL]); RAISE EXCEPTION 'Null array element accepted';
      EXCEPTION WHEN SQLSTATE '22023' THEN checks:=checks+1; END;
      BEGIN PERFORM * FROM public.get_product_stock(NULL,ARRAY[p[1]]); RAISE EXCEPTION 'Null business accepted';
      EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
      BEGIN PERFORM * FROM public.get_low_stock_products(gen_random_uuid(),1,25); RAISE EXCEPTION 'Unknown business accepted';
      EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
    ELSE
      BEGIN PERFORM * FROM public.get_product_stock(b[1],ARRAY[p[1]]); RAISE EXCEPTION 'Nonmember/inactive/foreign owner allowed';
      EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
      BEGIN PERFORM * FROM public.get_low_stock_products(b[1],1,25); RAISE EXCEPTION 'Unauthorized low stock allowed';
      EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
    END IF;
    RESET ROLE;
  END LOOP;
  -- The same owner of both businesses still cannot mix the business/product predicates.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[6],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT jsonb_agg(to_jsonb(t)) INTO rows FROM public.get_product_stock(b[2],ARRAY[p[2],p[8]]) t;
  IF rows IS DISTINCT FROM jsonb_build_array(jsonb_build_object('product_id',p[8],'current_stock','20')) THEN
    RAISE EXCEPTION 'Dual-owner tenant scopes mixed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.get_low_stock_products(b[2],1,25)) THEN RAISE EXCEPTION 'Foreign ledger contaminated low stock'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims','{}',true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM * FROM public.get_product_stock(b[1],ARRAY[p[1]]); RAISE EXCEPTION 'Missing identity accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
  BEGIN PERFORM * FROM public.get_low_stock_products(b[1],1,25); RAISE EXCEPTION 'Missing identity low stock accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN PERFORM * FROM public.get_product_stock(b[1],ARRAY[p[1]]); RAISE EXCEPTION 'Anon accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
  BEGIN PERFORM * FROM public.get_low_stock_products(b[1],1,25); RAISE EXCEPTION 'Anon low stock accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
  RESET ROLE;
  -- Membership loss takes effect immediately, without cache/snapshot authorization.
  UPDATE public.business_members SET is_active=false WHERE business_id=b[1] AND user_id=u[2];
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[2],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM * FROM public.get_product_stock(b[1],ARRAY[p[1]]); RAISE EXCEPTION 'Revoked member accepted';
  EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1; END;
  RESET ROLE;
  -- Rollback removes a new movement; reads never materialize or rewrite the ledger.
  BEGIN
    INSERT INTO public.stock_movements (business_id,product_id,type,quantity_delta,created_by)
    VALUES(b[1],p[1],'ADJUSTMENT',99,u[1]);
    RAISE EXCEPTION USING ERRCODE='P0221',MESSAGE='Rollback probe';
  EXCEPTION WHEN SQLSTATE 'P0221' THEN NULL; END;
  SELECT jsonb_build_object('products',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t),
    'movements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_movements t)) INTO rows;
  IF rows IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Read RPC/rollback modified stock history or products'; END IF;
  RAISE NOTICE 'BF221 targeted SQL PASS: % counted assertions plus metadata/shape/isolation/rollback controls',checks;
END;
$$;
ROLLBACK;
