\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.bf216_call(b uuid,op uuid,c uuid,p uuid,cost text DEFAULT '0.29',qty integer DEFAULT 3,
  method text DEFAULT 'BANK_TRANSFER',note text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.complete_purchase(b,op,'  Original supplier  ',c,method,'2026-01-01T01:30Z',note,
    jsonb_build_array(jsonb_build_object('productId',p,'quantity',qty,'unitCost',cost)))
$$;
CREATE FUNCTION pg_temp.bf216_error(b uuid,op uuid,c uuid,p uuid,state text DEFAULT '22023',detail text DEFAULT 'INVALID_INPUT')
RETURNS void LANGUAGE plpgsql AS $$ DECLARE s text;d text; BEGIN
  BEGIN PERFORM pg_temp.bf216_call(b,op,c,p);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS s=RETURNED_SQLSTATE,d=PG_EXCEPTION_DETAIL;
    IF s=state AND d IS NOT DISTINCT FROM detail THEN RETURN;END IF;
    RAISE EXCEPTION 'BF216 wrong signal %/% expected %/%',s,d,state,detail;
  END;
  RAISE EXCEPTION 'BF216 expected rejection';
END $$;
CREATE FUNCTION pg_temp.bf216_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF current_setting('bf216.fail_stage',true)=TG_TABLE_NAME THEN
    IF TG_TABLE_NAME='expenses' THEN
      IF NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_id=NEW.purchase_id)
        OR NOT EXISTS(SELECT 1 FROM public.purchase_items i JOIN public.products p ON p.id=i.product_id
          WHERE i.purchase_id=NEW.purchase_id AND p.default_purchase_cost=i.unit_cost_snapshot) THEN
        RAISE EXCEPTION 'BF216 expense fault did not follow stock/cost';END IF;
    END IF;
    RAISE EXCEPTION USING ERRCODE='P0216',MESSAGE='Synthetic stage failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bf216_fault BEFORE INSERT ON public.purchase_items FOR EACH ROW EXECUTE FUNCTION pg_temp.bf216_fault();
CREATE TRIGGER bf216_fault BEFORE INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION pg_temp.bf216_fault();
CREATE TRIGGER bf216_fault BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION pg_temp.bf216_fault();
-- Hostile caller names must not redirect a definer's reads or writes.
CREATE TEMP TABLE purchases(id uuid);
CREATE TEMP TABLE products(id uuid,default_purchase_cost numeric);

DO $$
DECLARE
  biz uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid()];
  users uuid[]:=ARRAY(SELECT gen_random_uuid() FROM generate_series(1,5));
  product_ids uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  cats uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid()];
  op uuid;parent uuid;first_op uuid:=gen_random_uuid();original jsonb;result jsonb;before_cost numeric;
  method text;stage text;r text;f record;affected integer;variant integer;checks integer:=0;
  before_counts bigint[];after_counts bigint[];
BEGIN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.complete_purchase(uuid,uuid,text,uuid,text,timestamptz,text,jsonb)'::regprocedure;
  IF NOT f.prosecdef OR f.provolatile<>'v' OR f.proretset OR f.pronargs<>8 OR f.pronargdefaults<>0
    OR f.prorettype<>'jsonb'::regtype OR f.proowner<>'postgres'::regrole
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR f.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_supplier','p_expense_category_id',
      'p_payment_method','p_purchased_at','p_notes','p_items']::text[]
    OR EXISTS(SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee NOT IN(f.proowner,'authenticated'::regrole) OR a.is_grantable)
    OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE') THEN RAISE EXCEPTION 'BF216 unsafe public contract';END IF;
  FOREACH r IN ARRAY ARRAY['anon','service_role'] LOOP
    IF has_function_privilege(r,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'BF216 excessive public EXECUTE';END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['private.persist_purchase(uuid,uuid,text,uuid,text,timestamptz,text,jsonb)',
    'private.persist_purchase_stock(uuid,uuid,boolean)','private.persist_purchase_expense(uuid,uuid,boolean)'] LOOP
    IF has_function_privilege('authenticated',r,'EXECUTE') OR has_function_privilege('anon',r,'EXECUTE')
      OR has_function_privilege('service_role',r,'EXECUTE') THEN RAISE EXCEPTION 'BF216 private helper exposed';END IF;
  END LOOP;
  checks:=checks+6;
  INSERT INTO auth.users(id) SELECT unnest(users);
  INSERT INTO public.businesses(id,name,timezone) VALUES(biz[1],'BF216 A','America/Argentina/Buenos_Aires'),(biz[2],'BF216 B','UTC');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (biz[1],users[1],'OWNER',true),(biz[1],users[2],'BARBER',true),(biz[1],users[3],'OWNER',false),
    (biz[2],users[4],'OWNER',true),(biz[1],users[5],'OWNER',true);
  INSERT INTO public.expense_categories(id,business_id,name) VALUES(cats[1],biz[1],'A'),(cats[2],biz[2],'B');
  INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost) VALUES
    (product_ids[1],biz[1],'Original product',20,7),(product_ids[2],biz[1],'Second product',20,9),
    (product_ids[3],biz[2],'Foreign product',20,9);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  PERFORM set_config('search_path','pg_temp,public',true);
  original:=pg_temp.bf216_call(biz[1],first_op,cats[1],product_ids[1],'0.29',3,'BANK_TRANSFER','  notes  ');
  parent:=(original->'purchase'->>'id')::uuid;
  IF (SELECT count(*) FROM jsonb_object_keys(original))<>3 OR (SELECT count(*) FROM jsonb_object_keys(original->'purchase'))<>11
    OR (SELECT count(*) FROM jsonb_object_keys(original->'items'->0))<>8 OR (SELECT count(*) FROM jsonb_object_keys(original->'expense'))<>14
    OR original->'purchase'->>'supplier'<>'  Original supplier  ' OR original->'purchase'->>'status'<>'COMPLETED'
    OR (original->'purchase'->>'total')::numeric<>0.87 OR original->'expense'->>'expense_date'<>'2025-12-31'
    OR original->'expense'->>'notes'<>'  notes  ' OR original->'expense'->>'receipt_path' IS NOT NULL
    OR original->'expense'->>'purchase_id'<>parent::text THEN RAISE EXCEPTION 'BF216 wrong final result';END IF;
  IF (SELECT count(*) FROM public.stock_movements WHERE reference_id=parent)<>1
    OR (SELECT default_purchase_cost FROM public.products WHERE id=product_ids[1])<>0.29 THEN RAISE EXCEPTION 'BF216 missing integrated effects';END IF;
  checks:=checks+7;
  PERFORM pg_temp.bf216_error(biz[1],gen_random_uuid(),cats[2],product_ids[1]);
  PERFORM pg_temp.bf216_error(biz[1],gen_random_uuid(),cats[1],product_ids[3]);checks:=checks+2;
  -- Different valid payload and a different authorized OWNER return original history.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[5],'role','authenticated')::text,true);
  result:=public.complete_purchase(biz[1],first_op,'Different',cats[2],'CASH','2020-01-01Z','Different',
    jsonb_build_array(jsonb_build_object('productId',product_ids[2],'quantity',1,'unitCost','8.00')));
  IF result IS DISTINCT FROM original THEN RAISE EXCEPTION 'BF216 replay changed history';END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  FOREACH method IN ARRAY ARRAY['CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET'] LOOP
    result:=pg_temp.bf216_call(biz[1],gen_random_uuid(),cats[1],product_ids[2],'0.00',1,method);
    IF result->'expense'->>'payment_method'<>method OR (result->'expense'->>'amount')::numeric<>0 THEN
      RAISE EXCEPTION 'BF216 zero-cost/method failure';END IF;checks:=checks+1;
  END LOOP;
  op:=gen_random_uuid();
  result:=public.complete_purchase(biz[1],op,'Multi',cats[1],'CASH','2026-01-01Z',NULL,
    jsonb_build_array(jsonb_build_object('productId',product_ids[2],'quantity',2,'unitCost','1.01'),
      jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','0.29'),
      jsonb_build_object('productId',product_ids[1],'quantity',2,'unitCost','0.29')));
  IF jsonb_array_length(result->'items')<>3 OR (result->'purchase'->>'total')::numeric<>2.89
    OR (SELECT count(*) FROM public.stock_movements WHERE reference_id=(result->'purchase'->>'id')::uuid)<>3 THEN
    RAISE EXCEPTION 'BF216 duplicate/multiple lines collapsed';END IF;checks:=checks+3;
  -- Existing MANUAL insert/update stays allowed, generated expense direct update stays denied.
  INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by)
    VALUES(biz[1],cats[1],'MANUAL','Manual',1,'CASH',DATE '2026-01-01',users[1]);
  UPDATE public.expenses SET amount=2 WHERE business_id=biz[1] AND source_type='MANUAL';
  GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'BF216 broke manual writes';END IF;
  UPDATE public.expenses SET amount=2 WHERE purchase_id=(original->'purchase'->>'id')::uuid;
  GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>0 THEN RAISE EXCEPTION 'BF216 exposed generated expense update';END IF;
  FOREACH r IN ARRAY ARRAY['purchases','purchase_items','stock_movements'] LOOP
    BEGIN EXECUTE format('UPDATE public.%I SET id=id WHERE false',r);RAISE EXCEPTION 'BF216 direct UPDATE exposed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;END;
    BEGIN EXECUTE format('INSERT INTO public.%I DEFAULT VALUES',r);RAISE EXCEPTION 'BF216 direct INSERT exposed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;END;
    checks:=checks+2;
  END LOOP;
  BEGIN
    INSERT INTO public.expenses(business_id,category_id,source_type,purchase_id,description,amount,payment_method,expense_date,created_by)
      VALUES(biz[1],cats[1],'PURCHASE',(original->'purchase'->>'id')::uuid,'Denied',1,'CASH',DATE '2026-01-01',users[1]);
    RAISE EXCEPTION 'BF216 direct generated expense insert exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;checks:=checks+3;
  -- Role and tenant denials through the actual definer entry point.
  FOR variant IN 2..4 LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[variant],'role','authenticated')::text,true);
    PERFORM pg_temp.bf216_error(biz[1],gen_random_uuid(),cats[1],product_ids[1],'42501','ACCESS_DENIED');checks:=checks+1;
  END LOOP;
  PERFORM set_config('request.jwt.claims','{}',true);
  PERFORM pg_temp.bf216_error(biz[1],gen_random_uuid(),cats[1],product_ids[1],'42501','ACCESS_DENIED');checks:=checks+1;
  PERFORM set_config('role','anon',true);
  BEGIN PERFORM pg_temp.bf216_call(biz[1],gen_random_uuid(),cats[1],product_ids[1]);RAISE EXCEPTION 'BF216 anon exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;checks:=checks+1;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);

  -- Catalog edits/TZ changes do not rewrite historical result or current cost.
  UPDATE public.businesses SET timezone='Not/A_Zone' WHERE id=biz[1];
  UPDATE public.products SET name='Changed',default_purchase_cost=42,is_active=false WHERE id=product_ids[1];
  UPDATE public.expense_categories SET is_active=false WHERE id=cats[1];
  result:=pg_temp.bf216_call(biz[1],first_op,cats[1],product_ids[1]);
  IF result IS DISTINCT FROM original OR (SELECT default_purchase_cost FROM public.products WHERE id=product_ids[1])<>42 THEN
    RAISE EXCEPTION 'BF216 replay recalculated history/cost';END IF;
  UPDATE public.purchases SET status='VOIDED' WHERE id=(original->'purchase'->>'id')::uuid;
  original:=jsonb_set(original,'{purchase,status}','"VOIDED"');
  -- updated_at is server managed by the existing trigger; preserve that persisted value on replay.
  original:=jsonb_set(original,'{purchase,updated_at}',to_jsonb((SELECT updated_at FROM public.purchases WHERE id=(original->'purchase'->>'id')::uuid)));
  IF pg_temp.bf216_call(biz[1],first_op,cats[1],product_ids[1]) IS DISTINCT FROM original THEN RAISE EXCEPTION 'BF216 VOIDED replay failed';END IF;
  UPDATE public.businesses SET timezone='UTC' WHERE id=biz[1];
  UPDATE public.products SET is_active=true WHERE id=product_ids[1];
  UPDATE public.expense_categories SET is_active=true WHERE id=cats[1];checks:=checks+3;

  -- Full rollback even when earlier stages have already produced effects.
  FOREACH stage IN ARRAY ARRAY['purchase_items','stock_movements','expenses'] LOOP
    SELECT default_purchase_cost INTO before_cost FROM public.products WHERE id=product_ids[1];
    SELECT ARRAY[(SELECT count(*) FROM public.purchases WHERE business_id=biz[1]),
      (SELECT count(*) FROM public.purchase_items i JOIN public.purchases p ON p.id=i.purchase_id WHERE p.business_id=biz[1]),
      (SELECT count(*) FROM public.stock_movements WHERE business_id=biz[1]),
      (SELECT count(*) FROM public.expenses WHERE business_id=biz[1])] INTO before_counts;
    op:=gen_random_uuid();PERFORM set_config('bf216.fail_stage',stage,true);
    PERFORM pg_temp.bf216_error(biz[1],op,cats[1],product_ids[1],'P0216','');
    PERFORM set_config('bf216.fail_stage','',true);
    SELECT ARRAY[(SELECT count(*) FROM public.purchases WHERE business_id=biz[1]),
      (SELECT count(*) FROM public.purchase_items i JOIN public.purchases p ON p.id=i.purchase_id WHERE p.business_id=biz[1]),
      (SELECT count(*) FROM public.stock_movements WHERE business_id=biz[1]),
      (SELECT count(*) FROM public.expenses WHERE business_id=biz[1])] INTO after_counts;
    IF EXISTS(SELECT 1 FROM public.purchases WHERE business_id=biz[1] AND operation_id=op)
      OR after_counts IS DISTINCT FROM before_counts
      OR (SELECT default_purchase_cost FROM public.products WHERE id=product_ids[1]) IS DISTINCT FROM before_cost THEN
      RAISE EXCEPTION 'BF216 stage rollback failed';END IF;
    -- Same operation key becomes genuinely NEW after the aborted statement.
    result:=pg_temp.bf216_call(biz[1],op,cats[1],product_ids[1]);
    IF result->'expense'->>'id' IS NULL THEN RAISE EXCEPTION 'BF216 retry after rollback failed';END IF;checks:=checks+3;
  END LOOP;
  -- Test-owned corruption only; never repair existing partial history on replay.
  FOR variant IN 1..12 LOOP
    op:=gen_random_uuid();
    result:=private.persist_purchase(biz[1],op,'Partial',cats[1],'CASH','2026-01-01Z',NULL,
      jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',3,'unitCost','0.29')));
    parent:=(result->'purchase'->>'id')::uuid;
    IF variant<>1 THEN PERFORM private.persist_purchase_stock(biz[1],op,true);END IF;
    IF variant>=3 THEN PERFORM private.persist_purchase_expense(biz[1],op,true);END IF;
    CASE variant
      WHEN 1 THEN NULL;
      WHEN 2 THEN NULL;
      WHEN 3 THEN DELETE FROM public.purchase_items WHERE purchase_id=parent;
      WHEN 4 THEN UPDATE public.purchases SET expense_category_id=NULL WHERE id=parent;
      WHEN 5 THEN INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,reference_type,reference_id,created_by)
        VALUES(biz[1],product_ids[1],'PURCHASE',1,'PURCHASE',parent,users[1]);
      WHEN 6 THEN UPDATE public.expenses SET amount=1 WHERE purchase_id=parent;
      WHEN 7 THEN UPDATE public.purchases SET total=1 WHERE id=parent;
      WHEN 8 THEN UPDATE public.expenses SET category_id=cats[2] WHERE purchase_id=parent;
      WHEN 9 THEN UPDATE public.purchases SET status='DRAFT' WHERE id=parent;
      WHEN 10 THEN UPDATE public.purchases SET status='VOIDED' WHERE id=parent;DELETE FROM public.expenses WHERE purchase_id=parent;
      WHEN 11 THEN UPDATE public.purchases SET payment_method=NULL WHERE id=parent;
      WHEN 12 THEN DELETE FROM public.expenses WHERE purchase_id=parent;
    END CASE;
    PERFORM pg_temp.bf216_error(biz[1],op,cats[1],product_ids[1],
      CASE WHEN variant=9 THEN 'PT409' ELSE '22023' END,CASE WHEN variant=9 THEN 'INVALID_STATUS' ELSE 'INVALID_INPUT' END);
    checks:=checks+1;
  END LOOP;
  -- Nonzero partial multiset: one movement cannot witness two duplicate items.
  op:=gen_random_uuid();
  result:=private.persist_purchase(biz[1],op,'Partial set',cats[1],'CASH','2026-01-01Z',NULL,
    jsonb_build_array(jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','0.29'),
      jsonb_build_object('productId',product_ids[1],'quantity',1,'unitCost','0.29')));
  parent:=(result->'purchase'->>'id')::uuid;
  INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
    VALUES(biz[1],product_ids[1],'PURCHASE',1,0.29,'PURCHASE',parent,users[1]);
  PERFORM pg_temp.bf216_error(biz[1],op,cats[1],product_ids[1]);checks:=checks+1;
  RAISE NOTICE 'BF216 passed % integrated SQL/security/rollback verification groups',checks;
END $$;
ROLLBACK;
