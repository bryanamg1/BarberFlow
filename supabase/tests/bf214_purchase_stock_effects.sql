\set ON_ERROR_STOP on
BEGIN;

-- Real-engine assertions; all fixtures and fault injection roll back below.
CREATE FUNCTION pg_temp.bf214_expect_error(b uuid, op uuid, initial boolean, state text, detail text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text; actual_detail text;
BEGIN
  BEGIN
    PERFORM private.persist_purchase_stock(b, op, initial);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,actual_detail=PG_EXCEPTION_DETAIL;
    IF actual_state=state AND actual_detail IS NOT DISTINCT FROM detail THEN RETURN; END IF;
    RAISE EXCEPTION 'BF214 wrong error: %/% expected %/%',actual_state,actual_detail,state,detail;
  END;
  RAISE EXCEPTION 'BF214 expected rejection %/%',state,detail;
END;
$$;
CREATE FUNCTION pg_temp.bf214_product_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('bf214.forbid_product_update',true)='on' THEN
    RAISE EXCEPTION 'BF214 replay attempted a product UPDATE';
  END IF;
  IF NEW.default_purchase_cost=17 THEN
    IF NOT EXISTS (SELECT 1 FROM public.stock_movements m
      WHERE m.product_id=NEW.id AND m.type='PURCHASE' AND m.unit_cost=17) THEN
      RAISE EXCEPTION 'BF214 fault did not exercise prior ledger insertion';
    END IF;
    RAISE EXCEPTION USING ERRCODE='P0214',MESSAGE='Synthetic reference-cost failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bf214_product_write BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION pg_temp.bf214_product_write();

DO $$
DECLARE
  businesses uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid()];
  users uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,6));
  ids uuid[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1,4));
  category uuid := gen_random_uuid();
  op uuid := gen_random_uuid();
  next_op uuid;
  main_purchase_id uuid;
  empty_op uuid;
  corrupt_op uuid;
  corrupt_parent uuid;
  result jsonb;
  original jsonb;
  header jsonb;
  rows_before jsonb;
  catalog_before jsonb;
  unrelated_before jsonb;
  item_before jsonb;
  actor uuid;
  role_name text;
  f record;
  m record;
  variant integer;
  checks integer := 0;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc
  WHERE oid='private.persist_purchase_stock(uuid,uuid,boolean)'::regprocedure;
  IF f.prosecdef OR f.provolatile<>'v' OR NOT f.proretset OR f.pronargs<>3 OR f.pronargdefaults<>0
     OR f.prorettype<>'public.stock_movements'::regtype OR f.proowner<>'postgres'::regrole
     OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR f.proargnames IS DISTINCT FROM ARRAY['p_business_id','p_operation_id','p_apply_initial_effects']::text[]
     OR EXISTS (SELECT 1 FROM aclexplode(f.proacl) a WHERE a.grantee<>f.proowner OR a.is_grantable)
     OR to_regprocedure('private.persist_purchase_stock(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'BF214 unsafe function signature/ACL or obsolete two-argument overload';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'BF214 exposed to %',role_name; END IF;
  END LOOP;
  -- The complete public boundary is covered by BF216, never direct ledger DML.
  IF has_table_privilege('authenticated','public.stock_movements','INSERT') THEN
    RAISE EXCEPTION 'BF214 exposed partial purchase writes';
  END IF;
  checks := checks+5;

  INSERT INTO auth.users(id) SELECT unnest(users);
  INSERT INTO public.businesses(id,name) VALUES(businesses[1],'BF214 A'),(businesses[2],'BF214 B');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (businesses[1],users[1],'OWNER',true),(businesses[1],users[2],'BARBER',true),
    (businesses[1],users[3],'OWNER',false),(businesses[2],users[4],'OWNER',true),
    (businesses[1],users[6],'OWNER',true);
  INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost,is_active) VALUES
    (ids[1],businesses[1],'Original product',20,7,true),(ids[2],businesses[1],'Second',20,9,true),
    (ids[3],businesses[2],'Foreign',1,1,true),(ids[4],businesses[1],'Archived',1,1,false);
  INSERT INTO public.expense_categories(id,business_id,name) VALUES(category,businesses[1],'BF214 category');
  SELECT jsonb_build_object(
    'expenses',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.expenses t),
    'sales',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales t),
    'sale_items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sale_items t),
    'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.payments t)) INTO unrelated_before;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);

  -- Synthetic internal NEW_OPERATION boundary: this transaction creates the
  -- parent through BF213, then supplies true. There is no public orchestrator.
  header := private.persist_purchase(businesses[1],op,'S',category,'CASH','2025-01-01Z',NULL,
    jsonb_build_array(jsonb_build_object('productId',ids[1],'quantity',3,'unitCost','0.29'),
      jsonb_build_object('productId',ids[1],'quantity',1,'unitCost','0.29'),
      jsonb_build_object('productId',ids[2],'quantity',2,'unitCost','1.01')));
  main_purchase_id := (header->'purchase'->>'id')::uuid;
  SELECT jsonb_agg(to_jsonb(i) ORDER BY id) INTO item_before FROM public.purchase_items i WHERE i.purchase_id=main_purchase_id;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.occurred_at,t.id) INTO original
  FROM private.persist_purchase_stock(businesses[1],op,true) t;
  IF jsonb_array_length(original)<>3
     OR (SELECT sum(quantity_delta) FROM public.stock_movements WHERE reference_type='PURCHASE' AND reference_id=main_purchase_id)<>6
     OR (SELECT default_purchase_cost FROM public.products WHERE id=ids[1])<>0.29
     OR (SELECT default_purchase_cost FROM public.products WHERE id=ids[2])<>1.01
     OR (SELECT sale_price FROM public.products WHERE id=ids[1])<>20
     OR (SELECT count(*) FROM public.stock_movements WHERE reference_id=main_purchase_id AND product_id=ids[1])<>2 THEN
    RAISE EXCEPTION 'BF214 first application/multiplicity/exact reference costs invalid';
  END IF;
  FOR m IN SELECT * FROM private.persist_purchase_stock(businesses[1],op,false) LOOP
    IF m.business_id<>businesses[1] OR m.type<>'PURCHASE' OR m.quantity_delta<=0
       OR m.reference_type<>'PURCHASE' OR m.reference_id<>main_purchase_id OR m.notes IS NOT NULL
       OR m.created_by<>users[1] OR m.occurred_at<>now() OR m.created_at<>now() OR m.id IS NULL
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(to_jsonb(m)) k)<>
          ARRAY['business_id','created_at','created_by','id','notes','occurred_at','product_id','quantity_delta','reference_id','reference_type','type','unit_cost'] THEN
      RAISE EXCEPTION 'BF214 movement projection/source/default timestamp invalid';
    END IF;
  END LOOP;
  checks := checks+8;
  -- True cannot be reused even against complete history; no second cost write.
  PERFORM pg_temp.bf214_expect_error(businesses[1],op,true,'22023','INVALID_INPUT');
  PERFORM pg_temp.bf214_expect_error(businesses[1],op,NULL,'22023','INVALID_INPUT');
  PERFORM pg_temp.bf214_expect_error(businesses[1],NULL,false,'22023','INVALID_INPUT');
  PERFORM pg_temp.bf214_expect_error(businesses[1],gen_random_uuid(),false,'22023','INVALID_INPUT');
  checks := checks+4;

  -- Current catalog changes and a later application must not reprice history.
  UPDATE public.products SET name='Changed',sale_price=99 WHERE id=ids[1];
  next_op := gen_random_uuid();
  PERFORM private.persist_purchase(businesses[1],next_op,'S',category,'CASH','2020-01-01Z',NULL,
    jsonb_build_array(jsonb_build_object('productId',ids[1],'quantity',1,'unitCost','2.50')));
  PERFORM private.persist_purchase_stock(businesses[1],next_op,true);
  IF (SELECT default_purchase_cost FROM public.products WHERE id=ids[1])<>2.50 THEN
    RAISE EXCEPTION 'BF214 incorrectly used purchased_at precedence';
  END IF;
  UPDATE public.products SET is_active=false WHERE id=ids[1];
  SELECT jsonb_agg(to_jsonb(p) ORDER BY id) INTO catalog_before FROM public.products p;
  PERFORM set_config('bf214.forbid_product_update','on',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[6],'role','authenticated')::text,true);
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.occurred_at,t.id) INTO result
  FROM private.persist_purchase_stock(businesses[1],op,false) t;
  IF result IS DISTINCT FROM original OR catalog_before IS DISTINCT FROM
     (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.products p)
     OR item_before IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(i) ORDER BY id)
       FROM public.purchase_items i WHERE i.purchase_id=main_purchase_id) THEN
    RAISE EXCEPTION 'BF214 replay changed original rows/cost/snapshots';
  END IF;
  UPDATE public.purchases SET status='VOIDED' WHERE id=main_purchase_id;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.occurred_at,t.id) INTO result
  FROM private.persist_purchase_stock(businesses[1],op,false) t;
  IF result IS DISTINCT FROM original THEN RAISE EXCEPTION 'BF214 VOIDED replay changed rows'; END IF;
  PERFORM pg_temp.bf214_expect_error(businesses[1],op,true,'PT409','INVALID_STATUS');
  PERFORM set_config('bf214.forbid_product_update','off',true);
  UPDATE public.products SET is_active=true WHERE id=ids[1];
  checks := checks+5;

  -- Distinct large duplicate lines remain int4 each, with bigint derived stock.
  next_op := gen_random_uuid();
  PERFORM private.persist_purchase(businesses[1],next_op,'S',category,'CASH','2026-01-01Z',NULL,
    jsonb_build_array(jsonb_build_object('productId',ids[2],'quantity',2147483647,'unitCost','0.00'),
      jsonb_build_object('productId',ids[2],'quantity',2147483647,'unitCost','0.00')));
  SELECT jsonb_agg(to_jsonb(t)) INTO result FROM private.persist_purchase_stock(businesses[1],next_op,true) t;
  IF jsonb_array_length(result)<>2 OR (SELECT sum((x->>'quantity_delta')::bigint)
      FROM jsonb_array_elements(result) x)<>4294967294
     OR (SELECT default_purchase_cost FROM public.products WHERE id=ids[2])<>0 THEN
    RAISE EXCEPTION 'BF214 aggregated duplicate int4 deltas or rejected zero cost';
  END IF;
  next_op := gen_random_uuid();
  PERFORM private.persist_purchase(businesses[1],next_op,'S',category,'CASH','2026-01-01Z',NULL,
    jsonb_build_array(jsonb_build_object('productId',ids[2],'quantity',1,'unitCost','9999999999.99')));
  PERFORM private.persist_purchase_stock(businesses[1],next_op,true);
  IF (SELECT default_purchase_cost FROM public.products WHERE id=ids[2])<>9999999999.99 THEN
    RAISE EXCEPTION 'BF214 max cost lost precision';
  END IF;
  checks := checks+2;

  -- Missing effects are never inferred to be a new operation, even before commit.
  empty_op := gen_random_uuid();
  header := private.persist_purchase(businesses[1],empty_op,'S',category,'CASH','2026-01-01Z',NULL,
    jsonb_build_array(jsonb_build_object('productId',ids[1],'quantity',1,'unitCost','3.00')));
  PERFORM pg_temp.bf214_expect_error(businesses[1],empty_op,false,'22023','INVALID_INPUT');
  UPDATE public.purchases SET status='VOIDED' WHERE operation_id=empty_op AND business_id=businesses[1];
  PERFORM pg_temp.bf214_expect_error(businesses[1],empty_op,false,'22023','INVALID_INPUT');
  PERFORM pg_temp.bf214_expect_error(businesses[1],empty_op,true,'PT409','INVALID_STATUS');
  UPDATE public.purchases SET status='DRAFT' WHERE operation_id=empty_op AND business_id=businesses[1];
  PERFORM pg_temp.bf214_expect_error(businesses[1],empty_op,false,'PT409','INVALID_STATUS');
  UPDATE public.purchases SET status='COMPLETED' WHERE operation_id=empty_op AND business_id=businesses[1];
  UPDATE public.products SET is_active=false WHERE id=ids[1];
  PERFORM pg_temp.bf214_expect_error(businesses[1],empty_op,true,'22023','INVALID_INPUT');
  UPDATE public.products SET is_active=true WHERE id=ids[1];
  checks := checks+5;

  -- Manufacture legacy inconsistent sets using inserts only; never disable the
  -- append-only trigger or rewrite a movement to construct the test case.
  FOR variant IN 1..7 LOOP
    corrupt_op := gen_random_uuid();
    header := private.persist_purchase(businesses[1],corrupt_op,'S',category,'CASH','2026-01-01Z',NULL,
      jsonb_build_array(jsonb_build_object('productId',ids[1],'quantity',1,'unitCost','3.00'),
        jsonb_build_object('productId',ids[1],'quantity',1,'unitCost','3.00')));
    corrupt_parent := (header->'purchase'->>'id')::uuid;
    INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
    SELECT CASE WHEN variant=7 THEN businesses[2] ELSE businesses[1] END,
      CASE WHEN variant=4 THEN ids[2] ELSE ids[1] END,
      CASE WHEN variant=6 THEN 'ADJUSTMENT' ELSE 'PURCHASE' END,
      CASE WHEN variant=3 THEN 2 ELSE 1 END,
      CASE WHEN variant=5 THEN 4 ELSE 3 END,'PURCHASE',corrupt_parent,users[1]
    FROM generate_series(1,CASE WHEN variant=1 THEN 1 WHEN variant=2 THEN 3 ELSE 2 END);
    SELECT jsonb_agg(to_jsonb(t) ORDER BY id) INTO rows_before FROM public.stock_movements t WHERE reference_id=corrupt_parent;
    PERFORM pg_temp.bf214_expect_error(businesses[1],corrupt_op,false,'22023','INVALID_INPUT');
    PERFORM pg_temp.bf214_expect_error(businesses[1],corrupt_op,true,'22023','INVALID_INPUT');
    IF rows_before IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_movements t
      WHERE reference_id=corrupt_parent) THEN RAISE EXCEPTION 'BF214 repaired inconsistent history'; END IF;
    checks := checks+3;
  END LOOP;

  -- Parent/total/item tenant and duplicate-cost inconsistencies reject safely.
  FOR variant IN 1..4 LOOP
    corrupt_op := gen_random_uuid();
    INSERT INTO public.purchases(business_id,operation_id,supplier,status,total,created_by)
      VALUES(businesses[1],corrupt_op,'Legacy','COMPLETED',CASE WHEN variant=2 THEN 9 ELSE 6 END,users[1])
      RETURNING id INTO corrupt_parent;
    IF variant<>1 THEN
      INSERT INTO public.purchase_items(purchase_id,product_id,product_name_snapshot,quantity,unit_cost_snapshot,line_total)
      VALUES(corrupt_parent,CASE WHEN variant=3 THEN ids[3] ELSE ids[1] END,'Legacy',1,3,3),
        (corrupt_parent,ids[1],'Legacy',1,CASE WHEN variant=4 THEN 4 ELSE 3 END,CASE WHEN variant=4 THEN 4 ELSE 3 END);
      IF variant=4 THEN UPDATE public.purchases SET total=7 WHERE id=corrupt_parent; END IF;
    END IF;
    PERFORM pg_temp.bf214_expect_error(businesses[1],corrupt_op,true,'22023','INVALID_INPUT');
    PERFORM pg_temp.bf214_expect_error(businesses[1],corrupt_op,false,'22023','INVALID_INPUT');
    checks := checks+2;
  END LOOP;

  -- Fault after ledger insertion: the combined parent/items/stock/cost attempt
  -- rolls back as a unit, just as a future later-stage error must do.
  next_op := gen_random_uuid();
  SELECT to_jsonb(p) INTO catalog_before FROM public.products p WHERE id=ids[1];
  BEGIN
    PERFORM private.persist_purchase(businesses[1],next_op,'S',category,'CASH','2026-01-01Z',NULL,
      jsonb_build_array(jsonb_build_object('productId',ids[1],'quantity',2,'unitCost','17.00')));
    PERFORM private.persist_purchase_stock(businesses[1],next_op,true);
    RAISE EXCEPTION 'BF214 missed fault';
  EXCEPTION WHEN SQLSTATE 'P0214' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.purchases WHERE business_id=businesses[1] AND operation_id=next_op)
     OR EXISTS(SELECT 1 FROM public.stock_movements WHERE product_id=ids[1] AND unit_cost=17)
     OR catalog_before IS DISTINCT FROM (SELECT to_jsonb(p) FROM public.products p WHERE id=ids[1]) THEN
    RAISE EXCEPTION 'BF214 partial writes survived cost failure';
  END IF;
  next_op := gen_random_uuid();
  BEGIN
    PERFORM private.persist_purchase(businesses[1],next_op,'S',category,'CASH','2026-01-01Z',NULL,
      jsonb_build_array(jsonb_build_object('productId',ids[1],'quantity',2,'unitCost','4.00')));
    PERFORM private.persist_purchase_stock(businesses[1],next_op,true);
    RAISE EXCEPTION USING ERRCODE='P0215',MESSAGE='Synthetic later-stage failure';
  EXCEPTION WHEN SQLSTATE 'P0215' THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM public.purchases WHERE business_id=businesses[1] AND operation_id=next_op)
     OR catalog_before IS DISTINCT FROM (SELECT to_jsonb(p) FROM public.products p WHERE id=ids[1]) THEN
    RAISE EXCEPTION 'BF214 later failure left effects';
  END IF;
  checks := checks+2;

  FOREACH actor IN ARRAY ARRAY[users[2],users[3],users[4],users[5],NULL::uuid] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    PERFORM pg_temp.bf214_expect_error(businesses[1],op,false,'42501','ACCESS_DENIED');
    PERFORM pg_temp.bf214_expect_error(businesses[1],empty_op,true,'42501','ACCESS_DENIED');
    checks := checks+2;
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  PERFORM pg_temp.bf214_expect_error(businesses[2],op,false,'42501','ACCESS_DENIED');
  PERFORM pg_temp.bf214_expect_error(businesses[1],gen_random_uuid(),true,'22023','INVALID_INPUT');
  -- A caller authorized in both businesses still cannot cross-resolve the op.
  INSERT INTO public.business_members(business_id,user_id,role) VALUES(businesses[2],users[1],'OWNER');
  INSERT INTO public.purchases(business_id,operation_id,supplier,status,total,created_by)
    VALUES(businesses[2],gen_random_uuid(),'Foreign','COMPLETED',0,users[4]) RETURNING operation_id INTO next_op;
  PERFORM pg_temp.bf214_expect_error(businesses[1],next_op,false,'22023','INVALID_INPUT');
  checks := checks+3;

  -- Effective client roles cannot forge the private NEW_OPERATION flag.
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',role_name);
    BEGIN
      PERFORM private.persist_purchase_stock(businesses[1],empty_op,true);
      RAISE EXCEPTION 'BF214 client forged initial signal';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
    checks := checks+1;
  END LOOP;
  BEGIN
    UPDATE public.stock_movements SET notes='forbidden' WHERE reference_id=main_purchase_id;
    RAISE EXCEPTION 'BF214 ledger UPDATE allowed';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.stock_movements WHERE reference_id=main_purchase_id;
    RAISE EXCEPTION 'BF214 ledger DELETE allowed';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF unrelated_before IS DISTINCT FROM jsonb_build_object(
    'expenses',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.expenses t),
    'sales',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales t),
    'sale_items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sale_items t),
    'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.payments t)) THEN
    RAISE EXCEPTION 'BF214 modified unrelated financial history';
  END IF;
  checks := checks+3;
  RAISE NOTICE 'BF214 % verification groups PASS',checks;
END;
$$;
ROLLBACK;
