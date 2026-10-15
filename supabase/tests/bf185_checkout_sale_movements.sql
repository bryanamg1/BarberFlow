\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.bf185_prepare(b uuid, op uuid, items jsonb, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE s public.sales%ROWTYPE; BEGIN
  s:=private.persist_checkout_sale(b,op,NULL,NULL,subtotal,discount,subtotal-discount);
  PERFORM private.persist_checkout_items(b,op,items);
  PERFORM private.persist_checkout_payment(b,op,'CASH');
  RETURN s.id;
END $$;
DO $$
DECLARE
  b uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid()];
  u uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,6));
  p uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,3));
  service uuid:=gen_random_uuid();
  client uuid:=gen_random_uuid();
  appointment uuid:=gen_random_uuid();
  member uuid;
  op uuid:=gen_random_uuid();
  next_op uuid;
  s uuid;
  original jsonb;
  replay jsonb;
  products_before jsonb;
  financial_before jsonb;
  d text;
  f record;
  actor uuid;
  role_name text;
  checks integer:=0;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid='private.persist_checkout_stock(uuid,uuid)'::regprocedure;
  IF f.prosecdef OR f.provolatile<>'v' OR NOT f.proretset OR f.pronargs<>2 OR f.pronargdefaults<>0
    OR f.prorettype<>'public.stock_movements'::regtype OR f.proowner<>'postgres'::regrole
    OR f.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id']::text[]
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee<>f.proowner OR a.is_grantable) THEN
    RAISE EXCEPTION 'BF185 unsafe helper contract';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'BF185 helper exposed'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE proname='complete_checkout')
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='public')<>41 THEN RAISE EXCEPTION 'BF185 public surface changed'; END IF;
  checks:=checks+5;
  INSERT INTO auth.users(id) SELECT unnest(u);
  INSERT INTO public.businesses(id,name) VALUES(b[1],'BF185 A'),(b[2],'BF185 B');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (b[1],u[1],'OWNER',true),(b[1],u[2],'BARBER',true),(b[1],u[3],'OWNER',false),
    (b[2],u[4],'OWNER',true),(b[1],u[6],'OWNER',true);
  INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES
    (p[1],b[1],'Original one',1,0.29),(p[2],b[1],'Original two',1,0.51),(p[3],b[2],'Foreign',1,0.88);
  INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES(service,b[1],'Service',1,30);
  INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES
    (b[1],p[1],'ADJUSTMENT',10,u[1]),(b[1],p[2],'ADJUSTMENT',10,u[1]),(b[2],p[3],'ADJUSTMENT',10,u[4]);
  SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO products_before FROM public.products t;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  s:=pg_temp.bf185_prepare(b[1],op,jsonb_build_array(
    jsonb_build_object('itemType','PRODUCT','itemId',p[1],'quantity',2),
    jsonb_build_object('itemType','PRODUCT','itemId',p[1],'quantity',1,'unitPriceOverride','2.00'),
    jsonb_build_object('itemType','PRODUCT','itemId',p[2],'quantity',1),
    jsonb_build_object('itemType','SERVICE','itemId',service,'quantity',1)),6);
  SELECT jsonb_build_object('s',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales t),
    'i',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sale_items t),
    'p',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.payments t)) INTO financial_before;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY occurred_at,id) INTO original FROM private.persist_checkout_stock(b[1],op) t;
  IF jsonb_array_length(original)<>3 OR EXISTS(SELECT 1 FROM jsonb_array_elements(original) t
      WHERE (SELECT count(*) FROM jsonb_object_keys(t))<>12
        OR t->>'type'<>'SALE' OR (t->>'quantity_delta')::integer>=0 OR t->>'reference_type'<>'SALE'
        OR (t->>'reference_id')::uuid<>s OR (t->>'business_id')::uuid<>b[1]
        OR (t->>'created_by')::uuid<>u[1] OR t->>'notes' IS NOT NULL
        OR (t->>'created_at')::timestamptz<>transaction_timestamp()
        OR (t->>'occurred_at')::timestamptz<>transaction_timestamp()) THEN
    RAISE EXCEPTION 'BF185 line/audit/projection mismatch';
  END IF;
  IF (SELECT array_agg(quantity_delta ORDER BY quantity_delta) FROM public.stock_movements WHERE reference_id=s AND product_id=p[1])<>ARRAY[-2,-1]
    OR EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_id=s AND product_id=p[1] AND unit_cost<>0.29)
    OR (SELECT unit_cost FROM public.stock_movements WHERE reference_id=s AND product_id=p[2])<>0.51 THEN
    RAISE EXCEPTION 'BF185 duplicate quantity/cost snapshot lost';
  END IF;
  IF (SELECT current_stock FROM public.get_product_stock(b[1],ARRAY[p[1]]))<>'7'
    OR (SELECT current_stock FROM public.get_product_stock(b[1],ARRAY[p[2]]))<>'9' THEN RAISE EXCEPTION 'BF185 derived balance wrong'; END IF;
  IF products_before IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t)
    OR financial_before IS DISTINCT FROM jsonb_build_object('s',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales t),
    'i',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sale_items t),
    'p',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.payments t)) THEN RAISE EXCEPTION 'BF185 changed catalog/financial snapshots'; END IF;
  checks:=checks+8;
  BEGIN UPDATE public.stock_movements SET notes='changed' WHERE reference_id=s; RAISE EXCEPTION 'BF185 ledger UPDATE accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN DELETE FROM public.stock_movements WHERE reference_id=s; RAISE EXCEPTION 'BF185 ledger DELETE accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  checks:=checks+2;
  UPDATE public.products SET name='Changed',sale_price=50,default_purchase_cost=40,is_active=false WHERE id IN (p[1],p[2]);
  INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES
    (b[1],p[1],'LOSS',-7,u[1]),(b[1],p[2],'LOSS',-9,u[1]);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[6],'role','authenticated')::text,true);
  SELECT jsonb_agg(to_jsonb(t) ORDER BY occurred_at,id) INTO replay FROM private.persist_checkout_stock(b[1],op) t;
  IF replay IS DISTINCT FROM original THEN RAISE EXCEPTION 'BF185 replay read mutable catalog/stock or replaced audit'; END IF;
  UPDATE public.sales SET status='VOIDED' WHERE id=s;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY occurred_at,id) INTO replay FROM private.persist_checkout_stock(b[1],op) t;
  IF replay IS DISTINCT FROM original THEN RAISE EXCEPTION 'BF185 VOIDED replay changed history'; END IF;
  checks:=checks+2;
  FOREACH actor IN ARRAY ARRAY[u[2],u[3],u[4],u[5],NULL::uuid] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    BEGIN PERFORM private.persist_checkout_stock(b[1],op); RAISE EXCEPTION 'BF185 unauthorized replay';
    EXCEPTION WHEN SQLSTATE '42501' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
      IF d<>'CHECKOUT_ACCESS_DENIED' THEN RAISE EXCEPTION 'BF185 unsafe access error'; END IF; END;
    checks:=checks+1;
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  FOREACH next_op IN ARRAY ARRAY[NULL::uuid,gen_random_uuid()] LOOP
    BEGIN PERFORM private.persist_checkout_stock(b[1],next_op); RAISE EXCEPTION 'BF185 missing operation accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
    checks:=checks+1;
  END LOOP;
  next_op:=gen_random_uuid();
  PERFORM pg_temp.bf185_prepare(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service,'quantity',1,'unitPriceOverride','0.00')));
  IF EXISTS(SELECT 1 FROM private.persist_checkout_stock(b[1],next_op)) THEN RAISE EXCEPTION 'BF185 service produced movement'; END IF;
  checks:=checks+1;
  INSERT INTO public.clients(id,business_id,first_name) VALUES(client,b[1],'BF185');
  SELECT id INTO member FROM public.business_members WHERE business_id=b[1] AND user_id=u[1];
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,created_by)
    VALUES(appointment,b[1],client,member,'2026-01-01T10:00Z','2026-01-01T10:30Z',u[1]);
  next_op:=gen_random_uuid();
  s:=(private.persist_checkout_sale(b[1],next_op,appointment,NULL,0,0,0)).id;
  PERFORM private.persist_checkout_items(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service,'quantity',1,'unitPriceOverride','0.00')));
  PERFORM private.persist_checkout_payment(b[1],next_op,'CASH');
  IF EXISTS(SELECT 1 FROM private.persist_checkout_stock(b[1],next_op))
    OR (SELECT status FROM public.appointments WHERE id=appointment)<>'PENDING' THEN RAISE EXCEPTION 'BF185 completed linked appointment'; END IF;
  checks:=checks+1;
  UPDATE public.products SET is_active=true,name='Original',sale_price=1,default_purchase_cost=0.29 WHERE id=p[1];
  next_op:=gen_random_uuid();
  BEGIN
    s:=pg_temp.bf185_prepare(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',p[1],'quantity',1)),1);
    PERFORM private.persist_checkout_stock(b[1],next_op); RAISE EXCEPTION 'BF185 oversold stock';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
    IF d<>'INSUFFICIENT_STOCK' THEN RAISE EXCEPTION 'BF185 unsafe stock error'; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.sales WHERE operation_id=next_op) THEN RAISE EXCEPTION 'BF185 rollback left prior slices'; END IF;
  checks:=checks+2;
  INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES(b[1],p[1],'ADJUSTMENT',5,u[1]);
  next_op:=gen_random_uuid();
  s:=pg_temp.bf185_prepare(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',p[1],'quantity',1)),1,1);
  IF (SELECT quantity_delta FROM private.persist_checkout_stock(b[1],next_op))<>-1
    OR EXISTS(SELECT 1 FROM public.payments WHERE sale_id=s) THEN RAISE EXCEPTION 'BF185 free product skipped stock or created payment'; END IF;
  checks:=checks+1;
  -- Existing partial/forged history is rejected without filling in or repairing it.
  next_op:=gen_random_uuid();
  s:=pg_temp.bf185_prepare(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',p[1],'quantity',2)),2);
  INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
    VALUES(b[1],p[1],'SALE',-1,0.29,'SALE',s,u[1]);
  BEGIN PERFORM private.persist_checkout_stock(b[1],next_op); RAISE EXCEPTION 'BF185 partial legacy set repaired'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF (SELECT count(*) FROM public.stock_movements WHERE reference_id=s)<>1 THEN RAISE EXCEPTION 'BF185 repaired history'; END IF;
  checks:=checks+2;
  next_op:=gen_random_uuid();
  s:=pg_temp.bf185_prepare(b[1],next_op,jsonb_build_array(
    jsonb_build_object('itemType','PRODUCT','itemId',p[1],'quantity',1),
    jsonb_build_object('itemType','PRODUCT','itemId',p[1],'quantity',1)),2);
  INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
    VALUES(b[1],p[1],'SALE',-2,0.29,'SALE',s,u[1]);
  BEGIN PERFORM private.persist_checkout_stock(b[1],next_op); RAISE EXCEPTION 'BF185 equal aggregate hid missing historical lines'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  checks:=checks+1;
  next_op:=gen_random_uuid();
  s:=pg_temp.bf185_prepare(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',p[1],'quantity',1)),1);
  INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
    VALUES(b[2],p[3],'SALE',-1,0.29,'SALE',s,u[4]);
  BEGIN PERFORM private.persist_checkout_stock(b[1],next_op); RAISE EXCEPTION 'BF185 foreign movement accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  checks:=checks+1;
  -- Missing payment stage, DRAFT/VOIDED header and cross-business item cannot start stock writes.
  next_op:=gen_random_uuid();
  s:=(private.persist_checkout_sale(b[1],next_op,NULL,NULL,1,0,1)).id;
  PERFORM private.persist_checkout_items(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',p[1],'quantity',1)));
  BEGIN PERFORM private.persist_checkout_stock(b[1],next_op); RAISE EXCEPTION 'BF185 missing payment accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  UPDATE public.sales SET status='VOIDED' WHERE id=s;
  BEGIN PERFORM private.persist_checkout_stock(b[1],next_op); RAISE EXCEPTION 'BF185 new VOIDED stock accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  UPDATE public.sales SET status='DRAFT' WHERE id=s;
  BEGIN PERFORM private.persist_checkout_stock(b[1],next_op); RAISE EXCEPTION 'BF185 DRAFT stock accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  UPDATE public.sales SET status='COMPLETED' WHERE id=s;
  UPDATE public.sale_items SET product_id=p[3] WHERE sale_id=s;
  BEGIN PERFORM private.persist_checkout_stock(b[1],next_op); RAISE EXCEPTION 'BF185 foreign item accepted'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  checks:=checks+4;
  IF EXISTS(SELECT 1 FROM public.purchases WHERE business_id=ANY(b))
    OR EXISTS(SELECT 1 FROM public.expenses WHERE business_id=ANY(b))
    OR EXISTS(SELECT 1 FROM public.appointments WHERE business_id=ANY(b) AND status<>'PENDING') THEN RAISE EXCEPTION 'BF185 later effects'; END IF;
  checks:=checks+1;
  RAISE NOTICE 'BF185 passed % assertion groups',checks;
END $$;
ROLLBACK;
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000081","role":"authenticated"}',true);
  BEGIN PERFORM private.persist_checkout_stock('00000000-0000-4000-8000-000000000080',gen_random_uuid());
    RAISE EXCEPTION 'BF185 stale snapshot accepted'; EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
END $$;
ROLLBACK;
