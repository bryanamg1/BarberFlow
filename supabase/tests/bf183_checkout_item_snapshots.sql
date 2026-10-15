\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  b uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  u uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,6));
  product uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  service uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  client uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  appointment uuid := gen_random_uuid();
  op uuid := gen_random_uuid();
  invalid_op uuid := gen_random_uuid();
  next_op uuid;
  sale public.sales%ROWTYPE;
  body jsonb;
  line jsonb;
  original jsonb;
  replay jsonb;
  catalogs jsonb;
  historical jsonb;
  f record;
  actor uuid;
  r text;
  detail text;
  checks integer := 0;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc
  WHERE oid='private.persist_checkout_items(uuid,uuid,jsonb)'::regprocedure;
  IF f.prosecdef OR f.provolatile<>'v' OR NOT f.proretset OR f.pronargs<>3 OR f.pronargdefaults<>0
     OR f.prorettype<>'public.sale_items'::regtype OR f.proowner<>'postgres'::regrole
     OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR f.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_items']::text[]
     OR EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee<>f.proowner OR a.is_grantable) THEN
    RAISE EXCEPTION 'BF183 unsafe internal contract';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(r,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'BF183 exposed to %',r; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE proname='complete_checkout')
     OR (SELECT count(*) FROM pg_policies WHERE schemaname='public')<>41 THEN
    RAISE EXCEPTION 'BF183 exposed public checkout or changed policies';
  END IF;
  checks:=checks+5;

  INSERT INTO auth.users(id) SELECT unnest(u);
  INSERT INTO public.businesses(id,name) VALUES(b[1],'BF183 A'),(b[2],'BF183 B');
  INSERT INTO public.business_members(id,business_id,user_id,role) VALUES(member,b[1],u[1],'OWNER');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (b[1],u[2],'BARBER',true),(b[1],u[3],'OWNER',false),(b[2],u[4],'OWNER',true),(b[1],u[6],'OWNER',true);
  INSERT INTO public.services(id,business_id,name,price,duration_minutes,is_active) VALUES
    (service[1],b[1],'  Service snapshot  ',0.29,30,true),
    (service[2],b[2],'Foreign',1,30,true),(service[3],b[1],'Inactive',1,30,false);
  INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost,is_active) VALUES
    (product[1],b[1],'  Product snapshot  ',2.35,1.10,true),
    (product[2],b[2],'Foreign',1,1,true),(product[3],b[1],'Inactive',1,1,false);
  INSERT INTO public.clients(id,business_id,first_name) VALUES(client,b[1],'BF183');
  INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,created_by)
  VALUES(appointment,b[1],client,member,'2026-01-01T10:00:00Z','2026-01-01T10:30:00Z',u[1]);
  INSERT INTO public.appointment_services(appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,line_total)
  VALUES(appointment,service[1],'Historical name',999,30,999);
  SELECT jsonb_build_object('s',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.services t),
    'p',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t)) INTO catalogs;
  SELECT jsonb_build_object('a',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.appointments t),
    's',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.appointment_services t)) INTO historical;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  body:=jsonb_build_array(
    jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',3),
    jsonb_build_object('itemType','PRODUCT','itemId',product[1],'quantity',2),
    jsonb_build_object('itemType','PRODUCT','itemId',product[1],'quantity',1,'unitPriceOverride','0.10'));
  sale:=private.persist_checkout_sale(b[1],op,appointment,NULL,5.67,1,4.67);
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at,i.id) INTO original
    FROM private.persist_checkout_items(b[1],op,body) i;
  IF jsonb_array_length(original)<>3 OR (SELECT count(*) FROM public.sale_items WHERE sale_id=sale.id)<>3
     OR (SELECT sum(line_total) FROM public.sale_items WHERE sale_id=sale.id)<>5.67 THEN
    RAISE EXCEPTION 'BF183 lost duplicate lines or exact totals';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(original) LOOP
    IF (SELECT count(*) FROM jsonb_object_keys(line))<>11 OR (line->>'sale_id')::uuid<>sale.id
       OR line->>'id' IS NULL OR line->>'created_at' IS NULL
       OR (line->>'line_total')::numeric<>(line->>'unit_price_snapshot')::numeric*(line->>'quantity')::integer THEN
      RAISE EXCEPTION 'BF183 projection/identity/gross mismatch';
    END IF;
    IF line->>'item_type'='SERVICE' THEN
      IF line->>'item_name_snapshot'<>'  Service snapshot  ' OR (line->>'unit_price_snapshot')::numeric<>0.29
         OR (line->>'quantity')::integer<>3 OR (line->>'service_id')::uuid<>service[1]
         OR line->'product_id'<>'null'::jsonb OR line->'unit_cost_snapshot'<>'null'::jsonb THEN
        RAISE EXCEPTION 'BF183 SERVICE source/reference/cost';
      END IF;
    ELSE
      IF line->>'item_name_snapshot'<>'  Product snapshot  ' OR (line->>'unit_cost_snapshot')::numeric<>1.10
         OR (line->>'product_id')::uuid<>product[1] OR line->'service_id'<>'null'::jsonb
         OR (line->>'unit_price_snapshot')::numeric<>(CASE WHEN (line->>'quantity')::integer=2 THEN 2.35 ELSE 0.10 END) THEN
        RAISE EXCEPTION 'BF183 PRODUCT source/reference/cost/override';
      END IF;
    END IF;
  END LOOP;
  checks:=checks+8;
  IF catalogs IS DISTINCT FROM jsonb_build_object('s',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.services t),
    'p',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t)) THEN
    RAISE EXCEPTION 'BF183 mutated catalog';
  END IF;
  checks:=checks+1;

  -- A replay ignores malformed/new input, even after inactive/name/price/cost edits.
  UPDATE public.services SET name='Changed',price=9,is_active=false WHERE id=service[1];
  UPDATE public.products SET name='Changed',sale_price=9,default_purchase_cost=8,is_active=false WHERE id=product[1];
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[6],'role','authenticated')::text,true);
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at,i.id) INTO replay FROM private.persist_checkout_items(b[1],op,NULL) i;
  IF replay IS DISTINCT FROM original THEN RAISE EXCEPTION 'BF183 replay repriced/replaced snapshots'; END IF;
  UPDATE public.sales SET status='VOIDED' WHERE id=sale.id;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at,i.id) INTO replay FROM private.persist_checkout_items(b[1],op,'{}') i;
  IF replay IS DISTINCT FROM original OR (SELECT status FROM public.sales WHERE id=sale.id)<>'VOIDED' THEN
    RAISE EXCEPTION 'BF183 VOIDED replay rewrote history';
  END IF;
  checks:=checks+2;

  FOREACH actor IN ARRAY ARRAY[u[2],u[3],u[4],u[5],NULL::uuid] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    BEGIN
      PERFORM private.persist_checkout_items(b[1],op,body); RAISE EXCEPTION 'BF183 unauthorized replay';
    EXCEPTION WHEN SQLSTATE '42501' THEN
      GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
      IF detail<>'CHECKOUT_ACCESS_DENIED' THEN RAISE EXCEPTION 'BF183 unsafe authorization error'; END IF;
    END;
    checks:=checks+1;
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u[1],'role','authenticated')::text,true);
  UPDATE public.services SET name='  Service snapshot  ',price=0.29,is_active=true WHERE id=service[1];
  UPDATE public.products SET name='  Product snapshot  ',sale_price=2.35,default_purchase_cost=1.10,is_active=true WHERE id=product[1];
  PERFORM private.persist_checkout_sale(b[1],invalid_op,NULL,NULL,1,0,1);
  -- Each rejected new set must leave zero partial lines, even after a valid first line.
  FOR body IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    'null'::jsonb,'{}'::jsonb,'[]'::jsonb,'[null]'::jsonb,'[1]'::jsonb,
    '[{}]'::jsonb,
    jsonb_build_array(jsonb_build_object('itemType','OTHER','itemId',service[1],'quantity',1)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId','invalid','quantity',1)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',NULL,'quantity',1)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',gen_random_uuid(),'quantity',1)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[2],'quantity',1)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[3],'quantity',1)),
    jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',product[2],'quantity',1)),
    jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',product[3],'quantity',1)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity','1')),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',NULL)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',0)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',-1)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',1.5)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',2147483648::numeric)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',1,'name','Injected')),
    jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',product[1],'quantity',1,'unit_cost_snapshot',0)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',2,'unitPriceOverride','9999999999.99')),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',1,'unitPriceOverride','1.00'),jsonb_build_object('itemType','PRODUCT','itemId',product[2],'quantity',1)),
    jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',1,'unitPriceOverride','9999999999.99'),jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',1,'unitPriceOverride','0.01'))
  )) LOOP
    BEGIN
      PERFORM private.persist_checkout_items(b[1],invalid_op,body); RAISE EXCEPTION 'BF183 accepted invalid items';
    EXCEPTION WHEN SQLSTATE '22023' THEN
      GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
      IF detail<>'INVALID_CHECKOUT' THEN RAISE EXCEPTION 'BF183 unsafe invalid-input error'; END IF;
    END;
    IF EXISTS(SELECT 1 FROM public.sale_items WHERE sale_id=(SELECT id FROM public.sales WHERE operation_id=invalid_op)) THEN
      RAISE EXCEPTION 'BF183 partial item persistence';
    END IF;
    checks:=checks+1;
  END LOOP;
  FOR line IN SELECT value FROM jsonb_array_elements('[null,1,-1,"-0.01","1.999","1","1e0","NaN","Infinity","10000000000.00",""]') LOOP
    body:=jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',1,'unitPriceOverride',line));
    BEGIN
      PERFORM private.persist_checkout_items(b[1],invalid_op,body); RAISE EXCEPTION 'BF183 accepted invalid override';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    checks:=checks+1;
  END LOOP;
  -- Zero, maximum and positive-int4 bounds use exact NUMERIC with no rounding.
  FOR line IN SELECT value FROM jsonb_array_elements('["0.00","9999999999.99"]') LOOP
    next_op:=gen_random_uuid();
    PERFORM private.persist_checkout_sale(b[1],next_op,NULL,NULL,(line#>>'{}')::numeric,0,(line#>>'{}')::numeric);
    PERFORM private.persist_checkout_items(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',1,'unitPriceOverride',line)));
    checks:=checks+1;
  END LOOP;
  next_op:=gen_random_uuid();
  PERFORM private.persist_checkout_sale(b[1],next_op,NULL,NULL,0,0,0);
  PERFORM private.persist_checkout_items(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','PRODUCT','itemId',product[1],'quantity',2147483647,'unitPriceOverride','0.00')));
  IF (SELECT quantity FROM public.sale_items WHERE sale_id=(SELECT id FROM public.sales WHERE operation_id=next_op))<>2147483647 THEN RAISE EXCEPTION 'BF183 int4 limit'; END IF;
  checks:=checks+1;
  -- Fresh operation with intentionally inconsistent header must not be repaired.
  BEGIN
    PERFORM private.persist_checkout_items(b[1],invalid_op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',1)));
    RAISE EXCEPTION 'BF183 subtotal mismatch accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  checks:=checks+1;
  -- Missing/foreign operation, DRAFT and VOIDED-without-items cannot create lines.
  FOR r IN SELECT unnest(ARRAY['DRAFT','VOIDED','MISSING','FOREIGN']) LOOP
    next_op:=gen_random_uuid();
    IF r IN ('DRAFT','VOIDED') THEN INSERT INTO public.sales(business_id,operation_id,status,subtotal,total,created_by) VALUES(b[1],next_op,r,1,1,u[1]);
    ELSIF r='FOREIGN' THEN INSERT INTO public.sales(business_id,operation_id,status,subtotal,total,created_by) VALUES(b[2],next_op,'COMPLETED',1,1,u[4]); END IF;
    BEGIN PERFORM private.persist_checkout_items(b[1],next_op,body); RAISE EXCEPTION 'BF183 invalid parent accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
    checks:=checks+1;
  END LOOP;
  -- Full caller transaction rollback after this slice removes header AND snapshots.
  next_op:=gen_random_uuid();
  BEGIN
    PERFORM private.persist_checkout_sale(b[1],next_op,NULL,NULL,0.29,0,0.29);
    PERFORM private.persist_checkout_items(b[1],next_op,jsonb_build_array(jsonb_build_object('itemType','SERVICE','itemId',service[1],'quantity',1)));
    RAISE EXCEPTION USING ERRCODE='Z0183',MESSAGE='synthetic later slice failure';
  EXCEPTION WHEN SQLSTATE 'Z0183' THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.sales WHERE operation_id=next_op) THEN RAISE EXCEPTION 'BF183 partial transaction'; END IF;
  IF historical IS DISTINCT FROM jsonb_build_object('a',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.appointments t),
    's',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.appointment_services t))
     OR EXISTS(SELECT 1 FROM public.payments) OR EXISTS(SELECT 1 FROM public.stock_movements)
     OR EXISTS(SELECT 1 FROM public.purchases) THEN RAISE EXCEPTION 'BF183 changed later effects/history'; END IF;
  checks:=checks+2;
  RAISE NOTICE 'BF183 PASS % assertion groups; snapshots/replay/security/rollback/no later effects',checks;
END;
$$;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000810","role":"authenticated"}',true);
  -- Use the actual demo-owner identity/business from deterministic seed.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT user_id FROM public.business_members WHERE role='OWNER' AND is_active LIMIT 1),'role','authenticated')::text,true);
  BEGIN
    PERFORM private.persist_checkout_items((SELECT business_id FROM public.business_members WHERE role='OWNER' AND is_active LIMIT 1),gen_random_uuid(),'[]');
    RAISE EXCEPTION 'BF183 accepted stale snapshot isolation';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  RAISE NOTICE 'BF183 stale-isolation guard PASS';
END $$;
ROLLBACK;
