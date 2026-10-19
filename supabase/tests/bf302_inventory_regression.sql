\set ON_ERROR_STOP on
-- Cross-writer regression on the real local engine. Every helper, trigger and
-- synthetic row below is transaction-local and disappears at ROLLBACK.
BEGIN;

CREATE FUNCTION pg_temp.bf302_assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'BF302 %',label; END IF;
END $$;
CREATE FUNCTION pg_temp.bf302_error(statement text, expected text, expected_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$ DECLARE code text; detail text; BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE,detail=PG_EXCEPTION_DETAIL;
  END;
  PERFORM pg_temp.bf302_assert(code=expected AND
    (expected_detail IS NULL OR detail=expected_detail),format('expected %s/%s got %s/%s',expected,expected_detail,code,detail));
END $$;
CREATE FUNCTION pg_temp.bf302_stock(b uuid, p uuid, expected bigint)
RETURNS void LANGUAGE plpgsql AS $$ DECLARE balance bigint; exposed text; BEGIN
  SELECT coalesce(sum(quantity_delta),0) INTO balance FROM public.stock_movements
    WHERE business_id=b AND product_id=p;
  SELECT current_stock INTO STRICT exposed FROM public.get_product_stock(b,ARRAY[p]);
  PERFORM pg_temp.bf302_assert(balance=expected AND exposed=expected::text AND balance>=0,
    format('ledger/RPC/expected differ: %s/%s/%s',balance,exposed,expected));
END $$;
CREATE FUNCTION pg_temp.bf302_low(b uuid,p uuid,expected boolean)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM pg_temp.bf302_assert(EXISTS(SELECT 1 FROM public.get_low_stock_products(b,1,100) x
    WHERE x.product_id=p)=expected,'low-stock classification');
END $$;
CREATE FUNCTION pg_temp.bf302_buy(b uuid,c uuid,op uuid,items jsonb,at_time timestamptz DEFAULT '2026-01-01T12:00Z')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.complete_purchase(b,op,'BF302 supplier',c,'CASH',at_time,'original',items);
$$;
CREATE FUNCTION pg_temp.bf302_line(p uuid,q integer,cost text DEFAULT '10.00')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('productId',p,'quantity',q,'unitCost',cost);
$$;
-- Uses the existing private SALE stages on ONE connection/transaction. This is
-- test orchestration, not a new public checkout endpoint or a privilege grant.
CREATE FUNCTION pg_temp.bf302_sale(b uuid,op uuid,products uuid[],quantities integer[])
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE s public.sales%ROWTYPE; items jsonb; BEGIN
  s:=private.persist_checkout_sale(b,op,NULL,NULL,0,0,0);
  PERFORM private.lock_checkout_products(b,products,quantities);
  SELECT jsonb_agg(jsonb_build_object('itemType','PRODUCT','itemId',p,'quantity',q,'unitPriceOverride','0.00') ORDER BY n)
    INTO items FROM unnest(products,quantities) WITH ORDINALITY x(p,q,n);
  PERFORM private.persist_checkout_items(b,op,items);
  PERFORM private.persist_checkout_payment(b,op,'CASH');
  PERFORM private.persist_checkout_stock(b,op);
  RETURN s.id;
END $$;
CREATE FUNCTION pg_temp.bf302_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF current_setting('bf302.fail',true)=TG_TABLE_NAME THEN
    RAISE EXCEPTION USING ERRCODE='P0302',MESSAGE='BF302 deliberate late-stage fault';
  END IF;
  IF TG_TABLE_NAME='stock_movements' THEN
    IF current_setting('bf302.fail',true)=NEW.product_id::text THEN
      RAISE EXCEPTION USING ERRCODE='P0302',MESSAGE='BF302 deliberate second-line fault';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bf302_fault BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION pg_temp.bf302_fault();
CREATE TRIGGER bf302_fault BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION pg_temp.bf302_fault();

DO $$ DECLARE
  b uuid:='bf302000-0000-4000-8000-000000000001';
  foreign_b uuid:='bf302000-0000-4000-8000-000000000002';
  category uuid:='bf302000-0000-4000-8000-000000000003';
  users uuid[]:=ARRAY(SELECT ('bf302000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(10,14) n);
  p uuid[]:=ARRAY(SELECT ('bf302000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(101,111) n);
  a jsonb; z jsonb; v jsonb; before_rows jsonb; sid uuid; sale_row public.sales%ROWTYPE;
  op uuid; void_op uuid; original_op uuid; n integer;
  count_before bigint; groups integer:=0; purchase_id uuid;
BEGIN
  INSERT INTO auth.users(id) SELECT unnest(users);
  INSERT INTO public.businesses(id,name,timezone) VALUES(b,'BF302 A','UTC'),(foreign_b,'BF302 B','UTC');
  INSERT INTO public.business_members(business_id,user_id,role,is_active) VALUES
    (b,users[1],'OWNER',true),(b,users[2],'BARBER',true),(b,users[3],'OWNER',false),
    (foreign_b,users[4],'OWNER',true);
  INSERT INTO public.expense_categories(id,business_id,name) VALUES(category,b,'BF302 category');
  INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost,minimum_stock)
    SELECT id,CASE WHEN id=p[11] THEN foreign_b ELSE b END,'BF302 '||id,0,7,5 FROM unnest(p) id;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;

  PERFORM pg_temp.bf302_stock(b,p[1],0);
  PERFORM pg_temp.bf302_low(b,p[1],true);
  a:=pg_temp.bf302_buy(b,category,gen_random_uuid(),jsonb_build_array(pg_temp.bf302_line(p[1],10)));
  PERFORM pg_temp.bf302_stock(b,p[1],10);
  PERFORM pg_temp.bf302_low(b,p[1],false);
  SET LOCAL ROLE postgres;
  sid:=pg_temp.bf302_sale(b,gen_random_uuid(),ARRAY[p[1]],ARRAY[3]);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bf302_stock(b,p[1],7);
  PERFORM public.adjust_stock(b,gen_random_uuid(),p[1],2,'ADJUSTMENT',NULL);
  PERFORM pg_temp.bf302_stock(b,p[1],9);
  PERFORM public.adjust_stock(b,gen_random_uuid(),p[1],-1,'LOSS',NULL);
  PERFORM pg_temp.bf302_stock(b,p[1],8);
  PERFORM pg_temp.bf302_assert((SELECT array_agg(type ORDER BY type) FROM public.stock_movements WHERE product_id=p[1])
    =ARRAY['ADJUSTMENT','LOSS','PURCHASE','SALE'],'mixed +10-3+2-1 movement history');
  groups:=groups+1;

  -- Observe transitions across the threshold after each actual writer, including
  -- the existing void compensation (not a fabricated inventory cache).
  a:=pg_temp.bf302_buy(b,category,gen_random_uuid(),jsonb_build_array(pg_temp.bf302_line(p[7],6)));
  PERFORM pg_temp.bf302_stock(b,p[7],6);
  PERFORM pg_temp.bf302_low(b,p[7],false);
  PERFORM public.void_purchase(b,gen_random_uuid(),(a->'purchase'->>'id')::uuid,'threshold');
  PERFORM pg_temp.bf302_stock(b,p[7],0);
  PERFORM pg_temp.bf302_low(b,p[7],true);
  PERFORM public.adjust_stock(b,gen_random_uuid(),p[7],6,'ADJUSTMENT',NULL);
  PERFORM pg_temp.bf302_low(b,p[7],false);
  PERFORM public.adjust_stock(b,gen_random_uuid(),p[7],-1,'LOSS',NULL);
  PERFORM pg_temp.bf302_stock(b,p[7],5);
  PERFORM pg_temp.bf302_low(b,p[7],true);
  PERFORM public.adjust_stock(b,gen_random_uuid(),p[7],-1,'ADJUSTMENT',NULL);
  PERFORM pg_temp.bf302_stock(b,p[7],4);
  PERFORM pg_temp.bf302_low(b,p[7],true);
  groups:=groups+1;

  -- Duplicate purchase lines remain two distinct stock facts, at an exact threshold.
  original_op:=gen_random_uuid();
  a:=pg_temp.bf302_buy(b,category,original_op,jsonb_build_array(
    pg_temp.bf302_line(p[2],2),pg_temp.bf302_line(p[2],3)));
  purchase_id:=(a->'purchase'->>'id')::uuid;
  PERFORM pg_temp.bf302_stock(b,p[2],5);
  PERFORM pg_temp.bf302_low(b,p[2],true);
  PERFORM pg_temp.bf302_assert((SELECT array_agg(quantity_delta ORDER BY quantity_delta) FROM public.stock_movements
    WHERE reference_type='PURCHASE' AND reference_id=purchase_id)=ARRAY[2,3]
    AND NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_id=purchase_id AND
      (type<>'PURCHASE' OR unit_cost<>10 OR business_id<>b)),'duplicate purchase quantities/cost/references');
  z:=pg_temp.bf302_buy(b,category,original_op,jsonb_build_array(pg_temp.bf302_line(p[2],99,'99.00')));
  PERFORM pg_temp.bf302_assert(z=a,'purchase replay returns original');
  PERFORM pg_temp.bf302_stock(b,p[2],5);
  groups:=groups+1;

  -- Every original ledger field, including audit timestamps, must survive later writers.
  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_rows FROM public.stock_movements m WHERE product_id=p[2];
  void_op:=gen_random_uuid();
  v:=public.void_purchase(b,void_op,purchase_id,'duplicate correction');
  PERFORM pg_temp.bf302_stock(b,p[2],0);
  PERFORM pg_temp.bf302_assert((SELECT array_agg(quantity_delta ORDER BY quantity_delta) FROM public.stock_movements
    WHERE reference_type='PURCHASE_VOID' AND reference_id=(v->'correction'->>'id')::uuid)=ARRAY[-3,-2]
    AND NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_type='PURCHASE_VOID'
      AND reference_id=(v->'correction'->>'id')::uuid AND (type<>'ADJUSTMENT' OR unit_cost<>10)),
    'void duplicate compensation snapshots/references');
  PERFORM pg_temp.bf302_assert(public.void_purchase(b,void_op,purchase_id,'duplicate correction')=v,'void exact replay');
  PERFORM pg_temp.bf302_assert((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m
    WHERE id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(before_rows) x))=before_rows,'original PURCHASE history immutable');
  PERFORM pg_temp.bf302_assert((SELECT default_purchase_cost FROM public.products WHERE id=p[2])=10,'sole void keeps reference cost');
  PERFORM pg_temp.bf302_assert((SELECT count(*) FROM public.stock_movements WHERE product_id=p[2])=4,'void replay no extra rows');
  groups:=groups+1;

  -- Both void orderings preserve the last APPLIED cost despite backdated purchase B.
  FOR n IN 3..4 LOOP
    original_op:=gen_random_uuid();
    a:=pg_temp.bf302_buy(b,category,original_op,jsonb_build_array(pg_temp.bf302_line(p[n],1,'10.00')),'2026-09-20T12:00Z');
    z:=pg_temp.bf302_buy(b,category,gen_random_uuid(),jsonb_build_array(pg_temp.bf302_line(p[n],1,'12.00')),'2026-01-01T12:00Z');
    PERFORM pg_temp.bf302_buy(b,category,original_op,jsonb_build_array(pg_temp.bf302_line(p[n],1,'10.00')));
    PERFORM pg_temp.bf302_assert((SELECT default_purchase_cost FROM public.products WHERE id=p[n])=12,'replay cannot restore cost');
    PERFORM public.void_purchase(b,gen_random_uuid(),((CASE WHEN n=3 THEN a ELSE z END)->'purchase'->>'id')::uuid,'cost ordering');
    PERFORM pg_temp.bf302_stock(b,p[n],1);
    PERFORM pg_temp.bf302_assert((SELECT default_purchase_cost FROM public.products WHERE id=p[n])=12,'void A/B cannot restore cost');
    groups:=groups+1;
  END LOOP;

  -- Adjustments are keyed by BUSINESS + OPERATION, not product or payload.
  op:=gen_random_uuid();
  a:=public.adjust_stock(b,op,p[5],3,'ADJUSTMENT','original');
  z:=public.adjust_stock(b,op,p[6],-99,'LOSS','different');
  PERFORM pg_temp.bf302_assert(z=a AND a->>'unit_cost' IS NULL,'cross-product adjustment replay returns original');
  PERFORM pg_temp.bf302_stock(b,p[5],3);
  PERFORM pg_temp.bf302_stock(b,p[6],0);
  PERFORM pg_temp.bf302_error(format('SELECT public.adjust_stock(%L,%L,%L,-4,%L,NULL)',b,gen_random_uuid(),p[5],'ADJUSTMENT'),'PT409','INSUFFICIENT_STOCK');
  PERFORM pg_temp.bf302_error(format('SELECT public.adjust_stock(%L,%L,%L,1,%L,NULL)',b,gen_random_uuid(),p[5],'LOSS'),'22023');
  PERFORM pg_temp.bf302_error(format('SELECT public.adjust_stock(%L,%L,%L,0,%L,NULL)',b,gen_random_uuid(),p[5],'ADJUSTMENT'),'22023');
  PERFORM pg_temp.bf302_assert((SELECT count(*) FROM public.stock_movements WHERE product_id=p[5])=1,'invalid adjustments no append');
  PERFORM public.adjust_stock(b,gen_random_uuid(),p[5],-3,'ADJUSTMENT',NULL);
  PERFORM pg_temp.bf302_stock(b,p[5],0);
  SET LOCAL ROLE postgres;
  UPDATE public.products SET is_active=false WHERE id=p[5];
  SET LOCAL ROLE authenticated;
  PERFORM public.adjust_stock(b,gen_random_uuid(),p[5],1,'ADJUSTMENT',NULL);
  PERFORM pg_temp.bf302_stock(b,p[5],1);
  PERFORM pg_temp.bf302_low(b,p[5],false);
  groups:=groups+1;

  -- Same UUID is independent in a second business; no product/tenant leakage.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[4],'role','authenticated')::text,true);
  PERFORM public.adjust_stock(foreign_b,op,p[11],9,'ADJUSTMENT',NULL);
  PERFORM pg_temp.bf302_stock(foreign_b,p[11],9);
  PERFORM pg_temp.bf302_assert(NOT EXISTS(SELECT 1 FROM public.get_product_stock(foreign_b,ARRAY[p[1]])),'foreign IDs omitted');
  PERFORM pg_temp.bf302_error(format('SELECT public.adjust_stock(%L,%L,%L,1,%L,NULL)',b,gen_random_uuid(),p[1],'ADJUSTMENT'),'42501');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  PERFORM pg_temp.bf302_stock(b,p[1],8);
  PERFORM pg_temp.bf302_error(format('SELECT * FROM public.get_product_stock(%L,ARRAY[%L::uuid])',foreign_b,p[11]),'42501');
  PERFORM pg_temp.bf302_error(format('SELECT public.adjust_stock(%L,%L,%L,1,%L,NULL)',b,gen_random_uuid(),p[11],'ADJUSTMENT'),'P0002');
  groups:=groups+1;

  -- Free duplicate SALE lines still consume inventory, then trigger low-stock.
  a:=pg_temp.bf302_buy(b,category,gen_random_uuid(),jsonb_build_array(pg_temp.bf302_line(p[6],6,'2.25')));
  PERFORM pg_temp.bf302_low(b,p[6],false);
  op:=gen_random_uuid();
  SET LOCAL ROLE postgres;
  sid:=pg_temp.bf302_sale(b,op,ARRAY[p[6],p[6]],ARRAY[1,3]);
  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_rows FROM public.stock_movements m WHERE reference_type='SALE' AND reference_id=sid;
  PERFORM pg_temp.bf302_assert((SELECT array_agg(quantity_delta ORDER BY quantity_delta) FROM public.stock_movements
    WHERE reference_type='SALE' AND reference_id=sid)=ARRAY[-3,-1]
    AND (SELECT sum(line_total) FROM public.sale_items WHERE sale_id=sid)=0
    AND NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_id=sid AND unit_cost<>2.25),'free duplicate SALE effects');
  PERFORM private.persist_checkout_stock(b,op);
  PERFORM pg_temp.bf302_assert((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m
    WHERE reference_type='SALE' AND reference_id=sid)=before_rows,'SALE replay exact immutable rows');
  PERFORM pg_temp.bf302_error(format('SELECT pg_temp.bf302_sale(%L,%L,ARRAY[%L::uuid],ARRAY[3])',b,gen_random_uuid(),p[6]),'PT409','INSUFFICIENT_STOCK');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bf302_stock(b,p[6],2);
  PERFORM pg_temp.bf302_low(b,p[6],true);
  -- Insufficient void rolls back status/audit/entire compensation, not just its balance.
  SET LOCAL ROLE postgres;
  SELECT count(*) INTO count_before FROM private.purchase_voids WHERE business_id=b;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bf302_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),a->'purchase'->>'id','insufficient'),'PT409','INSUFFICIENT_STOCK');
  PERFORM pg_temp.bf302_assert((SELECT status FROM public.purchases WHERE id=(a->'purchase'->>'id')::uuid)='COMPLETED','insufficient void status unchanged');
  SET LOCAL ROLE postgres;
  PERFORM pg_temp.bf302_assert((SELECT count(*) FROM private.purchase_voids WHERE business_id=b)=count_before,'insufficient void no audit');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bf302_stock(b,p[6],2);
  groups:=groups+1;

  -- Three-product purchase, then a late expense failure after stock/cost writes.
  a:=pg_temp.bf302_buy(b,category,gen_random_uuid(),jsonb_build_array(
    pg_temp.bf302_line(p[10],1,'3.00'),pg_temp.bf302_line(p[8],1,'3.00'),pg_temp.bf302_line(p[9],1,'3.00')));
  FOR n IN 8..10 LOOP PERFORM pg_temp.bf302_stock(b,p[n],1); END LOOP;
  op:=gen_random_uuid();
  PERFORM set_config('bf302.fail','expenses',true);
  PERFORM pg_temp.bf302_error(format('SELECT pg_temp.bf302_buy(%L,%L,%L,%L::jsonb)',b,category,op,
    jsonb_build_array(pg_temp.bf302_line(p[8],2,'99.00'))),'P0302');
  PERFORM set_config('bf302.fail','',true);
  PERFORM pg_temp.bf302_assert(NOT EXISTS(SELECT 1 FROM public.purchases WHERE operation_id=op),'failed purchase parent absent');
  PERFORM pg_temp.bf302_assert((SELECT default_purchase_cost FROM public.products WHERE id=p[8])=3,'failed purchase cost rollback');
  PERFORM pg_temp.bf302_stock(b,p[8],1);
  groups:=groups+1;

  -- Fail the second SALE ledger insert: no partial set, parent/items/payment survive only if previously committed.
  op:=gen_random_uuid();
  PERFORM set_config('bf302.fail',p[9]::text,true);
  SET LOCAL ROLE postgres;
  PERFORM pg_temp.bf302_error(format('SELECT pg_temp.bf302_sale(%L,%L,ARRAY[%L::uuid,%L::uuid],ARRAY[1,1])',b,op,p[8],p[9]),'P0302');
  PERFORM set_config('bf302.fail','',true);
  PERFORM pg_temp.bf302_assert(NOT EXISTS(SELECT 1 FROM public.sales WHERE operation_id=op),'failed SALE slices rollback');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.bf302_stock(b,p[8],1);
  PERFORM pg_temp.bf302_stock(b,p[9],1);
  -- Privileged corrupt history is isolated in a deliberately rolled-back
  -- subtransaction. Existing helpers must reject, never complete/repair it.
  SET LOCAL ROLE postgres;
  BEGIN
    sale_row:=private.persist_checkout_sale(b,op,NULL,NULL,0,0,0);
    PERFORM private.persist_checkout_items(b,op,jsonb_build_array(
      jsonb_build_object('itemType','PRODUCT','itemId',p[8],'quantity',1,'unitPriceOverride','0.00'),
      jsonb_build_object('itemType','PRODUCT','itemId',p[9],'quantity',1,'unitPriceOverride','0.00')));
    PERFORM private.persist_checkout_payment(b,op,'CASH');
    INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
      VALUES(b,p[8],'SALE',-1,3,'SALE',sale_row.id,users[1]);
    SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_rows FROM public.stock_movements m WHERE reference_id=sale_row.id;
    PERFORM pg_temp.bf302_error(format('SELECT * FROM private.persist_checkout_stock(%L,%L)',b,op),'22023','INVALID_CHECKOUT');
    PERFORM pg_temp.bf302_assert((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m
      WHERE reference_id=sale_row.id)=before_rows,'incomplete SALE is not repaired');
    RAISE EXCEPTION USING ERRCODE='P0303',MESSAGE='rollback corrupt SALE fixture';
  EXCEPTION WHEN SQLSTATE 'P0303' THEN NULL; END;
  SET LOCAL ROLE authenticated;
  groups:=groups+1;

  -- A late second compensation failure must roll back the first as well as audit/status.
  PERFORM set_config('bf302.fail',p[9]::text,true);
  PERFORM pg_temp.bf302_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),a->'purchase'->>'id','late fault'),'P0302');
  PERFORM set_config('bf302.fail','',true);
  PERFORM pg_temp.bf302_assert((SELECT status FROM public.purchases WHERE id=(a->'purchase'->>'id')::uuid)='COMPLETED','late void status rollback');
  SET LOCAL ROLE postgres;
  PERFORM pg_temp.bf302_assert(NOT EXISTS(SELECT 1 FROM private.purchase_voids pv WHERE pv.purchase_id=(a->'purchase'->>'id')::uuid),'late void audit rollback');
  SET LOCAL ROLE authenticated;
  FOR n IN 8..10 LOOP PERFORM pg_temp.bf302_stock(b,p[n],1); END LOOP;
  SET LOCAL ROLE postgres;
  BEGIN
    INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
      VALUES(b,p[8],'PURCHASE',1,3,'PURCHASE',(a->'purchase'->>'id')::uuid,users[1]);
    SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_rows FROM public.stock_movements m WHERE business_id=b;
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.bf302_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),a->'purchase'->>'id','bad history'),'PT409','INCOMPLETE_HISTORY');
    SET LOCAL ROLE postgres;
    PERFORM pg_temp.bf302_assert((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m
      WHERE business_id=b)=before_rows,'inconsistent purchase history is not repaired');
    RAISE EXCEPTION USING ERRCODE='P0303',MESSAGE='rollback corrupt PURCHASE fixture';
  EXCEPTION WHEN SQLSTATE 'P0303' THEN NULL; END;
  SET LOCAL ROLE authenticated;
  groups:=groups+1;

  -- All original rows survive later writers exactly, and even postgres cannot mutate them.
  SET LOCAL ROLE postgres;
  PERFORM pg_temp.bf302_error(format('UPDATE public.stock_movements SET notes=%L WHERE product_id=%L','changed',p[1]),'55000');
  PERFORM pg_temp.bf302_error(format('DELETE FROM public.stock_movements WHERE product_id=%L',p[1]),'55000');
  SELECT jsonb_agg(to_jsonb(m) ORDER BY id) INTO before_rows FROM public.stock_movements m WHERE business_id=b;
  FOR n IN 1..5 LOOP
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[n],'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    IF n<>1 THEN
      PERFORM pg_temp.bf302_error(format('SELECT public.adjust_stock(%L,%L,%L,1,%L,NULL)',b,gen_random_uuid(),p[1],'ADJUSTMENT'),'42501');
      PERFORM pg_temp.bf302_error(format('SELECT pg_temp.bf302_buy(%L,%L,%L,%L::jsonb)',b,category,gen_random_uuid(),
        jsonb_build_array(pg_temp.bf302_line(p[1],1))),'42501');
      PERFORM pg_temp.bf302_error(format('SELECT public.void_purchase(%L,%L,%L,%L)',b,gen_random_uuid(),a->'purchase'->>'id','denied'),'42501');
    END IF;
    -- OWNER and BARBER may read; inactive/foreign/nonmember may not.
    IF n IN (1,2) THEN PERFORM pg_temp.bf302_stock(b,p[1],8);
    ELSE PERFORM pg_temp.bf302_error(format('SELECT * FROM public.get_product_stock(%L,ARRAY[%L::uuid])',b,p[1]),'42501'); END IF;
    PERFORM pg_temp.bf302_error(format('INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES(%L,%L,%L,1,%L)',b,p[1],'ADJUSTMENT',users[n]),'42501');
    PERFORM pg_temp.bf302_error(format('UPDATE public.stock_movements SET notes=%L WHERE product_id=%L','changed',p[1]),'42501');
    PERFORM pg_temp.bf302_error(format('DELETE FROM public.stock_movements WHERE product_id=%L',p[1]),'42501');
    PERFORM pg_temp.bf302_error(format('SELECT * FROM private.persist_checkout_stock(%L,%L)',b,op),'42501');
    SET LOCAL ROLE postgres;
  END LOOP;
  SET LOCAL ROLE anon;
  PERFORM pg_temp.bf302_error(format('SELECT public.adjust_stock(%L,%L,%L,1,%L,NULL)',b,gen_random_uuid(),p[1],'ADJUSTMENT'),'42501');
  PERFORM pg_temp.bf302_error(format('SELECT * FROM public.get_product_stock(%L,ARRAY[%L::uuid])',b,p[1]),'42501');
  SET LOCAL ROLE postgres;
  PERFORM pg_temp.bf302_assert((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id=b)=before_rows,'denied mutations preserve full history');
  groups:=groups+1;
  PERFORM pg_temp.bf302_assert(groups=13,'group discovery count');
  RAISE NOTICE 'BF302 inventory regression PASS %/13 integrated groups',groups;
END $$;
ROLLBACK;
