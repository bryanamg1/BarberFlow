BEGIN;
CREATE FUNCTION pg_temp.bf216b_denied(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state=RETURNED_SQLSTATE; END;
 IF state IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Expected denied, got %',state; END IF;
END $$;
DO $$
DECLARE b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); u uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,4));
 c uuid:=gen_random_uuid(); product uuid:=gen_random_uuid(); pid uuid; draft uuid; orphan uuid;
 original jsonb; detail jsonb; v jsonb; before_rows bigint; f record; roles text; checks integer:=0;
BEGIN
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.get_purchase_detail(uuid,uuid)'::regprocedure;
 IF NOT f.prosecdef OR f.provolatile<>'s' OR f.pronargs<>2 OR f.pronargdefaults<>0 OR f.proretset
 OR f.prorettype<>'jsonb'::regtype OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
 OR EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee NOT IN(f.proowner,'authenticated'::regrole)) THEN RAISE EXCEPTION 'BF216B RPC boundary'; END IF;
 FOREACH roles IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF has_table_privilege(roles,'private.purchase_voids','SELECT') THEN RAISE EXCEPTION 'BF216B private audit exposed'; END IF;
 END LOOP;
 checks:=checks+4;
 INSERT INTO auth.users(id) SELECT unnest(u);
 INSERT INTO public.businesses(id,name) VALUES(b,'BF216B'),(other_b,'Foreign');
 INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
 (b,u[1],'OWNER',true),(b,u[2],'BARBER',true),(b,u[3],'OWNER',false),(other_b,u[4],'OWNER',true);
 INSERT INTO public.expense_categories(id,business_id,name) VALUES(c,b,'Original category');
 INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES(product,b,'Historical product',10,1);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true);
 original:=public.complete_purchase(b,gen_random_uuid(),'Supplier',c,'CASH','2026-09-20T12:00Z','  preserved  ',
 jsonb_build_array(jsonb_build_object('productId',product,'quantity',2,'unitCost','1.00'),jsonb_build_object('productId',product,'quantity',3,'unitCost','1.00')));
 pid:=(original->'purchase'->>'id')::uuid;
 detail:=public.get_purchase_detail(b,pid);
 IF (SELECT count(*) FROM jsonb_object_keys(detail))<>4 OR (SELECT count(*) FROM jsonb_object_keys(detail->'purchase'))<>6
 OR (SELECT count(*) FROM jsonb_object_keys(detail->'items'->0))<>5 OR (SELECT count(*) FROM jsonb_object_keys(detail->'expense'))<>4
 OR detail->'voidInfo'->>'status'<>'not_applicable' OR jsonb_array_length(detail->'items')<>2
 OR detail->'expense'->>'category_name'<>'Original category' OR detail->'purchase'->>'notes'<>'  preserved  '
 OR detail::text LIKE '%operation_id%' OR detail::text LIKE '%created_by%' THEN RAISE EXCEPTION 'BF216B exact completed detail'; END IF;
 IF public.get_purchase_detail(b,gen_random_uuid()) IS NOT NULL OR public.get_purchase_detail(b,NULL) IS NOT NULL THEN RAISE EXCEPTION 'BF216B missing exposed'; END IF;
 checks:=checks+6;
 PERFORM set_config('role','postgres',true);
 UPDATE public.products SET name='New name',is_active=false WHERE id=product;
 UPDATE public.expense_categories SET is_active=false WHERE id=c;
 INSERT INTO public.purchases(business_id,operation_id,supplier,status,total,created_by)
 VALUES(other_b,gen_random_uuid(),'Foreign','DRAFT',0,u[4]) RETURNING id INTO draft;
 PERFORM set_config('role','authenticated',true);
 IF public.get_purchase_detail(b,draft) IS NOT NULL THEN RAISE EXCEPTION 'BF216B foreign existence'; END IF;
 v:=public.void_purchase(b,gen_random_uuid(),pid,'  Exact reason  ');
 detail:=public.get_purchase_detail(b,pid);
 IF detail->'purchase'->>'status'<>'VOIDED' OR detail->'voidInfo'->>'status'<>'available'
 OR detail->'voidInfo'->>'reason'<>'  Exact reason  ' OR detail->'voidInfo'->'created_at' IS DISTINCT FROM v->'correction'->'created_at'
 OR (SELECT count(*) FROM jsonb_object_keys(detail->'voidInfo'))<>4
 OR jsonb_array_length(detail->'voidInfo'->'stockCompensation')<>2
 OR (SELECT sum((x->>'quantity_delta')::integer) FROM jsonb_array_elements(detail->'voidInfo'->'stockCompensation') x)<>-5
 OR detail->'items'->0->>'product_name_snapshot'<>'Historical product'
 OR detail->'expense' IS DISTINCT FROM public.get_purchase_detail(b,pid)->'expense'
 OR detail::text LIKE '%reference_id%' OR detail::text LIKE '%operation_id%' OR detail::text LIKE '%unit_cost"%' THEN RAISE EXCEPTION 'BF216B void summary';END IF;
 checks:=checks+7;
 PERFORM set_config('role','postgres',true);
 SELECT count(*) INTO before_rows FROM public.stock_movements;
 PERFORM public.get_purchase_detail(b,pid);PERFORM public.get_purchase_detail(b,pid);
 IF (SELECT count(*) FROM public.stock_movements)<>before_rows
 OR (SELECT default_purchase_cost FROM public.products WHERE id=product)<>1
 OR (SELECT to_jsonb(e) FROM public.expenses e WHERE e.purchase_id=pid) IS DISTINCT FROM original->'expense' THEN RAISE EXCEPTION 'BF216B read changed history'; END IF;
 INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
 VALUES(b,product,'ADJUSTMENT',-1,1,'PURCHASE_VOID',(v->'correction'->>'id')::uuid,u[1]);
 IF public.get_purchase_detail(b,pid)->'voidInfo' IS DISTINCT FROM '{"status":"unavailable"}'::jsonb THEN RAISE EXCEPTION 'BF216B partial audit exposed'; END IF;
 INSERT INTO public.purchases(business_id,operation_id,supplier,status,total,created_by)
 VALUES(b,gen_random_uuid(),'Orphan','VOIDED',0,u[1]) RETURNING id INTO orphan;
 IF public.get_purchase_detail(b,orphan)->'voidInfo' IS DISTINCT FROM '{"status":"unavailable"}'::jsonb THEN RAISE EXCEPTION 'BF216B invented audit'; END IF;
 INSERT INTO public.purchases(business_id,operation_id,supplier,status,total,created_by)
 VALUES(b,gen_random_uuid(),'Draft','DRAFT',0,u[1]) RETURNING id INTO draft;
 detail:=public.get_purchase_detail(b,draft);
 IF detail->'expense'<>'null'::jsonb OR detail->'purchase'->'purchased_at'<>'null'::jsonb OR detail->'voidInfo'->>'status'<>'not_applicable' THEN RAISE EXCEPTION 'BF216B invented draft data'; END IF;
 checks:=checks+5;
 PERFORM set_config('role','authenticated',true);
 FOREACH roles IN ARRAY ARRAY[u[2]::text,u[3]::text,u[4]::text] LOOP
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',roles,'role','authenticated')::text,true);
 PERFORM pg_temp.bf216b_denied(format('SELECT public.get_purchase_detail(%L,%L)',b,pid));
 IF EXISTS(SELECT 1 FROM public.purchases WHERE business_id=b) THEN RAISE EXCEPTION 'BF216B history RLS';END IF;
 END LOOP;
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM pg_temp.bf216b_denied(format('SELECT public.get_purchase_detail(%L,%L)',b,pid));
 PERFORM set_config('role','anon',true);
 PERFORM pg_temp.bf216b_denied(format('SELECT public.get_purchase_detail(%L,%L)',b,pid));
 PERFORM set_config('role','service_role',true);
 PERFORM pg_temp.bf216b_denied(format('SELECT public.get_purchase_detail(%L,%L)',b,pid));
 PERFORM set_config('role','postgres',true);
 checks:=checks+6;
 RAISE NOTICE 'BF216B PASS % grouped checks',checks;
END $$;
ROLLBACK;
