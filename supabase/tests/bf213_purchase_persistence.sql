\set ON_ERROR_STOP on
BEGIN;
-- Transaction-scoped fault injection: a later line fails after the header and
-- earlier line have been inserted. ROLLBACK removes the test trigger/function.
CREATE FUNCTION pg_temp.bf213_reject_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.purchase_items WHERE purchase_id=NEW.purchase_id) THEN
    RAISE EXCEPTION 'BF213 fault injection did not exercise a partial item set';
  END IF;
  RAISE EXCEPTION USING ERRCODE='P0213', MESSAGE='Synthetic purchase item failure';
END;
$$;
CREATE TRIGGER bf213_reject_item BEFORE INSERT ON public.purchase_items
FOR EACH ROW WHEN (NEW.quantity=17) EXECUTE FUNCTION pg_temp.bf213_reject_item();
DO $$
DECLARE
  businesses uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
  users uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 6));
  product_ids uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  categories uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  operation uuid := gen_random_uuid();
  rejected_operation uuid;
  parent_id uuid;
  actor uuid;
  body jsonb;
  valid_body jsonb;
  result jsonb;
  original jsonb;
  line jsonb;
  expected jsonb;
  product_before jsonb;
  unrelated_before jsonb;
  f record;
  method text;
  supplier text;
  detail text;
  role_name text;
  checks integer := 0;
  before_items bigint;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc
  WHERE oid = 'private.persist_purchase(uuid,uuid,text,uuid,text,timestamptz,text,jsonb)'::regprocedure;
  IF f.prosecdef OR f.provolatile <> 'v' OR f.proretset OR f.pronargs <> 8 OR f.pronargdefaults <> 0
     OR f.prorettype <> 'jsonb'::regtype OR f.proowner <> 'postgres'::regrole
     OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR f.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_supplier','p_expense_category_id',
          'p_payment_method','p_purchased_at','p_notes','p_items']::text[]
     OR EXISTS (SELECT 1 FROM aclexplode(f.proacl) AS a WHERE a.grantee <> f.proowner OR a.is_grantable) THEN
    RAISE EXCEPTION 'BF213 unsafe function contract';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name, f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'BF213 exposed to %', role_name;
    END IF;
  END LOOP;
  -- BF216 now owns the complete public boundary; private ACL stays denied.
  IF has_table_privilege('authenticated','public.purchases','INSERT')
     OR has_table_privilege('authenticated','public.purchase_items','UPDATE') THEN
    RAISE EXCEPTION 'BF213 exposed incomplete purchase writes';
  END IF;
  checks := checks + 5;

  INSERT INTO auth.users(id) SELECT unnest(users);
  INSERT INTO public.businesses(id,name) VALUES (businesses[1],'BF213 A'),(businesses[2],'BF213 B');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (businesses[1],users[1],'OWNER',true),(businesses[1],users[2],'BARBER',true),
    (businesses[1],users[3],'OWNER',false),(businesses[2],users[4],'OWNER',true),
    (businesses[1],users[6],'OWNER',true);
  INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost,is_active) VALUES
    (product_ids[1],businesses[1],'  Historical product  ',20,7,true),
    (product_ids[2],businesses[1],'Second product',10,9,true),
    (product_ids[3],businesses[2],'Foreign product',1,1,true),
    (product_ids[4],businesses[1],'Inactive product',1,1,false);
  INSERT INTO public.expense_categories(id,business_id,name,is_active) VALUES
    (categories[1],businesses[1],'Purchase category',true),
    (categories[2],businesses[2],'Foreign category',true),
    (categories[3],businesses[1],'Inactive category',false);
  SELECT jsonb_agg(to_jsonb(p) ORDER BY id) INTO product_before FROM public.products p;
  SELECT jsonb_build_object(
    'ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_movements t),
    'expenses',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.expenses t),
    'sales',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales t),
    'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.payments t)) INTO unrelated_before;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  valid_body := jsonb_build_array(
    jsonb_build_object('productId',product_ids[1],'quantity',3,'unitCost','0.29'),
    jsonb_build_object('productId',upper(product_ids[1]::text),'quantity',1.0,'unitCost','00.29'),
    jsonb_build_object('productId',product_ids[2],'quantity',2,'unitCost','1.01'));
  original := private.persist_purchase(businesses[1],operation,'  Supplier original  ',categories[1],
    'CASH','2020-02-29T10:30:00.123456-03:00','  Notes original  ',valid_body);
  parent_id := (original->'purchase'->>'id')::uuid;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(original) k) <> ARRAY['items','purchase']
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(original->'purchase') k) <>
       ARRAY['business_id','created_at','created_by','id','notes','operation_id','purchased_at','status','supplier','total','updated_at']
     OR jsonb_array_length(original->'items') <> 3 OR (original->'purchase'->>'total')::numeric <> 3.18
     OR (original->'purchase'->>'created_by')::uuid <> users[1]
     OR (original->'purchase'->>'business_id')::uuid <> businesses[1]
     OR (original->'purchase'->>'operation_id')::uuid <> operation
     OR original->'purchase'->>'status' <> 'COMPLETED'
     OR original->'purchase'->>'supplier' <> '  Supplier original  '
     OR original->'purchase'->>'notes' <> '  Notes original  '
     OR (original->'purchase'->>'purchased_at')::timestamptz <> '2020-02-29T13:30:00.123456Z'::timestamptz THEN
    RAISE EXCEPTION 'BF213 header/output/exact total mismatch';
  END IF;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at,i.id) INTO expected
    FROM public.purchase_items i WHERE i.purchase_id=parent_id;
  IF original->'items' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'BF213 item ordering mismatch'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(original->'items') LOOP
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(line) k) <>
         ARRAY['created_at','id','line_total','product_id','product_name_snapshot','purchase_id','quantity','unit_cost_snapshot']
       OR (line->>'purchase_id')::uuid <> parent_id
       OR (line->>'line_total')::numeric <> (line->>'quantity')::integer*(line->>'unit_cost_snapshot')::numeric
       OR line->>'created_at' IS NULL OR line->>'id' IS NULL THEN
      RAISE EXCEPTION 'BF213 line projection/equality mismatch';
    END IF;
    IF (line->>'product_id')::uuid=product_ids[1] AND
       (line->>'product_name_snapshot'<>'  Historical product  ' OR (line->>'unit_cost_snapshot')::numeric<>0.29) THEN
      RAISE EXCEPTION 'BF213 snapshot source mismatch';
    END IF;
  END LOOP;
  IF product_before IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.products p) THEN
    RAISE EXCEPTION 'BF213 changed products';
  END IF;
  checks := checks + 8;

  -- Every HD006 method, zero/max amounts, int4 max and preserved optional text.
  FOREACH method IN ARRAY ARRAY['CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET'] LOOP
    result := private.persist_purchase(businesses[1],gen_random_uuid(),E'\t',categories[1],method,
      '2100-01-01Z',NULL,jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',2147483647,'unitCost','0.00')));
    IF result->'purchase'->'notes'<>'null'::jsonb OR result->'purchase'->>'supplier'<>E'\t'
       OR (result->'purchase'->>'total')::numeric<>0 THEN RAISE EXCEPTION 'BF213 invented input defaults'; END IF;
    checks := checks + 1;
  END LOOP;
  result := private.persist_purchase(businesses[1],gen_random_uuid(),'S',categories[1],'CASH','2026-01-01Z','',
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','9999999999.99')));
  IF (result->'purchase'->>'total')::numeric<>9999999999.99 OR result->'purchase'->>'notes'<>'' THEN
    RAISE EXCEPTION 'BF213 max/empty notes invalid';
  END IF;
  checks := checks + 1;

  -- Replay is authorized again, but ignores new payload/catalog activity/prices.
  UPDATE public.products SET name='Changed',sale_price=99,default_purchase_cost=88,is_active=false WHERE id=product_ids[1];
  UPDATE public.expense_categories SET is_active=false WHERE id=categories[1];
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[6],'role','authenticated')::text,true);
  result := private.persist_purchase(businesses[1],operation,NULL,NULL,NULL,NULL,NULL,NULL);
  IF result IS DISTINCT FROM original THEN RAISE EXCEPTION 'BF213 replay rewrote history'; END IF;
  UPDATE public.purchases SET status='VOIDED' WHERE id=parent_id;
  result := private.persist_purchase(businesses[1],operation,NULL,NULL,NULL,NULL,NULL,'{}');
  IF result->'items' IS DISTINCT FROM original->'items' OR result->'purchase'->>'status'<>'VOIDED'
     OR result->'purchase'->>'supplier'<>original->'purchase'->>'supplier' THEN
    RAISE EXCEPTION 'BF213 reopened VOIDED/repriced replay';
  END IF;
  checks := checks + 2;
  FOREACH actor IN ARRAY ARRAY[users[2],users[3],users[4],users[5],NULL::uuid] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    BEGIN
      PERFORM private.persist_purchase(businesses[1],operation,NULL,NULL,NULL,NULL,NULL,NULL);
      RAISE EXCEPTION 'BF213 unauthorized replay';
    EXCEPTION WHEN SQLSTATE '42501' THEN
      GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
      IF detail<>'ACCESS_DENIED' THEN RAISE EXCEPTION 'BF213 unsafe access signal'; END IF;
    END;
    checks := checks + 1;
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  UPDATE public.products SET is_active=true WHERE id=product_ids[1];
  UPDATE public.expense_categories SET is_active=true WHERE id=categories[1];

  FOR body IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    'null'::jsonb,'{}'::jsonb,'[]'::jsonb,'[null]'::jsonb,'[1]'::jsonb,'[{}]'::jsonb,
    jsonb_build_array(jsonb_build_object('productId','bad','quantity',1,'unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',NULL,'quantity',1,'unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',gen_random_uuid(),'quantity',1,'unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[3],'quantity',1,'unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[4],'quantity',1,'unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',0,'unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',-1,'unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1.5,'unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',2147483648::numeric,'unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity','1','unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',NULL,'unitCost','1.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost',1)),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','-1.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','NaN')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','Infinity')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','1')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','1.0')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','1.001')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','10000000000.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost',NULL)),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','1.00','total',0)),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','1.00','product_name_snapshot','Injected')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',2,'unitCost','5000000000.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','5000000000.00'),
      jsonb_build_object('productId',product_ids[2],'quantity',1,'unitCost','5000000000.00')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','1.00'),
      jsonb_build_object('productId','{'||upper(product_ids[1]::text)||'}','quantity',1,'unitCost','1.01')),
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','1.00'),
      jsonb_build_object('productId',product_ids[3],'quantity',1,'unitCost','1.00'))
  )) LOOP
    rejected_operation := gen_random_uuid();
    BEGIN
      PERFORM private.persist_purchase(businesses[1],rejected_operation,'S',categories[1],'CASH','2026-01-01Z',NULL,body);
      RAISE EXCEPTION 'BF213 accepted invalid items';
    EXCEPTION WHEN SQLSTATE '22023' THEN
      GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
      IF detail<>'INVALID_INPUT' THEN RAISE EXCEPTION 'BF213 unsafe validation signal'; END IF;
    END;
    IF EXISTS(SELECT 1 FROM public.purchases WHERE operation_id=rejected_operation) THEN
      RAISE EXCEPTION 'BF213 orphan header after invalid items';
    END IF;
    checks := checks + 1;
  END LOOP;
  valid_body := jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','1.00'));
  FOREACH supplier IN ARRAY ARRAY['','   ',NULL::text] LOOP
    BEGIN
      PERFORM private.persist_purchase(businesses[1],gen_random_uuid(),supplier,categories[1],'CASH','2026-01-01Z',NULL,valid_body);
      RAISE EXCEPTION 'BF213 empty supplier accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    checks := checks + 1;
  END LOOP;
  FOREACH actor IN ARRAY ARRAY[categories[2],categories[3],gen_random_uuid(),NULL::uuid] LOOP
    BEGIN
      PERFORM private.persist_purchase(businesses[1],gen_random_uuid(),'S',actor,'CASH','2026-01-01Z',NULL,valid_body);
      RAISE EXCEPTION 'BF213 invalid category accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    checks := checks + 1;
  END LOOP;
  FOREACH method IN ARRAY ARRAY['TRANSFER','DEBIT','CREDIT','OTHER','cash',NULL::text] LOOP
    BEGIN
      PERFORM private.persist_purchase(businesses[1],gen_random_uuid(),'S',categories[1],method,'2026-01-01Z',NULL,valid_body);
      RAISE EXCEPTION 'BF213 invalid method accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    checks := checks + 1;
  END LOOP;
  FOREACH method IN ARRAY ARRAY['infinity','-infinity',NULL::text] LOOP
    BEGIN
      PERFORM private.persist_purchase(businesses[1],gen_random_uuid(),'S',categories[1],'CASH',method::timestamptz,NULL,valid_body);
      RAISE EXCEPTION 'BF213 invalid instant accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    checks := checks + 1;
  END LOOP;
  BEGIN
    PERFORM private.persist_purchase(businesses[1],NULL,'S',categories[1],'CASH','2026-01-01Z',NULL,valid_body);
    RAISE EXCEPTION 'BF213 null operation accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  checks := checks + 1;

  -- Legacy DRAFT and missing/inconsistent history must not be auto-repaired.
  FOREACH method IN ARRAY ARRAY['DRAFT','COMPLETED'] LOOP
    rejected_operation := gen_random_uuid();
    INSERT INTO public.purchases(business_id,operation_id,supplier,status,total,created_by)
      VALUES(businesses[1],rejected_operation,'Legacy',method,1,users[1]);
    BEGIN
      PERFORM private.persist_purchase(businesses[1],rejected_operation,'S',categories[1],'CASH','2026-01-01Z',NULL,valid_body);
      RAISE EXCEPTION 'BF213 repaired incomplete legacy state';
    EXCEPTION WHEN SQLSTATE 'PT409' OR SQLSTATE '22023' THEN
      GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
      IF detail<>(CASE WHEN method='DRAFT' THEN 'INVALID_STATUS' ELSE 'INVALID_INPUT' END) THEN
        RAISE EXCEPTION 'BF213 wrong legacy signal';
      END IF;
    END;
    checks := checks + 1;
  END LOOP;
  rejected_operation := gen_random_uuid();
  BEGIN
    PERFORM private.persist_purchase(businesses[1],rejected_operation,'S',categories[1],'CASH','2026-01-01Z',NULL,valid_body);
    RAISE EXCEPTION USING ERRCODE='P0213',MESSAGE='Synthetic downstream failure';
  EXCEPTION WHEN SQLSTATE 'P0213' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.purchases WHERE operation_id=rejected_operation) THEN
    RAISE EXCEPTION 'BF213 failed rollback after successful slice';
  END IF;
  checks := checks + 1;
  rejected_operation := gen_random_uuid();
  SELECT count(*) INTO before_items FROM public.purchase_items;
  BEGIN
    PERFORM private.persist_purchase(businesses[1],rejected_operation,'S',categories[1],'CASH','2026-01-01Z',NULL,
      jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','1.00'),
        jsonb_build_object('productId',product_ids[2],'quantity',17,'unitCost','1.00')));
    RAISE EXCEPTION 'BF213 synthetic item failure did not execute';
  EXCEPTION WHEN SQLSTATE 'P0213' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.purchases WHERE operation_id=rejected_operation)
     OR (SELECT count(*) FROM public.purchase_items)<>before_items THEN
    RAISE EXCEPTION 'BF213 partial header/items after internal insertion failure';
  END IF;
  checks := checks + 1;
  IF unrelated_before IS DISTINCT FROM jsonb_build_object(
    'ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_movements t),
    'expenses',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.expenses t),
    'sales',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales t),
    'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.payments t)) THEN
    RAISE EXCEPTION 'BF213 wrote future-stage effects';
  END IF;
  checks := checks + 1;
  RAISE NOTICE 'BF213 % persistence/security/validation groups passed',checks;
END;
$$;

-- Real client roles cannot execute the private slice, even with valid claims.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM private.persist_purchase(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'BF213 authenticated EXECUTE leak';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM private.persist_purchase(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'BF213 anon EXECUTE leak';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;

BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $$ BEGIN
  -- Use the deterministic seeded OWNER identity, without modifying its rows.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',m.user_id,'role','authenticated')::text,true)
    FROM public.business_members m WHERE m.role='OWNER' AND m.is_active LIMIT 1;
  BEGIN
    PERFORM private.persist_purchase((SELECT business_id FROM public.business_members
      WHERE user_id=auth.uid() AND role='OWNER' AND is_active LIMIT 1),gen_random_uuid(),NULL,NULL,NULL,NULL,NULL,NULL);
    RAISE EXCEPTION 'BF213 accepted stale-snapshot isolation';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
END $$;
ROLLBACK;
